// Importación de Firebase desde la CDN (Módulo)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, doc, collection, runTransaction, enableIndexedDbPersistence, writeBatch, serverTimestamp, getDoc, setDoc, query, where, orderBy, limit, limitToLast, startAfter, endBefore, getDocs, deleteDoc, addDoc, updateDoc, increment, onSnapshot } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { generarPlantillaExcel, procesarExcelCargaMasiva, excelSerialDateToJS, exportarInventarioResguardo } from './excelUtils.js';

window.showAlertCenter = function(titulo, mensaje, isError = false) {
    const modal = document.getElementById('modal-alerta-centro');
    const icono = document.getElementById('alerta-centro-icono');
    const tituloEl = document.getElementById('alerta-centro-titulo');
    const mensajeEl = document.getElementById('alerta-centro-mensaje');
    if(!modal) { alert(mensaje); return; }
    if (isError) {
        icono.innerHTML = '<i class="ph ph-warning-circle" style="color: #dc3545;"></i>';
        tituloEl.style.color = '#dc3545';
    } else {
        icono.innerHTML = '<i class="ph ph-check-circle" style="color: #198754;"></i>';
        tituloEl.style.color = '#198754';
    }
    tituloEl.textContent = titulo;
    mensajeEl.textContent = mensaje;
    modal.style.display = 'flex';
};


/* ----------------------------------------------------
   1a. UTILERÍA ROBUSTA DE TIPOS (T-GUARD)
   ---------------------------------------------------- */
window.escapeHTML = function (str) {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
};

const ROLES_SISTEMA = [
    { id: 'enfermero', label: 'Enfermero (Gestión de Bandejas)' },
    { id: 'operador', label: 'Operador de Bodega' },
    { id: 'administrador', label: 'Administrador (Inventario)' },
    { id: 'superadmin', label: 'Super Admin (Control Total)' }
];

const SAR_Utils = {
    // Parseador Universal (Retorna objeto Date)
    parseDate: (val) => {
        if (!val) return null;
        try {
            if (typeof val === 'number') return new Date((val - 25569) * 86400 * 1000);
            if (typeof val === 'string') {
                const clean = val.trim();
                if (clean.includes('-')) {
                    const [y, m, d] = clean.split(/[-T]/);
                    return new Date(y, m - 1, d);
                }
                if (clean.includes('/')) {
                    const parts = clean.split(/[\/\s]/);
                    return new Date(parts[2], parts[1] - 1, parts[0]);
                }
            }
            if (val.toDate) return val.toDate();
            if (val instanceof Date) return val;
            return null;
        } catch (e) { return null; }
    },

    // Formateador Universal (Retorna String DD / MM / AAAA)
    formatDate: (val) => {
        const date = SAR_Utils.parseDate(val);
        if (!date || isNaN(date.getTime())) return "N/A";

        return date.toLocaleDateString('es-CL', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        }).replace(/-/g, ' / ');
    },

    // Normalizador de Búsqueda
    matches: (source, term) => {
        if (!source || !term) return false;
        return source.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .includes(term.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
    },

    // Predictive Forecasting (Weighted Burn Rate)
    calculateBurnRate: (insumoName, logs) => {
        if (!logs || logs.length === 0) return 0;

        const hoy = new Date();
        let qty30 = 0;
        let qty90 = 0;

        logs.forEach(log => {
            if (log.insumoName !== insumoName || (log.type !== 'salida' && log.type !== 'SALIDA')) return;
            const d = SAR_Utils.parseDate(log.date);
            if (!d) return;
            const diffDays = Math.floor((hoy - d) / (1000 * 60 * 60 * 24));

            const qty = Number(log.quantity) || 0;
            // Solo salidas de hasta 90 días
            if (diffDays <= 30) {
                qty30 += qty;
            } else if (diffDays <= 90) {
                qty90 += qty;
            }
        });

        // Ponderación Exponencial: 60% peso a los ultimos 30 dias, 40% a los 60 dias anteriores
        // Tasa diaria de ultimos 30 dias
        const rate30 = qty30 / 30;
        // Tasa diaria de periodo 31-90 (60 dias)
        const rate90 = qty90 / 60;

        return (rate30 * 0.6) + (rate90 * 0.4);
    },

    predictStockDepletion: (stock, burnRate) => {
        if (burnRate <= 0) return Infinity;
        return Math.floor(stock / burnRate);
    },

    // Procurement
    calcularOrdenOptima: (stockActual, burnRate, meses = 1) => {
        if (burnRate <= 0) return 0;
        const meta = burnRate * 30 * meses;
        const sugerido = Math.ceil(meta - stockActual);
        return sugerido > 0 ? sugerido : 0;
    }
};

// Tracking de Listeners para prevenir Memory Leaks
const activeListeners = {
    dashboard: null,
    expirations: null,
    historial: null,
    bodegas: null,
    usuarios: null,
    config: null,
    informes_kpi: null,
    informes_logs: null,
    logs: null,
    predictive: null
};

window.globalMovimientosPredictivos = [];

function clearListener(type) {
    if (activeListeners[type]) {
        activeListeners[type](); // Unsubscribe
        activeListeners[type] = null;
    }
}

function clearAllListeners() {
    console.info("[Cleanup] Desconectando todos los sockets de tiempo real...");
    Object.keys(activeListeners).forEach(key => clearListener(key));
}

const firebaseConfig = {
    apiKey: "AIzaSyAyktOnoB-j7nX4-YZLa6B74wOBCbZvlsA",
    authDomain: "sarinventario.firebaseapp.com",
    projectId: "sarinventario",
    storageBucket: "sarinventario.firebasestorage.app",
    messagingSenderId: "358257655117",
    appId: "1:358257655117:web:b7f46ad97e94afa1324b04"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Habilitar la Persistencia Offline local
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
        console.warn('Persistencia: Firebase detectó múltiples pestañas. Persistencia solo habilitada en la pestaña principal.');
    } else if (err.code === 'unimplemented') {
        console.warn('Persistencia: Tu navegador no soporta el almacenamiento offline nativo.');
    }
});

// Global Error Guard for Production
window.onerror = function (message, source, lineno, colno, error) {
    console.error("[Global Error]:", { message, source, lineno, error });
    if (window.showToast) window.showToast('Error de Sistema', 'Se ha detectado una anomalía. Si persiste, contacte a soporte técnico.', 'error');
    return false;
};

window.onunhandledrejection = function (event) {
    console.error("[Unhandled Rejection]:", event.reason);
    if (window.showToast) window.showToast('Error de Red/Datos', 'La operación no pudo completarse. Verifique su conexión.', 'warning');
};

/**
 * SERVICIO ARQUITECTURA DE BACKEND: Trazabilidad inmutable usando runTransaction
 * Garantiza consistencia atómica y previene condiciones de carrera (Race Conditions).
 * 
 * @param {string} itemId ID del documento en "Insumos"
 * @param {Object} newData Datos nuevos a setear
 * @param {Object} currentUser Objeto del usuario (ej: auth.currentUser)
 */
export async function updateInventoryWithAudit(itemId, newData, currentUser) {
    if (!itemId || !newData || !currentUser?.uid) {
        throw new Error("Parámetros incompletos. Se requiere ID de insumo, datos y usuario autenticado.");
    }

    try {
        const insumoRef = doc(db, 'Insumos', itemId);
        const statsRef = doc(db, 'Metadata', 'GlobalStats');

        const result = await runTransaction(db, async (transaction) => {
            // 1. Lecturas
            const insumoDoc = await transaction.get(insumoRef);
            if (!insumoDoc.exists()) throw new Error(`Insumo [${itemId}] no encontrado.`);

            const statsDoc = await transaction.get(statsRef);
            const stats = statsDoc.exists() ? statsDoc.data() : { criticalCount: 0, totalCapital: 0, totalItems: 0 };

            const previousData = insumoDoc.data();
            const oldQty = Number(previousData.quantity) || 0;

            let newQty = oldQty;
            if (newData.quantityDiff !== undefined) {
                newQty = oldQty + Number(newData.quantityDiff);
                if (newQty < 0) throw new Error(`Quiebre de Stock. Disponible: ${oldQty}.`);
                newData.quantity = newQty;
                delete newData.quantityDiff;
            } else if (newData.quantity !== undefined) {
                newQty = Number(newData.quantity);
            }

            // ===================================
            // SINCRONIZACIÓN DE BATCHES (FEFO)
            // ===================================
            // Si hay un cambio manual que afecta al total y vienen datos de lote desde la UI
            if (newData.batch !== undefined && newData.expirationDate !== undefined) {
                let currentBatches = previousData.batches || [];
                
                if (currentBatches.length <= 1) {
                    // Si había 0 o 1 lote, simplemente lo sobrescribimos con lo que diga el editor manual
                    newData.batches = [{
                        batch: newData.batch || 'S/L',
                        quantity: newQty,
                        expirationDate: newData.expirationDate || ''
                    }];
                } else if (newQty !== oldQty) {
                    // Si tiene multiples lotes y alguien cambió la cantidad total a mano desde Editar (peligroso)
                    // Se ajusta el primer lote (el más próximo a vencer)
                    currentBatches.sort((a, b) => new Date(a.expirationDate || '2099-12-31') - new Date(b.expirationDate || '2099-12-31'));
                    const diff = newQty - oldQty;
                    currentBatches[0].quantity += diff;
                    if (currentBatches[0].quantity < 0) currentBatches[0].quantity = 0; // Fallback
                    newData.batches = currentBatches;
                }
            }

            const oldPrice = Number(previousData.unitPrice) || 0;
            const newPrice = newData.unitPrice !== undefined ? Number(newData.unitPrice) : oldPrice;
            const limit = Number(previousData.criticalLimit) || 50;

            // 2. Cálculos de Diff para Metadatos Globales
            let criticalDiff = 0;
            const wasCritical = oldQty <= limit;
            const isCritical = newQty <= limit;
            if (!wasCritical && isCritical) criticalDiff = 1;
            else if (wasCritical && !isCritical) criticalDiff = -1;

            const capitalDiff = (newQty * newPrice) - (oldQty * oldPrice);

            // 3. Actualizaciones
            transaction.update(insumoRef, {
                ...newData,
                lastModified: serverTimestamp(),
                lastModifierId: currentUser.uid
            });

            // Actualizar Estadísticas Globales (Escalabilidad O(1))
            transaction.set(statsRef, {
                criticalCount: increment(criticalDiff),
                totalCapital: increment(capitalDiff),
                lastUpdated: serverTimestamp()
            }, { merge: true });

            // Trail de Auditoría
            const auditLogRef = doc(collection(insumoRef, 'audit_logs'));
            transaction.set(auditLogRef, {
                action: 'ACTUALIZACION',
                timestamp: serverTimestamp(),
                userId: currentUser.uid,
                changes: { previous: previousData, new: newData }
            });

            return { oldQty, newQty };
        });

        return result;
    } catch (error) {
        console.error(`[Error Arquitectura] Falla en transacción de Insumo ${itemId}:`, error);
        throw error;
    }
}

/**
 * Utilidad de Optmización: Wrapper para Retry Automático de Promesas
 * Usa "Exponential Backoff" para espaciar intentos.
 */
async function withRetry(asyncOperation, maxRetries = 3, baseDelayMs = 1500) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            return await asyncOperation();
        } catch (error) {
            attempt++;
            console.warn(`[Network Retry] Intento ${attempt}/${maxRetries} fallido: ${error.message}`);
            if (attempt >= maxRetries) {
                throw error; // Agotados los reintentos, el error fluye hacia arriba.
            }
            // Espera Exponencial: 1.5s, 3s, 6s...
            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            showToast('Conexión Inestable', `Retraso de red detectado. Reintentando operación en ${delay / 1000}s...`, 'warning');
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/* ----------------------------------------------------
   1. SISTEMA COMPLETO DE FEEDBACK GLOBALES (TOAST)
   ---------------------------------------------------- */
const toastContainer = document.createElement('div');
toastContainer.style.position = 'fixed';
toastContainer.style.bottom = '20px';
toastContainer.style.right = '20px';
toastContainer.style.zIndex = '9999';
toastContainer.style.display = 'flex';
toastContainer.style.flexDirection = 'column';
toastContainer.style.gap = '10px';
// El contenedor se anexa asíncronamente cuando el body está listo

function showToast(title, text, type = 'info') {
    const toast = document.createElement('div');
    let bgColor, icon;

    if (type === 'success') { bgColor = 'var(--success)'; icon = 'ph-check-circle'; }
    else if (type === 'warning') { bgColor = 'var(--warning)'; icon = 'ph-warning'; }
    else if (type === 'error') { bgColor = 'var(--danger)'; icon = 'ph-warning-circle'; }
    else { bgColor = 'var(--primary)'; icon = 'ph-info'; }

    toast.style.backgroundColor = 'white';
    toast.style.color = 'var(--text-main)';
    toast.style.borderLeft = `4px solid ${bgColor}`;
    toast.style.padding = '16px 20px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '12px';
    toast.style.minWidth = '250px';
    toast.style.animation = 'slideIn 0.3s ease-out forwards';
    toast.style.transition = 'opacity 0.3s ease-out';

    toast.innerHTML = `
        <i class="ph-fill ${icon}" style="color: ${bgColor}; font-size: 24px;"></i>
        <div>
            <div style="font-weight: 700; font-size: 14px; margin-bottom: 2px;">${title}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${text}</div>
        </div>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
window.showToast = showToast;

document.addEventListener('DOMContentLoaded', () => {
    console.log('Visor Logístico Clínico Inicializado - Bootstrap');
    
    // Poblado Dinámico de Roles (Fase 31)
    const selectNuevoRol = document.getElementById('select-nuevo-usuario-rol');
    if (selectNuevoRol) {
        selectNuevoRol.innerHTML = '<option value="">Seleccione un nivel de acceso...</option>';
        ROLES_SISTEMA.forEach(rol => {
            selectNuevoRol.innerHTML += `<option value="${rol.id}">${rol.label}</option>`;
        });
    }

    document.body.appendChild(toastContainer); // Inyectamos el host de notificaciones
    // Estilos dinámicos
    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = `
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes spin { 100% { transform: rotate(360deg); } } 
        .ph-spin { animation: spin 1s linear infinite; }
    `;
    document.head.appendChild(styleSheet);

    // Nodos de Autenticación
    const loginView = document.getElementById('login-view');
    const mainApp = document.getElementById('main-app');
    const loginForm = document.getElementById('form-login');
    let isAppInitialized = false;

    // 1A. EVENTO DE INICIO DE SESIÓN
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = loginForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph-spinner ph-spin"></i> VALIDANDO...';
            btn.disabled = true;

            const email = document.getElementById('login-email').value;
            const pwd = document.getElementById('login-pwd').value;

            try {
                // Autenticación directa a Firebase Authentication
                await signInWithEmailAndPassword(auth, email, pwd);
                // NOTA: No hacemos redirect ni manipulamos UI aquí. 
                // Dejamos que el "onAuthStateChanged" maneje todo centralizadamente.
            } catch (error) {
                console.error("Fallo Auth:", error);
                window.showToast("Acceso Denegado", "Su credencial es inválida o carece de permisos para ingresar.", "error");
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    // 1B. UX DE LOGIN: TOGGLE CONTRASEÑA
    const togglePwdBtn = document.getElementById('toggle-pwd-btn');
    const loginPwdInput = document.getElementById('login-pwd');
    if (togglePwdBtn && loginPwdInput) {
        togglePwdBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const currentType = loginPwdInput.type;
            const targetType = currentType === 'password' ? 'text' : 'password';
            loginPwdInput.type = targetType;

            const icon = togglePwdBtn.querySelector('i') || togglePwdBtn.querySelector('svg');
            if (icon) {
                if (targetType === 'text') {
                    icon.classList.remove('ph-eye');
                    icon.classList.add('ph-eye-slash');
                } else {
                    icon.classList.remove('ph-eye-slash');
                    icon.classList.add('ph-eye');
                }
            } else {
                togglePwdBtn.innerHTML = `<i class="ph ${targetType === 'text' ? 'ph-eye-slash' : 'ph-eye'}" style="font-size: 20px;"></i>`;
            }
        });
    }

    // 1C. RECUPERACIÓN DE CONTRASEÑA
    const forgotPwdLink = document.getElementById('forgot-pwd-link');
    const loginEmailInput = document.getElementById('login-email');
    if (forgotPwdLink) {
        forgotPwdLink.addEventListener('click', async (e) => {
            e.preventDefault();
            const email = loginEmailInput.value.trim();

            if (!email) {
                window.showToast('Atención Requerida', 'Ingrese su correo para recuperar la contraseña', 'warning');
                loginEmailInput.focus();
                return;
            }

            try {
                await sendPasswordResetEmail(auth, email);
                window.showToast('Gestión Exitosa', 'Correo de recuperación enviado a su bandeja principal.', 'success');
            } catch (error) {
                console.error("Password Reset Error:", error);

                let errorMsg = 'Error al enviar la solicitud.';
                if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-email') {
                    errorMsg = 'El correo institucional proporcionado no figura en nuestra base de datos.';
                } else if (error.code === 'auth/too-many-requests') {
                    errorMsg = 'Múltiples intentos denegados. Intente nuevamente en 5 minutos.';
                }

                window.showToast('Acción Fallida', errorMsg, 'error');
            }
        });
    }

    // 2. OBSERVADOR DE ESTADO (El Guardián Principal de la SPA)
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // Usuario validado -> Forzar explícitamente el ocultamiento del login y mostrar Dashboard
            document.getElementById('login-view').style.display = 'none';
            document.getElementById('main-app').style.display = 'flex';

            // Inyectar el correo en la barra superior
            const headerUserName = document.getElementById('header-center-name');
            if (headerUserName) {
                headerUserName.textContent = user.email;
            }

            // Validamos roles y aplicamos capa de Seguridad Visual
            await window.enforceRBACLogic(user);

            // ==========================================
            // AUTO-LOGOUT POR INACTIVIDAD (15 Minutos)
            // ==========================================
            if (window.inactivityTimeout) clearTimeout(window.inactivityTimeout);
            
            const resetInactivityTimer = () => {
                if (window.inactivityTimeout) clearTimeout(window.inactivityTimeout);
                // 15 minutos = 900,000 ms
                window.inactivityTimeout = setTimeout(async () => {
                    console.warn("Cerrando sesión por inactividad.");
                    await signOut(auth);
                    window.location.reload(); // Asegurar estado limpio
                }, 900000); 
            };

            // Escuchar eventos globales
            ['mousemove', 'keydown', 'touchstart', 'scroll', 'click'].forEach(evt => {
                document.addEventListener(evt, resetInactivityTimer, { passive: true });
            });
            // Iniciar por primera vez
            resetInactivityTimer();

            // ==========================================
            // FASE 10: WIRE-UP EXTREMO Y ENCAPSULACIÓN
            // ==========================================
            const userRole = document.body.getAttribute('data-user-role');

            // 1. Forzado de Evento del Botón Eliminar
            const btnEliminarPrincipal = document.querySelector('#view-configuracion .btn-danger');
            if (btnEliminarPrincipal) {
                btnEliminarPrincipal.onclick = (e) => {
                    e.preventDefault();
                    document.getElementById('modal-borrado-total').style.display = 'flex';
                };
            }

            // 2. Creación de la Solicitud (El 'Maker')
            const btnSolicitarWipeObj = document.getElementById('btn-solicitar-wipe');
            if (btnSolicitarWipeObj) {
                const newBtn = btnSolicitarWipeObj.cloneNode(true);
                btnSolicitarWipeObj.parentNode.replaceChild(newBtn, btnSolicitarWipeObj);

                document.getElementById('btn-solicitar-wipe').addEventListener('click', async () => {
                    const inputWipe = document.getElementById('confirmacion-wipe').value;
                    if (inputWipe.trim().toUpperCase() !== 'ELIMINAR') return alert("Escriba ELIMINAR");
                    try {
                        const cod = "WIPE-" + Math.floor(Math.random() * 9000);
                        await addDoc(collection(db, 'Solicitudes_Criticas'), {
                            codigo: cod, fecha: serverTimestamp(), usuario: auth.currentUser.email, estado: 'Solicitado', accion: 'WIPE_DB'
                        });
                        alert("Solicitud Creada: " + cod);
                        document.getElementById('modal-borrado-total').style.display = 'none';
                    } catch (e) { console.error(e); alert("Error guardando solicitud"); }
                });
            }

            // ==========================================
            // FASE 11: AJUSTE CRÍTICO DE INVENTARIO
            // ==========================================
            if (userRole === 'admin' || userRole === 'global' || userRole === 'superadmin') {
                const btnAbrirAjuste = document.getElementById('btn-abrir-ajuste') || document.querySelector('#view-configuracion .btn-warning');
                const selectInsumo = document.getElementById('ajuste-insumo');
                const buscadorAjuste = document.getElementById('buscador-ajuste');
                const btnEjecutarAjuste = document.getElementById('btn-ejecutar-ajuste');

                window.cargarInsumosParaAjuste = async function () {
                    try {
                        const snapshot = await getDocs(query(collection(db, 'Insumos'), orderBy('name')));
                        if (selectInsumo) {
                            if (snapshot.empty) {
                                selectInsumo.innerHTML = '<option disabled>No hay insumos en la base de datos</option>';
                                return;
                            }
                            selectInsumo.innerHTML = '<option value="" disabled selected>Seleccione un insumo...</option>';
                            snapshot.forEach(docSnap => {
                                const data = docSnap.data();
                                const option = document.createElement('option');
                                option.value = docSnap.id;
                                option.dataset.stock = data.quantity || 0;
                                option.dataset.nombre = data.name;
                                option.textContent = `[Stock: ${data.quantity || 0}] - ${data.name}`;
                                selectInsumo.appendChild(option);
                            });
                        }
                    } catch (error) {
                        console.error("Error cargando insumos para ajuste:", error);
                        showToast('Error', 'No se pudieron cargar los insumos', 'error');
                    }
                };

                if (btnAbrirAjuste) {
                    // Mantenemos el onclick del HTML activo.
                }

                if (buscadorAjuste && selectInsumo) {
                    buscadorAjuste.addEventListener('input', (e) => {
                        const term = e.target.value.toLowerCase();
                        Array.from(selectInsumo.options).forEach(opt => {
                            if (opt.value === "") return;
                            const text = opt.textContent.toLowerCase();
                            opt.style.display = text.includes(term) ? 'block' : 'none';
                        });
                    });
                }

                if (btnEjecutarAjuste) {
                    const newBtnEjecutar = btnEjecutarAjuste.cloneNode(true);
                    btnEjecutarAjuste.parentNode.replaceChild(newBtnEjecutar, btnEjecutarAjuste);

                    newBtnEjecutar.addEventListener('click', async () => {
                        const cantidadInputStr = document.getElementById('ajuste-cantidad').value;
                        const justificacion = document.getElementById('ajuste-justificacion').value.trim();
                        const selectedOption = selectInsumo.options[selectInsumo.selectedIndex];

                        if (!selectedOption || selectedOption.value === "") {
                            return alert('Debe seleccionar un insumo.');
                        }

                        const cantidadParsed = Number(cantidadInputStr);
                        if (!cantidadInputStr || isNaN(cantidadParsed) || cantidadParsed === 0) {
                            return alert('Ingrese una cantidad válida (+ o -). No puede ser cero.');
                        }

                        if (justificacion.length <= 10) {
                            return alert('La justificación debe tener más de 10 caracteres.');
                        }

                        const docId = selectedOption.value;
                        const stockActual = Number(selectedOption.dataset.stock);
                        const insumoNombre = selectedOption.dataset.nombre;

                        let nuevoStock = stockActual + cantidadParsed;
                        let accionDetallada = "";
                        let tipoAjuste = cantidadParsed > 0 ? 'sumar' : 'restar';
                        const cantidadAbs = Math.abs(cantidadParsed);

                        if (tipoAjuste === 'sumar') {
                            accionDetallada = `Suma de stock: ${stockActual} -> ${nuevoStock} (+${cantidadAbs})`;
                        } else if (tipoAjuste === 'restar') {
                            accionDetallada = `Resta de stock: ${stockActual} -> ${nuevoStock} (-${cantidadAbs})`;
                        }

                        if (nuevoStock < 0) {
                            return alert('El stock resultante no puede ser negativo.');
                        }

                        const codigoAjuste = "ADJ-" + Math.floor(10000 + Math.random() * 90000);

                        try {
                            await runTransaction(db, async (transaction) => {
                                const insumoRef = doc(db, 'Insumos', docId);
                                const insumoSnap = await transaction.get(insumoRef);
                                if (!insumoSnap.exists()) {
                                    throw new Error("El insumo no existe en la base de datos.");
                                }

                                const dataActual = insumoSnap.data();
                                const stockReal = dataActual.quantity || 0;
                                const nuevoStockTransaccion = stockReal + cantidadParsed;

                                if (nuevoStockTransaccion < 0) {
                                    throw new Error(`Operación denegada: El stock no puede ser menor a 0. Stock actual: ${stockReal}`);
                                }

                                let currentBatches = dataActual.batches || [];
                                // Migración On-The-Fly si no tiene array batches
                                if (currentBatches.length === 0 && dataActual.batch) {
                                    currentBatches.push({
                                        batch: dataActual.batch,
                                        quantity: stockReal,
                                        expirationDate: dataActual.expirationDate || ''
                                    });
                                }

                                if (cantidadParsed < 0) {
                                    // RESTA - Aplicar FEFO
                                    let qtyToReduce = Math.abs(cantidadParsed);
                                    
                                    // FEFO: Ordenar por fecha expiración
                                    currentBatches.sort((a, b) => new Date(a.expirationDate || '2099-12-31') - new Date(b.expirationDate || '2099-12-31'));

                                    for (let i = 0; i < currentBatches.length && qtyToReduce > 0; i++) {
                                        if (currentBatches[i].quantity > 0) {
                                            const available = currentBatches[i].quantity;
                                            if (available >= qtyToReduce) {
                                                currentBatches[i].quantity -= qtyToReduce;
                                                qtyToReduce = 0;
                                            } else {
                                                qtyToReduce -= available;
                                                currentBatches[i].quantity = 0;
                                            }
                                        }
                                    }
                                    // Filtrar lotes que quedaron en 0 si lo deseamos, pero mejor dejarlos para mantener historial visual, o borrarlos
                                    currentBatches = currentBatches.filter(b => b.quantity > 0);

                                } else {
                                    // SUMA - Añadir a un lote de Ajuste (o al primero si existe)
                                    if (currentBatches.length > 0) {
                                        currentBatches[0].quantity += cantidadParsed;
                                    } else {
                                        currentBatches.push({
                                            batch: "AJUSTE",
                                            quantity: cantidadParsed,
                                            expirationDate: ""
                                        });
                                    }
                                }

                                transaction.update(insumoRef, { 
                                    quantity: increment(cantidadParsed), 
                                    batches: currentBatches,
                                    lastUpdated: serverTimestamp() 
                                });

                                const newLogRef = doc(collection(db, 'Historial_Movimientos'));
                                transaction.set(newLogRef, {
                                    type: 'AJUSTE_CRITICO',
                                    item: insumoNombre,
                                    quantity: cantidadParsed,
                                    user: auth.currentUser.email,
                                    date: serverTimestamp(),
                                    origin: 'Ajuste Manual Crítico',
                                    dest: 'N/A'
                                });

                                const newAuditRef = doc(collection(db, 'Auditoria'));
                                transaction.set(newAuditRef, {
                                    code: codigoAjuste,
                                    user: auth.currentUser.email,
                                    item: insumoNombre,
                                    action: accionDetallada,
                                    justification: justificacion,
                                    date: serverTimestamp()
                                });
                            });

                            if (modalAjuste) modalAjuste.style.display = 'none';

                            // UI de Éxito
                            alert(`¡AJUSTE REALIZADO CON ÉXITO!\nCÓDIGO DE AUDITORÍA: ${codigoAjuste}`);

                            // Correo de respaldo
                            const mailBody = `Se ha registrado un ajuste crítico de inventario.\n\nCódigo: ${codigoAjuste}\nInsumo: ${insumoNombre}\nAcción: ${accionDetallada}\nJustificación: ${justificacion}\nUsuario: ${auth.currentUser.email}`;
                            window.location.href = `mailto:visor@tudominio.com?subject=Ajuste Critico ${codigoAjuste}&body=${encodeURIComponent(mailBody)}`;

                            document.getElementById('ajuste-cantidad').value = "";
                            document.getElementById('ajuste-justificacion').value = "";
                            window.cargarInsumosParaAjuste();
                        } catch (error) {
                            console.error("Error en ajuste crítico:", error);
                            alert('No se pudo completar el ajuste.');
                        }
                    });
                }
            }

            window.generatePurchaseDraft = async function (insumoId, insumoName, stock, burnRate, diasQuiebre) {
                if (!auth.currentUser) return;
                const sugerido = SAR_Utils.calcularOrdenOptima(stock, burnRate, 1);
                if (sugerido <= 0) {
                    window.showToast("Cálculo Automático", "El insumo no requiere abastecimiento en este momento.", "warning");
                    return;
                }

                try {
                    // Se usan imports estáticos: doc, collection, addDoc, serverTimestamp

                    const code = "REQ-" + Math.floor(1000 + Math.random() * 9000);
                    await addDoc(collection(db, 'Solicitudes_Compra'), {
                        codigo: code,
                        insumoId: insumoId,
                        insumoName: insumoName,
                        stockActual: stock,
                        burnRate: Number(burnRate.toFixed(2)),
                        diasParaQuiebre: diasQuiebre,
                        cantidadSugerida: sugerido,
                        estado: "BORRADOR",
                        fechaCreacion: serverTimestamp(),
                        autor: auth.currentUser.email
                    });
                    window.showToast("Borrador Generado", `Solicitud ${code} por ${sugerido} uds creada exitosamente.`, "success");
                } catch (e) {
                    console.error(e);
                    window.showToast("Error", "No se pudo generar la solicitud de compra.", "error");
                }
            };

            window.generateMassivePurchaseDrafts = async function (insumosListJSON) {
                if (!auth.currentUser) return;
                const insumos = JSON.parse(decodeURIComponent(insumosListJSON));
                if (insumos.length === 0) return;

                try {
                    // Se usan imports estáticos: doc, collection, addDoc, serverTimestamp

                    let count = 0;
                    for (const ins of insumos) {
                        const code = "REQ-" + Math.floor(1000 + Math.random() * 9000);
                        await addDoc(collection(db, 'Solicitudes_Compra'), {
                            codigo: code,
                            insumoId: ins.id,
                            insumoName: ins.name,
                            stockActual: ins.stock,
                            burnRate: ins.burnRate,
                            diasParaQuiebre: ins.diasQuiebre,
                            cantidadSugerida: ins.sugerido,
                            estado: "BORRADOR",
                            fechaCreacion: serverTimestamp(),
                            autor: auth.currentUser.email
                        });
                        count++;
                    }
                    window.showToast("Órdenes Masivas", `Se generaron ${count} borradores de compra exitosamente.`, "success");
                    document.getElementById('modal-ia-analisis').classList.remove('active');
                } catch (e) {
                    console.error(e);
                    window.showToast("Error", "Fallo al generar órdenes masivas.", "error");
                }
            };

            // Solo inicializamos los listeners y queries si es la primera vez (evita memoria leaks)
            if (!isAppInitialized) {
                initializeRestOfSPA();
                // Ejecución EXCLUSIVA y centralizada de llamadas a Firestore:
                if (typeof window.startRealTimeDashboard === 'function') window.startRealTimeDashboard();
                if (typeof window.startRealTimeHistorial === 'function') window.startRealTimeHistorial();
                if (typeof window.startRealTimeBodegas === 'function') window.startRealTimeBodegas();
                if (typeof window.startRealTimeUsers === 'function') window.startRealTimeUsers();
                if (typeof window.startRealTimeConfig === 'function') window.startRealTimeConfig();
                if (typeof window.startRealTimeInformes === 'function') window.startRealTimeInformes();
                if (typeof window.startRealTimeLogs === 'function') window.startRealTimeLogs();
                if (typeof window.startRealTimeCompras === 'function') window.startRealTimeCompras();

                // Inicializar Predictive Engine Data (90 días)
                const limite90d = new Date();
                limite90d.setDate(limite90d.getDate() - 90);
                // Se usan imports estáticos: collection, query, where, onSnapshot
                const qPred = query(collection(db, 'Historial_Movimientos'), where('date', '>=', limite90d.toISOString()));
                activeListeners.predictive = onSnapshot(qPred, (snap) => {
                    window.globalMovimientosPredictivos = snap.docs.map(d => d.data());
                    // Re-render inventory if it's visible
                    if (document.getElementById('view-inventario').classList.contains('active')) {
                        if (typeof window.loadFirstPage === 'function') window.loadFirstPage();
                    }
                });

                if (typeof window.loadFirstPage === 'function') window.loadFirstPage();

                isAppInitialized = true;
            }
        } else {
            // Refugio blindado: Forzamos la vista de login a visible y la app a oculto
            document.getElementById('login-view').style.display = 'flex';
            document.getElementById('main-app').style.display = 'none';
            isAppInitialized = false;

            // Limpieza estricta de listeners para evitar "permission-denied" de Firebase
            clearListener('dashboard');
            clearListener('expirations');
            clearListener('historial');
            clearListener('bodegas');
            clearListener('usuarios');
            clearListener('config');
            clearListener('informes_kpi');
            clearListener('informes_logs');
            clearListener('logs');
            clearListener('predictive');
            clearListener('compras');
        }
    });

    // 3. ENCAPSULAMIENTO DEL FLUJO SPA
    function initializeRestOfSPA() {
        /* ----------------------------------------------------
           2. NAVEGACIÓN PRINCIPAL (SIDEBAR Y SOPORTE HISTORY API)
           ---------------------------------------------------- */
        const menuItems = document.querySelectorAll('.sidebar .menu-item');
        const viewSections = document.querySelectorAll('.view-section');
        const topbarTitle = document.querySelector('.topbar-title');

        const viewTitles = {
            'view-panel': 'Visor Logístico',
            'view-inventario': 'Visor Logístico',
            'view-compras': 'Gestión de Abastecimiento',
            'view-movimientos': 'Visor Logístico',
            'view-historial': 'Historial de Transacciones',
            'view-informes': 'Informes Logísticos',
            'view-analitico': 'Inteligencia Operativa',
            'view-bodegas': 'Gestión de Bodegas',
            'view-usuarios': 'Gestión de Usuarios',
            'view-configuracion': 'Configuración del Sistema',
            'view-compras': 'Solicitudes de Compra',
            'view-transferencias': 'Transferencias y Auditoría Clínica',
            'view-ajustes': 'Ajustes Críticos de Inventario',
            'view-bandejas': 'Gestión de Bandejas de Turno',
            'view-usuarios': 'Directorio de Personal y Roles'
        };

        // Función unificada que lee el hash y actualiza la UI
        function navigateToHash() {
            if (!auth.currentUser) {
                console.warn("[Router] Bloqueado: Usuario no autenticado.");
                const allSections = document.querySelectorAll('.view-section');
                allSections.forEach(section => {
                    section.style.display = 'none';
                });
                return;
            }

            // Obtenemos el hash sin el '#' y damos 'view-panel' por defecto
            let hash = window.location.hash.substring(1) || 'view-panel';

            let targetItem = document.querySelector(`.sidebar .menu-item[data-target="${hash}"]`);

            // Si el hash ingresado no existe (ej. error manual), lo reseteamos al home
            if (!targetItem) {
                hash = 'view-panel';
                targetItem = document.querySelector(`.sidebar .menu-item[data-target="view-panel"]`);
            }

            // Activación de menú
            menuItems.forEach(i => { i.classList.remove('active'); i.classList.add('normal'); });
            if (targetItem) {
                targetItem.classList.add('active');
                targetItem.classList.remove('normal');
            }

            // Activación de vista central (ROUTER SPA HARDENED)
            const allSections = document.querySelectorAll('.view-section');
            allSections.forEach(section => {
                section.style.display = 'none';
                section.classList.remove('active');
            });

            const activeView = document.getElementById(hash);
            if (activeView) {
                activeView.style.display = 'block';
                activeView.classList.add('active');

                if (hash === 'view-informes') {
                    console.log("[Router] Entrando a Informes, disparando carga de auditoría...");
                    loadInformesAuditoria();
                } else if (hash === 'view-inventario') {
                    console.log("[Router] Vista Inventario activa. Cargando página...");
                    if (typeof window.loadFirstPage === 'function') window.loadFirstPage();
                } else if (hash === 'view-historial') {
                    console.log("[Router] Vista Historial activa.");
                } else if (hash === 'view-bodegas') {
                    console.log("[Router] Vista Bodegas activa.");
                } else if (hash === 'view-usuarios') {
                    console.log("[Router] Vista Usuarios activa.");
                    if (typeof window.escucharUsuarios === 'function') window.escucharUsuarios();
                } else if (hash === 'view-transferencias') {
                    console.log("[Router] Vista Transferencias activa.");
                } else if (hash === 'view-compras') {
                    console.log("[Router] Vista Compras activa.");
                }
            }

            // Actualización de título superior
            if (topbarTitle && viewTitles[hash]) {
                topbarTitle.textContent = viewTitles[hash];
            }
        }

        // Escuchamos el evento de retroceso/avance del navegador
        window.addEventListener('hashchange', () => {
            navigateToHash();
            showToast('Navegación', 'Vista actualizada correctamente.', 'info');
        });

        // Eventos de clic de botones que alteran la URL
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = item.getAttribute('data-target');

                // Tratamiento de botones sin routing (Logout, Config)
                if (!targetId) {
                    if (item.classList.contains('danger')) {
                        showToast('Cierre de Sesión', 'Cerrando sesión y liberando recursos...', 'warning');
                        clearAllListeners(); // Limpiar memoria antes de salir
                        signOut(auth); // Cerramos sesión de Firebase
                    } else {
                        showToast('Configuración', 'Preparando entorno de configuración...', 'info');
                    }
                    return;
                }

                // Cambiar hash sin recargar la página desencadena NavigateToHash automáticamente
                // Solo logueamos y modificamos si el hash no era idéntico (para no redundar)
                if (window.location.hash !== `#${targetId}`) {
                    window.location.hash = targetId;
                    showToast('Navegación', `Cargando módulo: ${item.textContent.trim()}`, 'info');
                }
            });
        });

        // Gatillar la verificación de URL inicial al cargar (o recargar) la página
        navigateToHash();

        /* ----------------------------------------------------
           3. FUNCIONALIDAD GLOBAL PARA TODOS LOS BOTONES Y ENLACES
           ---------------------------------------------------- */
        document.body.addEventListener('click', (e) => {
            const link = e.target.closest('a[href="#"]');
            if (link) e.preventDefault();

            const btn = e.target.closest('button');
            if (!btn) return;

            // CORRECCIÓN ESTRUCTURAL: Si es submit de form, dejar que el form handler lo maneje
            if (btn.type === 'submit' && btn.closest('form')) return;
            if (btn.id === 'btn-ia-analisis') return;

            if (btn.classList.contains('page-btn')) {
                e.preventDefault();
                const paginationContainer = btn.parentElement;
                paginationContainer.querySelectorAll('.page-btn').forEach(b => b.classList.remove('active'));
                if (!btn.querySelector('i')) { btn.classList.add('active'); }
                showToast('Paginación', 'Cambiando de página de resultados a la número ' + btn.textContent.trim(), 'info');
                return;
            }

            if (btn.classList.contains('btn-icon') || btn.classList.contains('btn-icon-outline') || (btn.classList.contains('icon-btn') && !btn.classList.contains('close-modal-btn'))) {
                e.preventDefault();
                const isTrash = btn.querySelector('.ph-trash');
                const isEdit = btn.querySelector('.ph-pencil-simple');
                const isEye = btn.querySelector('.ph-eye');
                const isFilter = btn.querySelector('.ph-funnel');
                const isBell = btn.querySelector('.ph-bell');
                const isQuestion = btn.querySelector('.ph-question');

                if (isTrash) { showToast('Acceso Denegado', 'Esta acción requiere credenciales de administrador.', 'error'); }
                else if (isEdit) { showToast('Edición Habilitada', 'Generando interfaz de modificación.', 'info'); }
                else if (isEye) { showToast('Vista Activa', 'Desplegando documento de respaldo.', 'success'); }
                else if (isFilter) { showToast('Filtrado', 'Desplegando opciones avanzadas.', 'info'); }
                else if (isBell) { showToast('Notificaciones', 'Bandeja de notificaciones sin mensajes nuevos.', 'info'); }
                else if (isQuestion) { showToast('Ayuda y Soporte', 'Abriendo portal de documentación clínica.', 'info'); }
                else { showToast('Acción', 'Operación secundaria exitosa.', 'success'); }
                return;
            }

            if (btn.classList.contains('btn-primary') || btn.classList.contains('btn-outline')) {
                e.preventDefault();
                const text = btn.textContent.trim();
                if (text.includes('Exportar')) {
                    showToast('Operación iniciada', 'Preparando documento logístico ' + text.split(' ')[1] + '...', 'info');
                    setTimeout(() => showToast('Completado', 'Documento creado y descargado.', 'success'), 1500);
                } else if (text.includes('ALTERNATIVA')) {
                    showToast('Buscador IA', 'Localizando sustitutos viables en sucursales anexas.', 'info');
                } else {
                    showToast('Proceso Ejecutado', 'La función [' + (text || 'Confirmar') + '] ha sido validada.', 'info');
                }
            }
        });

        /* ----------------------------------------------------
           4. PANEL DE CONTROL (Botón IA)
           Handler delegado a handleAnalisisIA() — definido en sección 8e
           ---------------------------------------------------- */
        const analyzeBtn = document.getElementById('btn-ia-analisis');
        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', () => handleAnalisisIA());
        }

        /* ----------------------------------------------------
           5. TOPBAR TABS & SUB-TABS
           ---------------------------------------------------- */
        const topbarTabs = document.querySelectorAll('.topbar-tabs .tab');
        topbarTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                topbarTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                showToast('Filtro Global', `Contexto cambiado a: ${tab.textContent.trim()}`, 'info');
            });
        });

        const informesTabs = document.querySelectorAll('.tab-links-container .tab-link');
        informesTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                informesTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                showToast('Vista de Informes', `Sección ${tab.textContent.trim()} activada.`, 'info');
            });
        });

        /* ----------------------------------------------------
           6. MOVIMIENTOS (Botones Toggle - Corrección CSS)
           ---------------------------------------------------- */
        const toggleBtns = document.querySelectorAll('.toggle-btn');
        toggleBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleBtns.forEach(t => t.classList.remove('active-green', 'active-blue'));

                if (btn.textContent.includes('RECEPCIÓN')) {
                    btn.classList.add('active-green');
                    showToast('Tipo de Ingreso', 'Registrando como ENTRADA de suministros.', 'success');
                    const inputTipo = document.getElementById('movimiento-tipo');
                    if (inputTipo) inputTipo.value = 'entrada';
                } else {
                    btn.classList.add('active-blue');
                    showToast('Tipo de Despacho', 'Registrando como SALIDA / TRANSFERENCIA.', 'info');
                    const inputTipo = document.getElementById('movimiento-tipo');
                    if (inputTipo) inputTipo.value = 'salida';
                }
            });
        });

        /* ----------------------------------------------------
           6b. BÚSQUEDA Y FILTRADO MOCKUP
           ---------------------------------------------------- */
        document.body.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                const input = e.target;
                if (input.tagName === 'INPUT' && input.closest('.search-input-wrapper')) {
                    if (input.value.trim() !== '') {
                        showToast('Buscador', `Filtrando resultados para: "${input.value}"...`, 'info');
                    }
                }
            }
        });

        document.body.addEventListener('change', (e) => {
            if (e.target.tagName === 'SELECT') {
                showToast('Filtros Actualizados', `Vista cambiada a: ${e.target.options[e.target.selectedIndex].text}`, 'info');
            }
        });

        /* ----------------------------------------------------
           7. FORMULARIOS 
           ---------------------------------------------------- */
        const formUsuarios = document.getElementById('form-usuarios');
        if (formUsuarios) {
            formUsuarios.addEventListener('submit', (e) => {
                e.preventDefault();
                const btn = formUsuarios.querySelector('button[type="submit"]');
                const originalText = btn.innerHTML;

                btn.innerHTML = '<i class="ph-fill ph-check-circle"></i> Usuario Creado';
                btn.style.backgroundColor = 'var(--success)';
                btn.style.borderColor = 'var(--success)';
                showToast('Registro Confirmado', 'El usuario ha sido matriculado en la base de datos.', 'success');
                formUsuarios.reset();

                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.backgroundColor = 'var(--primary)';
                    btn.style.borderColor = 'var(--primary)';
                }, 2500);
            });
        }

        const formMovimiento = document.getElementById('form-movimiento');
        if (formMovimiento) {
            formMovimiento.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = formMovimiento.querySelector('button[type="submit"]');
                const originalText = btn.innerHTML;

                // 1. Capturar datos nativamente sin librerías externas
                const formData = new FormData(formMovimiento);
                const movementData = Object.fromEntries(formData.entries());

                // Transformaciones / Validaciones Ciberseguras Frontend
                const quantity = parseInt(movementData.quantity, 10);
                const articleId = movementData.articleId;
                const isInput = movementData.movementType === 'entrada';

                // a) Validación de Seguridad: Inyección de nulos o valores ilógicos
                if (!articleId) {
                    showToast('Bloqueo de Seguridad', 'Debe seleccionar un insumo clínico válido.', 'error');
                    return;
                }

                if (isNaN(quantity) || quantity <= 0) {
                    showToast('Detección de Anomalía', 'No se permiten registros con cantidad nula o negativa.', 'danger');
                    return;
                }

                // b) Validación de Riesgo Clínico: Lotes Caducados
                if (isInput && movementData.expirationDate) {
                    // Limpiamos los tiempos para comparar sólo días (UTC-neutral padding)
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);

                    const expDate = new Date(movementData.expirationDate + "T00:00:00");

                    if (expDate < today) {
                        showToast('Riesgo Clínico Bloqueado', 'Prohibido registrar la entrada de lotes vencidos en el sistema.', 'danger');
                        return;
                    }
                }

                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> PROCESANDO TRANSACCIÓN...';
                btn.disabled = true;

                try {
                    // 2. Ejecutar a través del servicio de auditoría centralizado
                    await withRetry(async () => {
                        const quantityDiff = isInput ? quantity : -quantity;

                        // Actualizar maestro con auditoría atómicamente
                        const { oldQty: currentStock, newQty: newStock } = await updateInventoryWithAudit(articleId, { quantityDiff }, auth.currentUser);

                        // Registrar en Historial Global
                        // Registrar en Historial Global con Schema Standard
                        await addDoc(collection(db, 'Historial_Movimientos'), {
                            date: serverTimestamp(),
                            type: isInput ? 'entrada' : 'salida',
                            insumoName: movementData.articleName || 'Insumo Modificado',
                            user: auth.currentUser?.email || auth.currentUser?.uid || 'Admin',
                            batch: movementData.batch || 'S/L',
                            quantity: Number(quantity),
                            document: movementData.supportDocument || 'S/D',
                            previousStock: currentStock,
                            newStock: newStock
                        });
                    }, 3, 2000);

                    // Notificación de Éxito UI
                    btn.innerHTML = 'TRANSACCIÓN CONFIRMADA <i class="ph-fill ph-check-circle"></i>';
                    btn.style.backgroundColor = 'var(--success)';
                    showToast('Operación Exitosa', 'Inventario sincronizado y bitácora actualizada con auditoría.', 'success');
                    formMovimiento.reset();

                } catch (error) {
                    console.error("Transacción Abortada:", error);
                    const errorMsg = error.code === 'abort_no_retry'
                        ? error.message
                        : 'La transacción no pudo completarse. Revise su conexión.';

                    showToast('Error de Transacción', errorMsg, 'error');
                    btn.style.backgroundColor = 'var(--danger)';
                } finally {
                    btn.disabled = false;
                    setTimeout(() => {
                        btn.innerHTML = originalText;
                        btn.style.backgroundColor = '';
                    }, 3500);
                }
            });
        }

        const formBodegas = document.getElementById('form-bodegas');
        if (formBodegas) {
            formBodegas.addEventListener('submit', (e) => {
                e.preventDefault();
                const btn = formBodegas.querySelector('button[type="submit"]');
                const originalText = btn.innerHTML;

                btn.innerHTML = '<i class="ph-fill ph-check-circle"></i> Bodega Registrada';
                btn.style.backgroundColor = 'var(--success)';
                showToast('Nuevo Recinto Habilitado', 'La bodega se ha anexado a la red de distribución.', 'success');
                formBodegas.reset();

                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.backgroundColor = 'var(--primary)';
                }, 2500);
            });
        }

        /* ----------------------------------------------------
           8. MODAL DE BODEGAS
           ---------------------------------------------------- */
        const bodegaCards = document.querySelectorAll('.card.clickable-card');
        const bodegaModal = document.getElementById('bodega-modal');

        if (bodegaModal) {
            const closeBtns = bodegaModal.querySelectorAll('.close-modal-btn');
            closeBtns.forEach(btn => btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                bodegaModal.classList.remove('active');
            }));

            bodegaCards.forEach(card => {
                card.addEventListener('click', () => {
                    const name = card.getAttribute('data-bodega');
                    const type = card.getAttribute('data-type');
                    const stock = card.getAttribute('data-stock');

                    document.getElementById('modal-bodega-name').textContent = name;
                    document.getElementById('modal-bodega-type').textContent = type;
                    document.getElementById('modal-bodega-stock').textContent = stock;

                    let color = 'var(--primary)';
                    if (type.includes('PUNTO')) color = 'var(--success)';
                    if (type.includes('SECUNDARIA')) color = 'var(--purple)';
                    document.getElementById('modal-bodega-type').style.color = color;

                    bodegaModal.classList.add('active');
                });
            });
        }

        /* ----------------------------------------------------
           8b. MOTOR DE MODALES CENTRALIZADO
           ---------------------------------------------------- */

        function openModal(modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return;
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
        window.openModal = openModal;

        function closeModal(modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return;
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
        window.closeModal = closeModal;

        // Event Delegation: un solo listener para TODOS los modales (presentes y futuros)
        document.addEventListener('click', (e) => {
            const closeBtn = e.target.closest('.close-modal-btn');
            if (closeBtn) {
                const modal = closeBtn.closest('.modal-overlay');
                if (modal) { e.preventDefault(); closeModal(modal.id); }
            }
            // Clic directo en el overlay oscuro (fuera de la card)
            if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('active')) {
                closeModal(e.target.id);
            }
        });

        // Cerrar con tecla Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay.active')
                    .forEach(m => closeModal(m.id));
            }
        });

        /* ----------------------------------------------------
           8c. HANDLER: VER REPORTE DE DESCARTE
           ---------------------------------------------------- */
        async function handleReporteDescarte() {
            openModal('modal-reporte-descarte');
            const tbody = document.getElementById('modal-descarte-tbody');
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:32px;">
            <i class="ph-spinner ph-spin" style="font-size:28px; color:var(--danger);"></i>
            <p style="margin-top:8px; color:var(--text-muted); font-size:13px;">Consultando registros urgentes en Firestore...</p>
        </td></tr>`;

            try {
                const hoy = new Date();
                const limite = new Date();
                limite.setDate(hoy.getDate() + 30);
                const todayStr = hoy.toISOString().split('T')[0];
                const limiteStr = limite.toISOString().split('T')[0];

                const currentRole = document.body.getAttribute('data-user-role');
        let q;
        if (currentRole === 'enfermero') {
            q = query(
                collection(db, 'Bandejas_Turno'),
                where('enfermeroAsignado', '==', auth.currentUser.email),
                where('estado', 'in', ['CREADA', 'EN_USO'])
            );
        } else {
            q = query(
                collection(db, 'Bandejas_Turno'),
                where('estado', 'in', ['CREADA', 'EN_USO', 'CERRADA_ENFERMERIA'])
            );
        }

        unsubMisBandejas = onSnapshot(q, (snapshot) => {
            const container = document.getElementById('lista-mis-bandejas');
            if (!container) return;
            container.innerHTML = '';

            if (snapshot.empty) {
                container.innerHTML = '<div class="text-center text-muted" style="padding: 20px;">No tienes bandejas asignadas pendientes.</div>';
                return;
            }

            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                const div = document.createElement('div');
                div.className = 'data-table-card';
                div.style.padding = '16px';
                div.style.marginBottom = '16px';

                let html = `
                    <div style="display:flex; justify-content:space-between; margin-bottom:12px; border-bottom:1px solid #eee; padding-bottom:12px;">
                        <div>
                            <strong>Bandeja:</strong> ${data.identificador || docSnap.id.substring(0, 8)}<br>
                            <span class="text-muted text-sm">Creada por: ${data.creadoPor}</span>
                        </div>
                        <div>
                            <span class="badge" style="background:${data.estado === 'CREADA' ? 'var(--warning)' : 'var(--success)'}; color:#000;">
                                ESTADO: ${data.estado}
                            </span>
                        </div>
                    </div>
                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>FÁRMACO</th>
                                    <th>ASIGNADO</th>
                                    ${data.estado === 'CREADA' ? '<th>RECIBIDO (FÍSICO)</th><th>OBSERVACIÓN (Obligatoria si difiere)</th>' : ''}
                                </tr>
                            </thead>
                            <tbody>
                `;

                data.medicamentos.forEach((med, idx) => {
                    
                if (data.estado === 'EN_USO' && document.body.getAttribute('data-user-role') === 'enfermero') {
                    html += `
                        <div style="margin-top: 16px; display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #dee2e6;">
                            <button class="btn btn-outline-primary" onclick="window.abrirModalConsumo('${docSnap.id}')" style="font-weight: 500;">
                                <i class="ph ph-pill"></i> Registrar Consumo / Merma
                            </button>
                            <button class="btn btn-warning" onclick="window.abrirCierreTurno('${docSnap.id}')" style="font-weight: bold; background: #ffc107; color: #000;">
                                <i class="ph ph-lock-key"></i> Cuadratura y Cierre de Turno
                            </button>
                        </div>
                    `;
                }

                if (data.estado === 'CREADA') {
                        html += `
                            <tr>
                                <td>${med.nombreInsumo || med.nombre}</td>
                                <td>${med.cantidadAsignada}</td>
                                <td>
                                    <input type="number" class="form-control" id="recibido-${docSnap.id}-${idx}" value="${med.cantidadAsignada}" min="0" style="width: 80px;">
                                </td>
                                <td>
                                    <input type="text" class="form-control" id="obs-${docSnap.id}-${idx}" placeholder="Ej: Faltan 2, ampolla rota...">
                                </td>
                            </tr>
                        `;
                    } else {
                        html += `
                            <tr>
                                <td>${med.nombreInsumo || med.nombre}</td>
                                <td>${med.cantidadAsignada}</td>
                            </tr>
                        `;
                    }
                });

                html += `</tbody></table></div>`;
                if (data.estado === 'CERRADA_ENFERMERIA' && document.body.getAttribute('data-user-role') !== 'enfermero') {
                    html += `
                        <div style="margin-top: 16px; text-align: right;">
                            <button class="btn btn-warning" onclick="window.abrirRecepcionBodega('${docSnap.id}')" style="font-weight: bold; color: #000; background: #ffc107;">
                                <i class="ph ph-warehouse"></i> Auditar y Recepcionar Retorno
                            </button>
                        </div>
                    `;
                }


                if (data.estado === 'CREADA') {
                    html += `
                        <div style="margin-top: 16px; text-align: right;">
                            <button class="btn btn-primary" onclick="window.confirmarRecepcionBandeja('${docSnap.id}')">
                                <i class="ph ph-check-square"></i> Confirmar Recepción
                            </button>
                        </div>
                    `;
                }

                div.innerHTML = html;
                container.appendChild(div);
            });
        });
    };

    window.confirmarRecepcionBandeja = async function (docId) {
        try {
            const docRef = doc(db, 'Bandejas_Turno', docId);

            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(docRef);
                if (!docSnap.exists()) {
                    throw new Error("La bandeja no existe o fue eliminada.");
                }

                const data = docSnap.data();
                if (data.estado === 'EN_USO') {
                    throw new Error("Esta bandeja ya fue recepcionada por otro usuario.");
                }

                let hasError = false;

                const medicamentosActualizados = data.medicamentos.map((med, idx) => {
                    const inputRecibido = document.getElementById(`recibido-${docId}-${idx}`);
                    const inputObs = document.getElementById(`obs-${docId}-${idx}`);

                    // Fallback to previous data if inputs don't exist (e.g., another user confirms it)
                    const recibido = inputRecibido ? Number(inputRecibido.value) : med.cantidadAsignada;
                    const obs = inputObs ? inputObs.value.trim() : '';

                    if (recibido !== med.cantidadAsignada && obs === '') {
                        if (inputObs) inputObs.focus();
                        hasError = true;
                    }

                    return {
                        ...med,
                        cantidadRecibida: recibido,
                        observacion: obs
                    };
                });

                if (hasError) {
                    throw new Error("DIFERENCIA_SIN_OBSERVACION");
                }

                transaction.update(docRef, {
                    estado: 'EN_USO',
                    medicamentos: medicamentosActualizados,
                    fechaRecepcion: serverTimestamp()
                });
            });

            window.showToast('Éxito', 'Recepción de bandeja confirmada.', 'success');
        } catch (err) {
            console.error(err);
            if (err.message === "DIFERENCIA_SIN_OBSERVACION") {
                window.showToast('Error', 'Debe indicar una observación debido a la diferencia de cantidad.', 'error');
            } else {
                window.showToast('Error', err.message || 'Fallo al confirmar la recepción.', 'error');
            }
        }
    };

    // Al cambiar la hash, iniciar los listeners de bandejas
    window.addEventListener('hashchange', () => {
        if (window.location.hash === '#view-bandejas') {
            if (document.body.getAttribute('data-user-role') === 'admin' || document.body.getAttribute('data-user-role') === 'superadmin' || document.body.getAttribute('data-user-role') === 'global') {
                window.startBandejasModule();
            }
            window.startMisBandejasListener();
        }
    });

    // ==========================================
    // ==========================================
    // LOGICA DE TURNO (CONSUMO Y MERMA)
    // ==========================================
    window.abrirModalConsumo = async function(docId) {
        window._bandejaActivaId = docId;
        const select = document.getElementById('select-consumo-insumo');
        if (!select) return;
        
        try {
            const docRef = doc(db, 'Bandejas_Turno', docId);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) throw new Error("Bandeja no encontrada");
            
            const data = docSnap.data();
            select.innerHTML = '<option value="">Seleccione Fármaco...</option>';
            data.medicamentos.forEach(med => {
                select.innerHTML += `<option value="${med.nombreInsumo || med.nombre}" data-disponible="${med.cantidadRecibida}">${med.nombreInsumo || med.nombre} (Disp: ${med.cantidadRecibida})</option>`;
            });
            
            document.getElementById('input-consumo-cantidad').value = 1;
            document.getElementById('input-consumo-obs').value = '';
            document.getElementById('modal-consumo-bandeja').style.display = 'flex';
            
        } catch (error) {
            console.error(error);
            window.showToast('Error', 'Fallo al cargar bandeja.', 'error');
        }
    };

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#btn-guardar-consumo')) {
            const select = document.getElementById('select-consumo-insumo');
            const tipo = document.getElementById('select-consumo-tipo').value;
            const cant = Number(document.getElementById('input-consumo-cantidad').value);
            const obs = document.getElementById('input-consumo-obs').value.trim();
            const docId = window._bandejaActivaId;
            
            if (!select.value || cant <= 0) {
                alert("Complete los campos obligatorios.");
                return;
            }
            
            const selectedOption = select.options[select.selectedIndex];
            const disp = Number(selectedOption.getAttribute('data-disponible'));
            if (cant > disp) {
                alert("No hay suficiente stock en la bandeja.");
                return;
            }

            try {
                const btn = e.target.closest('#btn-guardar-consumo');
                btn.disabled = true;
                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Registrando...';
                
                const docRef = doc(db, 'Bandejas_Turno', docId);
                await runTransaction(db, async (transaction) => {
                    const snap = await transaction.get(docRef);
                    if (!snap.exists()) throw new Error("La bandeja no existe.");
                    
                    let data = snap.data();
                    let meds = data.medicamentos;
                    let found = false;
                    for (let i=0; i<meds.length; i++) {
                        if ((meds[i].nombreInsumo || meds[i].nombre) === select.value) {
                            meds[i].cantidadRecibida -= cant;
                            found = true;
                            break;
                        }
                    }
                    
                    if(!found) throw new Error("Fármaco no encontrado en la bandeja.");
                    
                    // Crear registro en la subcoleccion de auditoria de la bandeja
                    const auditRef = doc(collection(docRef, 'Auditoria_Turno'));
                    transaction.set(auditRef, {
                        tipo: tipo,
                        farmaco: select.value,
                        cantidad: cant,
                        observacion: obs,
                        usuario: auth.currentUser.email,
                        fecha: serverTimestamp()
                    });
                    
                    transaction.update(docRef, { medicamentos: meds });
                });
                
                document.getElementById('modal-consumo-bandeja').style.display = 'none';
                window.showToast('Éxito', 'Salida registrada correctamente.', 'success');
                btn.disabled = false;
                btn.innerHTML = '<i class="ph ph-floppy-disk"></i> Registrar Salida';
            } catch (error) {
                console.error(error);
                alert("Error: " + error.message);
                e.target.closest('#btn-guardar-consumo').disabled = false;
                e.target.closest('#btn-guardar-consumo').innerHTML = '<i class="ph ph-floppy-disk"></i> Registrar Salida';
            }
        }
    });

    window.abrirCierreTurno = function(docId) {
        window._bandejaActivaId = docId;
        const inputExcel = document.getElementById('input-excel-cierre');
        if (inputExcel) inputExcel.value = '';
        const res = document.getElementById('resultado-cuadratura');
        if (res) res.style.display = 'none';
        const btn = document.getElementById('btn-finalizar-turno');
        if (btn) btn.style.display = 'none';
        
        document.getElementById('modal-cierre-turno').style.display = 'flex';
    };

    document.addEventListener('change', async (e) => {
        if (e.target.id === 'input-excel-cierre') {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, {type: 'array'});
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    // Usamos {header: 1} para obtener la tabla como matriz 2D y sortear celdas combinadas y saltos de pagina
                    const rows = XLSX.utils.sheet_to_json(sheet, {header: 1});
                    
                    // 1. Buscar indices de columnas
                    let colFarmacos = -1;
                    let colSolicitado = -1;
                    
                    // Recorremos buscando la fila de cabeceras
                    for (let i = 0; i < Math.min(rows.length, 50); i++) {
                        const row = rows[i];
                        if (!row) continue;
                        
                        for (let j = 0; j < row.length; j++) {
                            const val = String(row[j] || '').trim().toLowerCase();
                            if (val === 'fármacos' || val === 'insumos') colFarmacos = j;
                            if (val === 'cantidad realizada') colSolicitado = j;
                        }
                        
                        if (colFarmacos !== -1 && colSolicitado !== -1) break;
                    }
                    
                    if (colFarmacos === -1 || colSolicitado === -1) {
                        throw new Error("No se encontraron las columnas 'Fármacos' (o 'Insumos') y 'Cantidad realizada' en el Excel.");
                    }
                    
                    // 2. Extraer data
                    const rayenData = {};
                    for (let i = 0; i < rows.length; i++) {
                        const row = rows[i];
                        if (!row) continue;
                        const nombre = String(row[colFarmacos] || '').trim();
                        // Ignorar filas vacias o cabeceras o paginacion
                        if (!nombre || nombre.toLowerCase() === 'fármacos' || nombre.toLowerCase() === 'insumos' || nombre.toLowerCase().startsWith('página')) {
                            continue;
                        }
                        
                        const qtyStr = String(row[colSolicitado] || '0').trim();
                        const qty = Number(qtyStr);
                        
                        if (!isNaN(qty)) {
                            // Normalizar nombre: minusculas, sin tildes
                            const normName = nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                            rayenData[normName] = {
                                originalName: nombre,
                                totalSolicitado: qty
                            };
                        }
                    }
                    
                    console.log("Datos extraidos de RAYEN:", rayenData);
                    
                    // 3. Obtener consumos de la bandeja de VISOR
                    const docId = window._bandejaActivaId;
                    const docRef = doc(db, 'Bandejas_Turno', docId);
                    const docSnap = await getDoc(docRef);
                    if (!docSnap.exists()) throw new Error("Bandeja no encontrada en VISOR.");
                    
                    const bandeja = docSnap.data();
                    const visorData = {};
                    
                    bandeja.medicamentos.forEach(med => {
                        const nombre = med.nombreInsumo || med.nombre;
                        const normName = nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                        
                        // Consumo = Asignado Original - Recibido Actual (porque las salidas restan a cantidadRecibida)
                        const asignado = Number(med.cantidadAsignada || 0);
                        const restante = Number(med.cantidadRecibida || 0);
                        const consumido = asignado - restante;
                        
                        visorData[normName] = {
                            originalName: nombre,
                            consumido: consumido,
                            restante: restante,
                            asignado: asignado
                        };
                    });
                    
                    // 4. Hacer Match
                    const matchResults = [];
                    // Revisar lo de VISOR vs RAYEN
                    for (const normName in visorData) {
                        const vData = visorData[normName];
                        if (rayenData[normName]) {
                            const rData = rayenData[normName];
                            const diff = vData.consumido - rData.totalSolicitado;
                            let estadoStr = '';
                            let estadoColor = '';
                            if (diff === 0) {
                                estadoStr = 'Completado / Sin Inconsistencias';
                                estadoColor = 'var(--success)';
                            } else {
                                estadoStr = 'Diferencia';
                                estadoColor = 'var(--danger)';
                            }
                            matchResults.push({
                                normName: normName,
                                visorName: vData.originalName,
                                rayenName: rData.originalName,
                                consumidoVisor: vData.consumido,
                                solicitadoRayen: rData.totalSolicitado,
                                estado: estadoStr,
                                color: estadoColor,
                                diff: diff,
                                requiereObs: diff !== 0
                            });
                            // Marcar como procesado en rayenData
                            rayenData[normName].procesado = true;
                        } else {
                            if (vData.consumido > 0) {
                                matchResults.push({
                                    normName: normName,
                                    visorName: vData.originalName,
                                    rayenName: 'No existe en reporte',
                                    consumidoVisor: vData.consumido,
                                    solicitadoRayen: 0,
                                    estado: 'Faltante en Reporte',
                                    color: 'var(--warning)',
                                    diff: vData.consumido,
                                    requiereObs: true
                                });
                            }
                        }
                    }
                    
                    // Revisar lo que quedó en RAYEN y no está en VISOR
                    for (const normName in rayenData) {
                        const rData = rayenData[normName];
                        if (!rData.procesado && rData.totalSolicitado > 0) {
                            matchResults.push({
                                normName: normName,
                                visorName: 'No existe en bandeja',
                                rayenName: rData.originalName,
                                consumidoVisor: 0,
                                solicitadoRayen: rData.totalSolicitado,
                                estado: 'Faltante en Bandeja',
                                color: 'var(--warning)',
                                diff: -rData.totalSolicitado,
                                requiereObs: true
                            });
                        }
                    }
                    
                    // 5. Renderizar Tabla de Cuadratura
                    let tableHtml = `
                        <h4 style="margin-top: 0;">Resumen de Cruce (VISOR vs RAYEN)</h4>
                        <div class="table-responsive" style="max-height: 300px; overflow-y: auto;">
                            <table class="table table-hover">
                                <thead style="position: sticky; top: 0; background: #f8f9fa;">
                                    <tr>
                                        <th>Insumo / Fármaco</th>
                                        <th>Visor (Consumido)</th>
                                        <th>Rayen (Solicitado)</th>
                                        <th>Estado</th>
                                        <th>Justificación (Si hay diferencia)</th>
                                    </tr>
                                </thead>
                                <tbody>
                    `;
                    
                    let tieneDiferencias = false;
                    
                    matchResults.forEach((res, idx) => {
                        if (res.requiereObs) tieneDiferencias = true;
                        
                        tableHtml += `
                            <tr style="background: ${res.color}15;">
                                <td style="font-size: 0.9em;">
                                    <strong>V:</strong> ${res.visorName}<br>
                                    <strong>R:</strong> ${res.rayenName}
                                </td>
                                <td style="font-size: 1.1em; font-weight: bold; text-align: center;">${res.consumidoVisor}</td>
                                <td style="font-size: 1.1em; font-weight: bold; text-align: center;">${res.solicitadoRayen}</td>
                                <td><span class="badge" style="background: ${res.color}; color: #fff;">${res.estado}</span></td>
                                <td>
                                    ${res.requiereObs ? 
                                        `<input type="text" class="form-control obs-cruce" data-idx="${idx}" placeholder="Indique motivo de diferencia" style="min-width: 150px;">` : 
                                        '<span style="color: #6c757d; font-size: 0.85em;">No requiere</span>'
                                    }
                                </td>
                            </tr>
                        `;
                    });
                    
                    tableHtml += `</tbody></table></div>`;
                    
                    const resDiv = document.getElementById('resultado-cuadratura');
                    resDiv.style.display = 'block';
                    resDiv.innerHTML = tableHtml;
                    
                    window._matchResults = matchResults;
                    
                    document.getElementById('btn-finalizar-turno').style.display = 'inline-block';
                    
                    // Validar justificaciones al cerrar
                    window._checkJustificaciones = () => {
                        const inputs = document.querySelectorAll('.obs-cruce');
                        let allFilled = true;
                        inputs.forEach(inp => {
                            if (!inp.value.trim()) allFilled = false;
                        });
                        return allFilled;
                    };
                    
                    // Guardar observaciones en el json final
                    window._getMatchFinalData = () => {
                        const finalData = JSON.parse(JSON.stringify(matchResults));
                        const inputs = document.querySelectorAll('.obs-cruce');
                        inputs.forEach(inp => {
                            const i = Number(inp.getAttribute('data-idx'));
                            finalData[i].observacionCierre = inp.value.trim();
                        });
                        return finalData;
                    };
                    
                } catch(err) {
                    alert("Error leyendo Excel: " + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        }
    });

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#btn-finalizar-turno')) {
            const docId = window._bandejaActivaId;
            if(!docId) return;
            if(!confirm("¿Está seguro de cerrar el turno y enviar la bandeja a Bodega Central?")) return;
            
            if (window._checkJustificaciones && !window._checkJustificaciones()) {
                alert("Debe completar todas las justificaciones obligatorias para las diferencias.");
                return;
            }
            
            try {
                const btn = e.target.closest('#btn-finalizar-turno');
                btn.disabled = true;
                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Finalizando...';
                
                const finalCruce = window._getMatchFinalData ? window._getMatchFinalData() : [];
                
                const docRef = doc(db, 'Bandejas_Turno', docId);
                await updateDoc(docRef, {
                    estado: 'CERRADA_ENFERMERIA',
                    fechaCierre: serverTimestamp(),
                    cruceCierreTurno: finalCruce,
                    excelRawLength: window._excelData ? window._excelData.length : 0
                });
                
                document.getElementById('modal-cierre-turno').style.display = 'none';
                window.showToast('Turno Cerrado', 'La bandeja ha sido devuelta a Bodega Central.', 'success');
                btn.disabled = false;
                btn.innerHTML = '🔒 Entregar Bandeja a Bodega';
            } catch (error) {
                console.error(error);
                alert("Error: " + error.message);
                e.target.closest('#btn-finalizar-turno').disabled = false;
                e.target.closest('#btn-finalizar-turno').innerHTML = '🔒 Entregar Bandeja a Bodega';
            }
        }
    });

    // ==========================================

    // ==========================================
    // RECEPCION EN BODEGA (OPERADOR)
    // ==========================================
    window.abrirRecepcionBodega = async function(docId) {
        window._recepcionBodegaId = docId;
        const cruceDiv = document.getElementById('recepcion-bodega-cruce');
        const fisicaDiv = document.getElementById('recepcion-bodega-fisica');
        if (!cruceDiv || !fisicaDiv) return;
        
        try {
            const docRef = doc(db, 'Bandejas_Turno', docId);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) throw new Error("Bandeja no encontrada");
            
            const data = docSnap.data();
            const cruceData = data.cruceCierreTurno || [];
            
            // 1. Renderizar tabla de cruce
            let cruceHtml = `
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead style="background: #f8f9fa;">
                            <tr>
                                <th>Insumo</th>
                                <th>Consumo (Visor)</th>
                                <th>Solicitado (Rayen)</th>
                                <th>Estado</th>
                                <th>Justificación de Enfermería</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            if (cruceData.length === 0) {
                cruceHtml += `<tr><td colspan="5" class="text-center">No hay datos de cruce disponibles.</td></tr>`;
            } else {
                cruceData.forEach(res => {
                    cruceHtml += `
                        <tr style="background: ${res.color}15;">
                            <td style="font-size: 0.85em;">
                                <strong>V:</strong> ${res.visorName}<br>
                                <strong>R:</strong> ${res.rayenName}
                            </td>
                            <td style="font-weight: bold; text-align: center;">${res.consumidoVisor}</td>
                            <td style="font-weight: bold; text-align: center;">${res.solicitadoRayen}</td>
                            <td><span class="badge" style="background: ${res.color}; color: #fff;">${res.estado}</span></td>
                            <td style="font-size: 0.9em; font-style: italic; color: #555;">${res.observacionCierre || 'N/A'}</td>
                        </tr>
                    `;
                });
            }
            cruceHtml += `</tbody></table></div>`;
            cruceDiv.innerHTML = cruceHtml;
            
            // 2. Renderizar tabla física
            let fisicaHtml = `
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead style="background: #f8f9fa;">
                            <tr>
                                <th>Fármaco Original de Bandeja</th>
                                <th>Stock Esperado (Teórico)</th>
                                <th>Recepción Física (Real)</th>
                                <th>Obs (Si difiere)</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            data.medicamentos.forEach((med, idx) => {
                const nombre = med.nombreInsumo || med.nombre;
                const esperado = Number(med.cantidadRecibida || 0); // Esto es lo que quedó despues de mermas/consumos
                
                fisicaHtml += `
                    <tr>
                        <td style="font-weight: bold;">${nombre}</td>
                        <td style="text-align: center; font-size: 1.1em; color: var(--primary);">${esperado}</td>
                        <td>
                            <input type="number" class="form-control input-recepcion-real" data-idx="${idx}" data-esperado="${esperado}" data-nombre="${nombre}" value="${esperado}" min="0" style="width: 80px;">
                        </td>
                        <td>
                            <input type="text" class="form-control input-recepcion-obs" data-idx="${idx}" placeholder="Motivo de diferencia">
                        </td>
                    </tr>
                `;
            });
            
            fisicaHtml += `</tbody></table></div>`;
            fisicaDiv.innerHTML = fisicaHtml;
            
            document.getElementById('modal-recepcion-bodega').style.display = 'flex';
            
        } catch (error) {
            console.error(error);
            window.showToast('Error', error.message, 'error');
        }
    };

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#btn-confirmar-recepcion-bodega')) {
            const docId = window._recepcionBodegaId;
            if(!docId) return;
            
            // Validar que las diferencias tengan observación
            const inputsReal = document.querySelectorAll('.input-recepcion-real');
            const inputsObs = document.querySelectorAll('.input-recepcion-obs');
            
            let isValid = true;
            let mermasExtras = [];
            let stockARetornar = [];
            
            inputsReal.forEach(inp => {
                const idx = inp.getAttribute('data-idx');
                const esperado = Number(inp.getAttribute('data-esperado'));
                const real = Number(inp.value);
                const nombre = inp.getAttribute('data-nombre');
                
                const obsInput = Array.from(inputsObs).find(o => o.getAttribute('data-idx') === idx);
                const obs = obsInput ? obsInput.value.trim() : '';
                
                if (real !== esperado && !obs) {
                    isValid = false;
                }
                
                if (real > 0) {
                    stockARetornar.push({ nombre, cantidad: real });
                }
                
                if (real < esperado) {
                    const diff = esperado - real;
                    mermasExtras.push({ nombre, cantidad: diff, observacion: obs });
                } else if (real > esperado) {
                     // Caso raro: devuelve mas de lo esperado.
                     const diff = real - esperado;
                     mermasExtras.push({ nombre, cantidad: -diff, observacion: obs + " (Sobrante no reportado)"});
                }
            });
            
            if (!isValid) {
                alert("Debe ingresar una observación para todas las cantidades físicas que difieran del stock teórico esperado.");
                return;
            }
            
            if(!confirm("¿Confirmar la recepción final de esta bandeja? El stock físico ingresado será sumado al Inventario Central.")) return;
            
            try {
                const btn = e.target.closest('#btn-confirmar-recepcion-bodega');
                btn.disabled = true;
                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Procesando...';
                
                const docRef = doc(db, 'Bandejas_Turno', docId);
                const invRef = collection(db, 'Inventario_Central');
                
                await runTransaction(db, async (transaction) => {
                    const snap = await transaction.get(docRef);
                    if (!snap.exists()) throw new Error("La bandeja no existe.");
                    
                    // 1. Obtener items actuales del inventario central para sumar
                    const invQuery = query(invRef);
                    const invDocs = await getDocs(invQuery);
                    let centralStock = {};
                    let docIdsMap = {};
                    invDocs.forEach(d => {
                        const data = d.data();
                        const key = (data.nombreInsumo || data.nombre || '').toLowerCase().trim();
                        centralStock[key] = data.cantidadRecibida || 0;
                        docIdsMap[key] = d.id;
                    });
                    
                    // 2. Sumar stock a retornar al Inventario_Central
                    for (const item of stockARetornar) {
                        const key = item.nombre.toLowerCase().trim();
                        if (docIdsMap[key]) {
                            const itemRef = doc(db, 'Inventario_Central', docIdsMap[key]);
                            transaction.update(itemRef, {
                                cantidadRecibida: increment(item.cantidad)
                            });
                        } else {
                            // Si no existiera en inventario central, se crea el item (poco comun pero posible)
                            const newItemRef = doc(collection(db, 'Inventario_Central'));
                            transaction.set(newItemRef, {
                                nombreInsumo: item.nombre,
                                nombre: item.nombre,
                                cantidadRecibida: item.cantidad,
                                lpn: 'N/A',
                                lote: 'RETORNO',
                                expirationDate: 'N/A',
                                fechaIngreso: serverTimestamp(),
                                operador: auth.currentUser.email
                            });
                            // Guardar su ID para posibles mermas o movimientos en historial
                            docIdsMap[key] = newItemRef.id;
                        }
                        
                        // Registrar ENTRADA en Historial
                        const histRef = doc(collection(db, 'Historial_Movimientos'));
                        transaction.set(histRef, {
                            tipoAccion: 'ENTRADA',
                            detalle: 'Devolución de Bandeja de Turno (Recepción Física Bodega)',
                            cantidad: item.cantidad,
                            nombreInsumo: item.nombre,
                            documentoRespaldo: 'Bandeja ID: ' + docId.substring(0,8),
                            usuario: auth.currentUser.email,
                            fecha: serverTimestamp(),
                            origen: 'Bandeja de Turno',
                            destino: 'Inventario_Central'
                        });
                    }
                    
                    // 3. Cambiar estado de la bandeja a CERRADA_FINAL
                    transaction.update(docRef, {
                        estado: 'CERRADA_FINAL',
                        fechaRecepcionBodega: serverTimestamp(),
                        operadorReceptor: auth.currentUser.email,
                        mermasRecepcionFisica: mermasExtras
                    });
                });
                
                document.getElementById('modal-recepcion-bodega').style.display = 'none';
                window.showToast('Recepción Exitosa', 'El stock ha retornado al Inventario Central.', 'success');
                btn.disabled = false;
                btn.innerHTML = '<i class="ph ph-check-circle"></i> Confirmar Retorno y Finalizar';
            } catch (error) {
                console.error(error);
                alert("Error al procesar: " + error.message);
                e.target.closest('#btn-confirmar-recepcion-bodega').disabled = false;
                e.target.closest('#btn-confirmar-recepcion-bodega').innerHTML = '<i class="ph ph-check-circle"></i> Confirmar Retorno y Finalizar';
            }
        }
    });

    // KARDEX CLÍNICO INTERACTIVO (TRAZABILIDAD)
    // ==========================================
    let kardexChartInstance = null;

    window.openKardexModal = async function(docId, itemName) {
        if (typeof window.openModal !== 'function') {
            console.error('openModal no disponible');
            return;
        }

        window.openModal('modal-kardex');
        document.getElementById('kardex-subtitle').textContent = itemName;
        
        const stockActualEl = document.getElementById('kardex-stock-actual');
        const consumoPromedioEl = document.getElementById('kardex-consumo-promedio');
        const runwayEl = document.getElementById('kardex-runway');
        const tbody = document.getElementById('kardex-table-body');

        stockActualEl.textContent = '...';
        consumoPromedioEl.textContent = '...';
        runwayEl.textContent = '...';
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;"><i class="ph-spinner ph-spin"></i> Cargando historial analítico...</td></tr>';

        try {
            // 1. Obtener Stock Actual del Insumo
            const insumoDoc = await getDoc(doc(db, 'Insumos', docId));
            let currentStock = 0;
            if (insumoDoc.exists()) {
                currentStock = Number(insumoDoc.data().quantity) || 0;
                stockActualEl.textContent = currentStock;
            }

            // 2. Obtener Historial de Movimientos Globales y filtrar localmente (evita errores de composite index en producción en vivo)
            const limite30d = new Date();
            limite30d.setDate(limite30d.getDate() - 30);
            
            const q = query(collection(db, 'Historial_Movimientos'), orderBy('date', 'desc'), limit(1500));
            const snapshot = await getDocs(q);
            
            const allMovs = snapshot.docs.map(d => {
                const data = d.data();
                const rawDate = data.date || data.timestamp || data.fecha;
                const parsedDate = rawDate?.toDate ? rawDate.toDate() : new Date();
                return { ...data, id: d.id, parsedDate };
            });

            // Filtrar localmente por nombre de insumo (Búsqueda robusta case-insensitive)
            const movs = allMovs.filter(m => {
                const name = m.insumoName || m.articleName || '';
                return name.toLowerCase().includes(itemName.toLowerCase().trim());
            });

            // Llenar tabla
            tbody.innerHTML = '';
            let totalConsumo30d = 0;
            
            // Agrupación para gráfico por día
            const consumptionByDate = {};
            // Llenar últimos 30 días con 0 para que el gráfico no salte
            for (let i=29; i>=0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                consumptionByDate[d.toLocaleDateString('es-CL')] = 0;
            }

            if (movs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No hay movimientos recientes registrados para este insumo.</td></tr>';
            } else {
                movs.forEach(m => {
                    const dateFmt = m.parsedDate.toLocaleDateString('es-CL');
                    const timeFmt = m.parsedDate.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
                    
                    let baseType = (m.type || m.tipo || 'S/T').toLowerCase();
                    if (baseType === 'carga_masiva_excel') baseType = 'carga masiva';
                    
                    const isSalida = baseType === 'salida';
                    const qty = Number(m.quantity) || 0;

                    if (isSalida && m.parsedDate >= limite30d) {
                        totalConsumo30d += qty;
                        if (consumptionByDate[dateFmt] !== undefined) {
                            consumptionByDate[dateFmt] += qty;
                        }
                    }

                    const typeClass = baseType === 'entrada' ? 'green-badge' : 
                                      baseType === 'traspaso' ? 'blue-badge' : 
                                      baseType === 'ajuste' || baseType === 'carga masiva' ? 'yellow-badge' : 'purple-badge';
                    
                    const qtyClass = baseType === 'entrada' ? 'text-green' : 
                                     baseType === 'salida' ? 'text-red' : 'text-blue';
                    const qtySign = baseType === 'entrada' ? '+' : baseType === 'salida' ? '-' : '';

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><div class="font-bold">${dateFmt}</div><div class="item-category">${timeFmt}</div></td>
                        <td><span class="action-badge ${typeClass}">${baseType.toUpperCase()}</span></td>
                        <td><div class="${qtyClass} font-bold">${qtySign} ${qty}</div></td>
                        <td><div class="item-category" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;" title="${window.escapeHTML(m.batch || m.lote || 'S/L')}">L: ${window.escapeHTML(m.batch || m.lote || 'S/L')}</div></td>
                        <td><div class="item-name" style="font-size:12px">${window.escapeHTML(m.user || m.operatorUid || m.usuario || 'S/I')}</div></td>
                        <td><span class="doc-badge">${window.escapeHTML(m.document || m.supportDocument || 'S/D')}</span></td>
                    `;
                    tbody.appendChild(tr);
                });
            }

            // Cálculos Predictivos
            const consumoDiarioPromedio = totalConsumo30d / 30;
            consumoPromedioEl.textContent = consumoDiarioPromedio > 0 ? consumoDiarioPromedio.toFixed(1) + ' / día' : 'Sin consumo';

            if (consumoDiarioPromedio > 0) {
                const runwayDias = Math.floor(currentStock / consumoDiarioPromedio);
                runwayEl.textContent = runwayDias + ' días';
                runwayEl.style.color = runwayDias < 10 ? 'var(--danger)' : 'var(--success)';
            } else {
                runwayEl.textContent = 'Estable (Sin Salidas)';
                runwayEl.style.color = 'var(--text-muted)';
            }

            // Renderizar Gráfico Analítico
            const ctx = document.getElementById('kardexChart').getContext('2d');
            if (kardexChartInstance) {
                kardexChartInstance.destroy();
            }

            kardexChartInstance = new window.Chart(ctx, {
                type: 'bar',
                data: {
                    labels: Object.keys(consumptionByDate),
                    datasets: [{
                        label: 'Unidades Consumidas (Salidas)',
                        data: Object.values(consumptionByDate),
                        backgroundColor: 'rgba(239, 68, 68, 0.7)',
                        borderColor: 'rgb(239, 68, 68)',
                        borderWidth: 1,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { mode: 'index', intersect: false }
                    },
                    scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 } },
                        x: { display: false } // Ocultar eje X para que sea un mini-sparkline limpio
                    }
                }
            });

        } catch (err) {
            console.error('Error en Kardex:', err);
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:red;">Error al cargar el historial analítico.</td></tr>';
        }
    };

    // ==========================================
    // ESCÁNER DE CÓDIGOS DE BARRAS (HTML5-QRCode)
    // ==========================================
    let html5QrCode = null;
    const btnScanBarcode = document.getElementById('btn-scan-barcode');
    const btnCloseScanner = document.getElementById('btn-close-scanner');
    const scannerContainer = document.getElementById('scanner-container');
    const inputInsumo = document.getElementById('ingreso-insumo');

    if (btnScanBarcode) {
        btnScanBarcode.addEventListener('click', () => {
            if (typeof Html5Qrcode === 'undefined') {
                window.showToast('Error', 'La librería del escáner no se ha cargado correctamente.', 'error');
                return;
            }

            scannerContainer.style.display = 'block';
            
            html5QrCode = new Html5Qrcode("reader");
            
            const qrCodeSuccessCallback = async (decodedText, decodedResult) => {
                // Al escanear con éxito
                window.showToast('Código Detectado', `Buscando insumo con código: ${decodedText}...`, 'info');
                
                // Detener escáner temporalmente
                html5QrCode.stop().then(() => {
                    scannerContainer.style.display = 'none';
                }).catch(err => console.error("Error stopping scanner", err));

                // Buscar en la lista de insumos actuales (lista local cached)
                let foundInsumo = null;
                const datalist = document.getElementById('lista-insumos');
                if (datalist && datalist.options) {
                    for (let i = 0; i < datalist.options.length; i++) {
                        const opt = datalist.options[i];
                        // Buscamos coincidencia exacta o parcial con el código de barras
                        if (opt.value.includes(decodedText) || opt.dataset.code === decodedText) {
                            foundInsumo = opt.value;
                            break;
                        }
                    }
                }

                if (foundInsumo) {
                    inputInsumo.value = foundInsumo;
                    // Disparar evento change para que el sistema auto-llene el resto de campos (si hay listeners)
                    inputInsumo.dispatchEvent(new Event('change'));
                    window.showToast('Éxito', 'Insumo encontrado y seleccionado.', 'success');
                } else {
                    window.showToast('Advertencia', `El código ${decodedText} no coincide con ningún insumo registrado en el sistema.`, 'warning');
                    inputInsumo.value = decodedText; // Lo pegamos por si quiere ingresarlo a mano
                }
            };
            
            const config = { fps: 10, qrbox: { width: 250, height: 150 } };
            
            // Iniciar cámara trasera preferentemente
            html5QrCode.start({ facingMode: "environment" }, config, qrCodeSuccessCallback)
            .catch(err => {
                console.error("Error al iniciar cámara", err);
                window.showToast('Error de Cámara', 'No se pudo acceder a la cámara. Compruebe los permisos.', 'error');
                scannerContainer.style.display = 'none';
            });
        });
    }

    if (btnCloseScanner) {
        btnCloseScanner.addEventListener('click', () => {
            if (html5QrCode) {
                html5QrCode.stop().then(() => {
                    scannerContainer.style.display = 'none';
                }).catch(err => {
                    console.error("Error stopping scanner", err);
                    scannerContainer.style.display = 'none';
                });
            } else {
                scannerContainer.style.display = 'none';
            }
        });
    }
    
    // ==========================================
    // FASE 29/30: PANEL DE USUARIOS Y ROLES (RBAC)
    // ==========================================
    let unsubscribeUsuarios = null;
    
    window.escucharUsuarios = function() {
        const tbody = document.getElementById('tabla-usuarios-body');
        if (!tbody) return;
        
        if (unsubscribeUsuarios) {
            unsubscribeUsuarios();
        }
        
        const q = query(collection(db, 'Usuarios'), orderBy('fechaRegistro', 'desc'));
        
        unsubscribeUsuarios = onSnapshot(q, (snapshot) => {
            tbody.innerHTML = '';
            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay usuarios registrados.</td></tr>';
                return;
            }
            
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const tr = document.createElement('tr');
                
                let fechaStr = 'N/A';
                if (data.fechaRegistro && data.fechaRegistro.toDate) {
                    fechaStr = data.fechaRegistro.toDate().toLocaleString();
                }
                
                let opcionesRol = '';
                ROLES_SISTEMA.forEach(r => {
                    const seleccionado = (r.id === data.rol) ? 'selected' : '';
                    opcionesRol += `<option value="${r.id}" ${seleccionado}>${r.label}</option>`;
                });
                const selectHtml = `<select class="form-control select-editar-rol" data-email="${docSnap.id}" style="padding: 4px; font-size: 13px;">${opcionesRol}</select>`;
                
                tr.innerHTML = `
                    <td><strong>${data.nombre || 'No registrado'}</strong><br><small class="text-muted" style="font-size:11px;">Agregado el ${fechaStr}</small></td>
                    <td>${data.email || docSnap.id}</td>
                    <td>${selectHtml}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger btn-eliminar-usuario" data-id="${docSnap.id}" title="Eliminar Acceso">
                            <i class="ph ph-trash"></i> Eliminar
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }, (error) => {
            console.error("Error al escuchar usuarios:", error);
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Error al cargar usuarios. Intente recargar.</td></tr>';
        });
    };
    
    document.addEventListener('click', async (e) => {
        // A) Guardar Nuevo Usuario
        if (e.target.closest('#btn-guardar-usuario')) {
            e.preventDefault();
            const inputEmail = document.getElementById('input-nuevo-usuario-email');
            const selectRol = document.getElementById('select-nuevo-usuario-rol');
            const inputNombre = document.getElementById('usuario-nombre');
            if (!inputEmail || !selectRol) return;
            
            let prefijo = inputEmail.value.trim().toLowerCase();
            if (prefijo.endsWith('@cormumel.cl')) {
                prefijo = prefijo.replace('@cormumel.cl', '').trim();
            }
            const rol = selectRol.value;
            const nombre = inputNombre ? inputNombre.value.trim() : '';
            
            if (!prefijo || !rol) {
                window.showAlertCenter("Campos Incompletos", "Por favor, ingrese el correo y seleccione un rol.", true);
                return;
            }
            
            const correoCompleto = prefijo + '@cormumel.cl';
            const btn = e.target.closest('#btn-guardar-usuario');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Guardando...';
            btn.disabled = true;
            
            try {
                const tempPass = "Cormu" + Math.floor(1000 + Math.random() * 9000) + "*";
                
                // Auth Secondary App para evitar desloguear al admin
                const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
                const secondaryAuth = getAuth(secondaryApp);
                await createUserWithEmailAndPassword(secondaryAuth, correoCompleto, tempPass);
                await secondaryAuth.signOut();

                await setDoc(doc(db, 'Usuarios', correoCompleto), {
                    nombre: nombre,
                    email: correoCompleto,
                    rol: rol,
                    fechaRegistro: serverTimestamp(),
                    activo: true
                });

                // Poblado Modal
                const credEmail = document.getElementById('cred-email');
                const credPass = document.getElementById('cred-pass');
                const credRol = document.getElementById('cred-rol');
                if (credEmail) credEmail.textContent = correoCompleto;
                if (credPass) credPass.textContent = tempPass;
                if (credRol) credRol.textContent = rol;
                
                const modalCredenciales = document.getElementById('modal-credenciales-usuario');
                if (modalCredenciales) modalCredenciales.style.display = 'flex';

                inputEmail.value = '';
                selectRol.value = '';
                if(inputNombre) inputNombre.value = '';
            } catch (error) {
                if (error.code === 'auth/email-already-in-use') {
                    // El usuario ya existe en Authentication, solo lo agregamos a Firestore (Sincronización)
                    try {
                        await setDoc(doc(db, 'Usuarios', correoCompleto), {
                            nombre: nombre,
                            email: correoCompleto,
                            rol: rol,
                            fechaRegistro: serverTimestamp(),
                            activo: true
                        });
                        window.showAlertCenter("Sincronización Exitosa", `El usuario ${correoCompleto} ya existía en Firebase Auth. Se ha sincronizado su rol en la base de datos exitosamente.`);
                        inputEmail.value = '';
                        selectRol.value = '';
                        if(inputNombre) inputNombre.value = '';
                    } catch(fsError) {
                        console.error("Error al sincronizar en Firestore:", fsError);
                        window.showAlertCenter("Error de Base de Datos", "Error al registrar en la base de datos. Verifique permisos.", true);
                    }
                } else {
                    console.error("Error al guardar usuario:", error);
                    window.showAlertCenter("Error de Registro", "Error al registrar usuario: " + (error.message || "Error desconocido"), true);
                }
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
            return;
        }
        
        // B) Eliminar Usuario
        if (e.target.closest('.btn-eliminar-usuario')) {
            e.preventDefault();
            const idUsuario = e.target.closest('.btn-eliminar-usuario').getAttribute('data-id');
            if (confirm(`¿Está completamente seguro de eliminar los permisos de ${idUsuario}?`)) {
                try {
                    await deleteDoc(doc(db, 'Usuarios', idUsuario));
                    console.log(`Usuario ${idUsuario} eliminado correctamente.`);
                } catch (error) {
                    console.error("Error al eliminar usuario:", error);
                    alert("❌ Error al eliminar usuario. Verifique permisos.");
                }
            }
            return;
        }
    });

    // C) Editar Rol (Change Delegado)
    document.addEventListener('change', async (e) => {
        if (e.target.classList.contains('select-editar-rol')) {
            const email = e.target.getAttribute('data-email');
            const nuevoRol = e.target.value;
            
            try {
                await updateDoc(doc(db, 'Usuarios', email), {
                    rol: nuevoRol
                });
                if (typeof showToast === 'function') {
                    showToast('Roles Actualizados', `Se ha asignado el rol ${nuevoRol} a ${email}.`, 'success');
                } else {
                    console.log(`Se ha asignado el rol ${nuevoRol} a ${email}.`);
                }
            } catch (error) {
                console.error("Error actualizando rol:", error);
                alert("Error al actualizar el rol en la base de datos.");
            }
        }
    });

});


    // FASE 31: EVENTOS DEL PERFIL DE USUARIO
    document.addEventListener('click', async (e) => {
        // Abrir Perfil
        if (e.target.closest('#btn-user-profile')) {
            e.preventDefault();
            const modal = document.getElementById('modal-user-profile');
            const user = auth.currentUser;
            if (!user) return;
            
            document.getElementById('profile-email').value = user.email;
            
            try {
                const userDoc = await getDoc(doc(db, 'Usuarios', user.email));
                if (userDoc.exists() && userDoc.data().nombre) {
                    document.getElementById('profile-nombre').value = userDoc.data().nombre;
                } else {
                    document.getElementById('profile-nombre').value = '';
                }
            } catch (err) {
                console.error("Error fetching user name:", err);
            }
            
            modal.style.display = 'flex';
        }

        // Guardar Cambios de Perfil
        if (e.target.closest('#btn-save-profile')) {
            e.preventDefault();
            const user = auth.currentUser;
            if (!user) return;
            
            const btn = e.target.closest('#btn-save-profile');
            const newName = document.getElementById('profile-nombre').value.trim();
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Guardando...';
            btn.disabled = true;
            
            try {
                await updateDoc(doc(db, 'Usuarios', user.email), { nombre: newName }, { merge: true });
                window.showAlertCenter("Perfil Actualizado", "Tu nombre ha sido guardado exitosamente.");
                // Update UI visually if possible, though currently header shows email
            } catch (error) {
                console.error("Error updating profile:", error);
                window.showAlertCenter("Error", "No se pudo actualizar el perfil.", true);
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
                document.getElementById('modal-user-profile').style.display = 'none';
            }
        }

        // Enviar Correo de Recuperación
        if (e.target.closest('#btn-reset-password')) {
            e.preventDefault();
            const user = auth.currentUser;
            if (!user) return;
            
            const btn = e.target.closest('#btn-reset-password');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Solicitando...';
            btn.disabled = true;
            
            try {
                await sendPasswordResetEmail(auth, user.email);
                window.showAlertCenter("Correo Enviado", "Se ha enviado un enlace de restablecimiento a " + user.email);
            } catch (error) {
                console.error("Error sending password reset:", error);
                window.showAlertCenter("Error", "No se pudo enviar el correo: " + error.message, true);
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
                document.getElementById('modal-user-profile').style.display = 'none';
            }
        }
    });
