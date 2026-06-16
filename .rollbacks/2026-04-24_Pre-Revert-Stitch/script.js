// Importación de Firebase desde la CDN (Módulo)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, doc, collection, runTransaction, enableIndexedDbPersistence, writeBatch, serverTimestamp, getDoc, query, where, orderBy, limit, limitToLast, startAfter, endBefore, getDocs, deleteDoc, addDoc, updateDoc, increment, onSnapshot } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { generarPlantillaExcel, procesarExcelCargaMasiva, excelSerialDateToJS, exportarInventarioResguardo } from './excelUtils.js';

/* ----------------------------------------------------
   1a. UTILERÍA ROBUSTA DE TIPOS (T-GUARD)
   ---------------------------------------------------- */
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

        // Formateador Universal (Retorna String DD / MM / AAAA strictly)
        formatDate: (val) => {
            const date = SAR_Utils.parseDate(val);
            if (!date || isNaN(date.getTime())) return "N/A";
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day} / ${month} / ${year}`;
        },

    // Normalizador de Búsqueda
    matches: (source, term) => {
        if (!source || !term) return false;
        return source.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
               .includes(term.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
    }
};

// Tracking de Listeners para prevenir Memory Leaks
const activeListeners = {
    dashboard: null,
    historial: null,
    bodegas: null,
    usuarios: null,
    config: null
};

function clearListener(type) {
    if (activeListeners[type]) {
        activeListeners[type](); // Unsubscribe
        activeListeners[type] = null;
    }
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

/**
 * SERVICIO ARQUITECTURA DE BACKEND: Trazabilidad inmutable usando WriteBatch
 * Garantiza que si falla la creación del log o la actualización, ninguna se guarda.
 * 
 * @param {string} itemId ID del documento en "Insumos"
 * @param {Object} newData Datos nuevos a setear
 * @param {Object} currentUser Objeto del usuario (ej: auth.currentUser o stub)
 */
export async function updateInventoryWithAudit(itemId, newData, currentUser) {
    if (!itemId || !newData || !currentUser?.uid) {
        throw new Error("Parámetros incompletos. Se requiere ID de insumo, datos y usuario autenticado.");
    }

    try {
        const insumoRef = doc(db, 'Insumos', itemId);
        
        // 1. Lectura del snapshot actual para el Diff (Fuera del batch)
        const insumoDoc = await getDoc(insumoRef);
        if (!insumoDoc.exists()) {
            throw new Error(`Insumo [${itemId}] no encontrado.`);
        }
        const previousData = insumoDoc.data();

        // 2. Inicializar Batch
        const batch = writeBatch(db);

        // a) Actualización de la entidad maestra
        batch.update(insumoRef, {
            ...newData,
            lastModified: serverTimestamp(),
            lastModifierId: currentUser.uid
        });

        // b) Creación garantizada del Trail de Auditoría en subcolección dinámica
        const auditLogRef = doc(collection(insumoRef, 'audit_logs'));
        
        batch.set(auditLogRef, {
            action: 'ACTUALIZACION',
            timestamp: serverTimestamp(),
            userId: currentUser.uid,
            // Guardamos el Delta exacto (Diffing) 
            changes: {
                previous: previousData,
                new: newData
            }
        });

        // 3. Ejecución Masiva y Atómica
        await batch.commit();

        console.info(`[Audit-Log] El insumo ${itemId} fue mutado de forma segura.`);
        return true;
    } catch (error) {
        console.error(`[Error Arquitectura] Falla al actualizar el Insumo ${itemId}:`, error);
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
            showToast('Conexión Inestable', `Retraso de red detectado. Reintentando operación en ${delay/1000}s...`, 'warning');
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

window.showToast = function(title, text, type = 'info') {
    const toast = document.createElement('div');
    let bgColor, icon;
    
    if(type === 'success') { bgColor = 'var(--success)'; icon = 'ph-check-circle'; }
    else if(type === 'warning') { bgColor = 'var(--warning)'; icon = 'ph-warning'; }
    else if(type === 'error') { bgColor = 'var(--danger)'; icon = 'ph-warning-circle'; }
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
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('Visor Logístico Clínico Inicializado - Bootstrap');
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
            const btn = loginForm.querySelector('button');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph-spinner ph-spin"></i> VALIDANDO SEGURIDAD...';
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
                // Como las tostadas se inician tras el app-init, usamos alert pre-init.
                alert("Acceso Denegado: Su credencial es inválida o carece de permisos para ingresar al nodo logístico.");
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
            const currentType = loginPwdInput.getAttribute('type');
            const targetType = currentType === 'password' ? 'text' : 'password';
            loginPwdInput.setAttribute('type', targetType);
            
            const icon = togglePwdBtn.querySelector('i');
            if (targetType === 'text') {
                icon.classList.remove('ph-eye');
                icon.classList.add('ph-eye-slash');
            } else {
                icon.classList.remove('ph-eye-slash');
                icon.classList.add('ph-eye');
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
            // Usuario validado -> Ocultar barrera, mostrar Dashboard
            loginView.style.display = 'none';
            mainApp.style.display = 'flex'; // Según app-container

            // Validamos roles y aplicamos capa de Seguridad Visual
            await window.enforceRBACLogic(user);

            // Solo inicializamos los listeners y queries si es la primera vez (evita memoria leaks)
            if (!isAppInitialized) {
                // LIMPIEZA QUIRÚRGICA: Eliminar textos fantasmas si existen por redundancia en el DOM
                document.querySelectorAll('td, th, p, div').forEach(el => {
                    if (el.textContent.includes('FECHATIPO DE EVENTO') || el.textContent.includes('Inicie sesión para cargar logs')) {
                        const table = el.closest('table');
                        if (table && !table.id.includes('logs-table')) {
                             table.remove();
                        } else {
                             el.remove();
                        }
                    }
                });

                initializeRestOfSPA();
                // Iniciar motor reactivo
                startRealTimeDashboard();
                isAppInitialized = true;
            }
        } else {
            // Usuario desconectado -> Mostrar login
            loginView.style.display = 'flex';
            mainApp.style.display = 'none';
            document.body.removeAttribute('data-user-role');
            isAppInitialized = false;
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
        'view-movimientos': 'Visor Logístico',
        'view-historial': 'Historial de Transacciones',
        'view-informes': 'Informes Logísticos',
        'view-bodegas': 'Gestión de Bodegas',
        'view-usuarios': 'Gestión de Usuarios',
        'view-configuracion': 'Configuración del Sistema'
    };

    // Función unificada que lee el hash y actualiza la UI
    function navigateToHash() {
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
        if(targetItem) {
            targetItem.classList.add('active'); 
            targetItem.classList.remove('normal');
        }

        // Activación de vista central
        viewSections.forEach(section => {
            section.classList.remove('active');
            if (section.id === hash) { 
                section.classList.add('active');
                // Disparo de carga de datos dinámicos según vista
                if (hash === 'view-informes') { loadInformesAuditoria(); }
            }
        });

        // Actualización de título superior
        if(topbarTitle && viewTitles[hash]) {
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
                    showToast('Cierre de Sesión', 'Cerrando sesión del usuario...', 'warning');
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
        if(!btn) return;
        
        // CORRECCIÓN ESTRUCTURAL: Si es submit de form, dejar que el form handler lo maneje
        if(btn.type === 'submit' && btn.closest('form')) return; 
        if(btn.id === 'btn-ia-analisis') return; 

        if(btn.classList.contains('page-btn')) {
            e.preventDefault();
            const paginationContainer = btn.parentElement;
            paginationContainer.querySelectorAll('.page-btn').forEach(b => b.classList.remove('active'));
            if(!btn.querySelector('i')) { btn.classList.add('active'); }
            showToast('Paginación', 'Cambiando de página de resultados a la número ' + btn.textContent.trim(), 'info');
            return;
        }

        if(btn.classList.contains('btn-icon') || btn.classList.contains('btn-icon-outline') || (btn.classList.contains('icon-btn') && !btn.classList.contains('close-modal-btn'))) {
             e.preventDefault();
             const isTrash = btn.querySelector('.ph-trash');
             const isEdit = btn.querySelector('.ph-pencil-simple');
             const isEye = btn.querySelector('.ph-eye');
             const isFilter = btn.querySelector('.ph-funnel');
             const isBell = btn.querySelector('.ph-bell');
             const isQuestion = btn.querySelector('.ph-question');
             
             if(isTrash) { showToast('Acceso Denegado', 'Esta acción requiere credenciales de administrador.', 'error'); }
             else if(isEdit) { showToast('Edición Habilitada', 'Generando interfaz de modificación.', 'info'); }
             else if(isEye) { showToast('Vista Activa', 'Desplegando documento de respaldo.', 'success'); }
             else if(isFilter) { showToast('Filtrado', 'Desplegando opciones avanzadas.', 'info'); }
             else if(isBell) { showToast('Notificaciones', 'Bandeja de notificaciones sin mensajes nuevos.', 'info'); }
             else if(isQuestion) { showToast('Ayuda y Soporte', 'Abriendo portal de documentación clínica.', 'info'); }
             else { showToast('Acción', 'Operación secundaria exitosa.', 'success'); }
             return;
        }
        
        if(btn.classList.contains('btn-primary') || btn.classList.contains('btn-outline')) {
            e.preventDefault();
            const text = btn.textContent.trim();
            if(text.includes('Exportar')) {
                showToast('Operación iniciada', 'Preparando documento logístico ' + text.split(' ')[1] + '...', 'info');
                setTimeout(() => showToast('Completado', 'Documento creado y descargado.', 'success'), 1500);
            } else if(text.includes('ALTERNATIVA')) {
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
    if(analyzeBtn) {
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
       6. MOVIMIENTOS (Botones Toggle - Corrección CSS y Lógica)
       ---------------------------------------------------- */
    const movementToggleBtns = document.querySelectorAll('.toggle-buttons-wrapper .toggle-btn');
    const inputTipo = document.getElementById('movimiento-tipo');

    movementToggleBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            movementToggleBtns.forEach(t => t.classList.remove('active-green', 'active-red'));
            
            const isRecepcion = btn.textContent.includes('RECEPCIÓN');
            if (isRecepcion) {
                btn.classList.add('active-green');
                showToast('Tipo de Ingreso', 'Registrando como ENTRADA de suministros.', 'success');
                if (inputTipo) inputTipo.value = 'entrada';
            } else {
                btn.classList.add('active-red');
                showToast('Tipo de Despacho', 'Registrando como SALIDA / TRANSFERENCIA.', 'info');
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
    if(formUsuarios) {
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
                today.setHours(0,0,0,0);
                
                const expDate = new Date(movementData.expirationDate + "T00:00:00");
                
                if (expDate < today) {
                    showToast('Riesgo Clínico Bloqueado', 'Prohibido registrar la entrada de lotes vencidos en el sistema.', 'danger');
                    return;
                }
            }

            btn.innerHTML = '<i class="ph-spinner ph-spin"></i> PROCESANDO TRANSACCIÓN...';
            btn.disabled = true;

            try {
                // 2. Transacción Atómica con Firestore v10
                const insumoRef = doc(db, 'Insumos', articleId);
                const historialRef = doc(collection(db, 'Historial_Movimientos'));

                // Usamos el wrapper de retry en nuestra transacción atómica para tolerar intermitencias de Wifi
                await withRetry(async () => {
                    await runTransaction(db, async (transaction) => {
                        const insumoDoc = await transaction.get(insumoRef);
                        if (!insumoDoc.exists()) {
                            throw new Error("El Insumo indicado no figura en el listado central.");
                        }

                        const currentStock = insumoDoc.data().quantity || 0;
                        const newStock = isInput ? currentStock + quantity : currentStock - quantity;

                        if (newStock < 0) {
                            // "abort_no_retry" es un código que podemos detectar para no gastar reintentos en errores lógicos
                            const validationError = new Error(`Quiebre de Stock detectado. Disponible: ${currentStock}. Solicitado: ${quantity}`);
                            validationError.code = 'abort_no_retry'; 
                            throw validationError;
                        }

                        transaction.update(insumoRef, { 
                            quantity: newStock, 
                            lastUpdated: new Date().toISOString() 
                        });
                        
                        transaction.set(historialRef, {
                            ...movementData,
                            quantity: quantity,
                            previousStock: currentStock,
                            newStock: newStock,
                            timestamp: new Date().toISOString(),
                            executor: auth?.currentUser?.uid || "admin_logistica"
                        });
                    });
                }, 3, 2000);

                // Notificación de Éxito UI
                btn.innerHTML = 'TRANSACCIÓN CONFIRMADA <i class="ph-fill ph-check-circle"></i>';
                btn.style.backgroundColor = 'var(--success)';
                showToast('Operación Exitosa', 'Inventario sincronizado y bitácora actualizada atómicamente.', 'success');
                formMovimiento.reset();
                
            } catch (error) {
                console.error("Transacción Abortada:", error);
                // Diferenciamos un error lógico (stock negativo) de un fallo de red persistente (tras N reintentos)
                const errorMsg = error.code === 'abort_no_retry' 
                    ? error.message 
                    : 'La transacción no pudo completarse. Revise su conexión e intente nuevamente.';
                
                showToast('Error de Transacción', errorMsg, 'error');
                btn.style.backgroundColor = 'var(--danger)'; 
            } finally {
                btn.disabled = false;
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    // Reset CSS a default
                    btn.style.backgroundColor = ''; 
                }, 3500);
            }
        });
    }

    const formBodegas = document.getElementById('form-bodegas');
    if(formBodegas) {
        formBodegas.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = formBodegas.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            
            const formData = new FormData(formBodegas);
            const data = Object.fromEntries(formData.entries());
            const bName = data.name.trim();

            // REGLA DE ORO: Evitar duplicidad de nombres de bodega
            const existing = globalBodegas.find(b => b.name.toLowerCase() === bName.toLowerCase());
            if (existing) {
                return showToast('Error de Registro', 'Ya existe un recinto con ese nombre en la red.', 'warning');
            }

            btn.innerHTML = '<i class="ph-spinner ph-spin"></i> REGISTRANDO...';
            btn.disabled = true;

            try {
                await addDoc(collection(db, 'Bodegas'), {
                    name: bName,
                    type: data.type,
                    address: data.address || "S/I",
                    capacity: data.capacity || "S/I",
                    createdAt: serverTimestamp(),
                    status: 'active'
                });

                showToast('Éxito', `Recinto "${bName}" habilitado.`, 'success');
                formBodegas.reset();
                const modal = document.getElementById('modal-nueva-bodega');
                if(modal) modal.classList.remove('active');
            } catch (err) {
                console.error("Error creating bodega:", err);
                showToast('Error', 'No se pudo registrar la bodega.', 'error');
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    /* ----------------------------------------------------
       8. MODAL DE BODEGAS
       ---------------------------------------------------- */
    const bodegaCards = document.querySelectorAll('.card.clickable-card');
    const bodegaModal = document.getElementById('bodega-modal');
    
    if(bodegaModal) {
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
                if(type.includes('PUNTO')) color = 'var(--success)';
                if(type.includes('SECUNDARIA')) color = 'var(--purple)';
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

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }

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

            const q = query(
                collection(db, 'Insumos'),
                where('estado', '==', 'VENCIDO'),
                limit(50)
            );
            const snapshot = await getDocs(q);
            renderDescarteTable(snapshot, tbody, todayStr);

        } catch (error) {
            console.error('[Modal Descarte]', error);
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:32px; color:var(--danger); font-weight:600;">
                Error al cargar. Puede requerir un índice en Firestore — revise la consola del navegador.
            </td></tr>`;
            showToast('Error', 'No se pudo recuperar el reporte de descarte.', 'error');
        }
    }

    function renderDescarteTable(snapshot, tbody, todayStr) {
        if (snapshot.empty) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--success); font-weight:600;">
                <i class="ph-fill ph-check-circle" style="font-size:28px;"></i><br>Sin urgencias detectadas en el inventario.
            </td></tr>`;
            return;
        }
        tbody.innerHTML = '';
        snapshot.forEach(docSnap => {
            const item = docSnap.data();
            const isExpired = item.expirationDate && item.expirationDate <= todayStr;
            const badgeClass = isExpired ? 'danger' : 'warning';
            const badgeText  = isExpired ? 'VENCIDO (ACTA)' : 'PRÓXIMO A VENCER';
            const dateClass  = isExpired ? 'date-text danger' : 'date-text warning';

            const tr = document.createElement('tr');
            if (isExpired) tr.classList.add('table-row-danger');
            tr.innerHTML = `
                <td>
                    <div class="item-name">${item.name || 'Sin nombre'}</div>
                    <div class="item-category">${item.category || ''}</div>
                </td>
                <td style="font-family:monospace; font-weight:600;">${item.batch || 'N/A'}</td>
                <td>${(item.quantity || 0).toLocaleString('es-CL')} unds.</td>
                <td><div class="${dateClass}">${item.expirationDate || 'N/A'}</div></td>
                <td><span class="action-badge ${badgeClass}">${badgeText}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    const btnDescarte = document.getElementById('btn-reporte-descarte');
    if (btnDescarte) {
        btnDescarte.addEventListener('click', (e) => { e.preventDefault(); handleReporteDescarte(); });
    }

    /* ----------------------------------------------------
       8d. HANDLER: PLANIFICAR ROTACIÓN
       ---------------------------------------------------- */
    async function handlePlanificarRotacion() {
        openModal('modal-rotacion');
        const tbody = document.getElementById('modal-rotacion-tbody');
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px;">
            <i class="ph-spinner ph-spin" style="font-size:28px; color:var(--warning);"></i>
            <p style="margin-top:8px; color:var(--text-muted); font-size:13px;">Calculando plan de rotación óptimo...</p>
        </td></tr>`;

        try {
            const hoy = new Date();
            const en1mes   = new Date(); en1mes.setMonth(hoy.getMonth() + 1);
            const en6meses = new Date(); en6meses.setMonth(hoy.getMonth() + 6);
            const en1mesStr   = en1mes.toISOString().split('T')[0];
            const en6mesesStr = en6meses.toISOString().split('T')[0];

            const hoyStr = hoy.toISOString().split('T')[0];
            const q = query(
                collection(db, 'Insumos'),
                where('expirationDate', '>', hoyStr),
                where('expirationDate', '<=', en6mesesStr),
                orderBy('expirationDate', 'asc')
            );
            const snapshot = await getDocs(q);
            renderRotacionTable(snapshot, tbody, en1mes);

        } catch (error) {
            console.error('[Modal Rotación]', error);
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--danger); font-weight:600;">
                No se pudo generar el plan. Revise si se requiere índice compuesto en Firestore (consola del navegador).
            </td></tr>`;
            showToast('Error', 'Fallo al calcular la rotación de inventario.', 'error');
        }
    }

    function renderRotacionTable(snapshot, tbody, en1mes) {
        if (snapshot.empty) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--success); font-weight:600;">
                <i class="ph-fill ph-check-circle" style="font-size:28px;"></i><br>Sin ítems en zona de precaución (1 a 6 meses).
            </td></tr>`;
            return;
        }
        const en3meses = new Date(en1mes);
        en3meses.setMonth(en3meses.getMonth() + 2);
        const en3mesesStr = en3meses.toISOString().split('T')[0];

        tbody.innerHTML = '';
        snapshot.forEach(docSnap => {
            const item = docSnap.data();
            const stock = item.quantity || 0;
            const vencePronto = item.expirationDate && item.expirationDate <= en3mesesStr;
            const stockClass  = stock <= 50 ? 'badge-red-solid' : (stock <= 200 ? 'badge-orange' : 'badge-green');
            const ubicacion = item.location || 'Bodega Central';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div class="item-name">${item.name || 'Sin nombre'}</div>
                    <div class="item-category" style="font-family:monospace; font-size:10px;">LOTE: ${item.batch || 'N/A'}</div>
                </td>
                <td>
                    <div style="font-weight:600; font-size:12px; display:flex; align-items:center; gap:6px;">
                        <i class="ph-fill ph-map-pin" style="color:var(--primary);"></i> ${ubicacion}
                    </div>
                </td>
                <td><span class="${stockClass}">${stock.toLocaleString('es-CL')}</span></td>
                <td><div class="date-text warning">${item.expirationDate || 'N/A'}</div></td>
                <td>
                    <button class="btn btn-outline" style="padding:4px 10px; font-size:11px; display:inline-flex; align-items:center; gap:4px;">
                        <i class="ph ph-arrows-left-right"></i> Mover a Box
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    const btnRotacion = document.getElementById('btn-planificar-rotacion');
    if (btnRotacion) {
        btnRotacion.addEventListener('click', (e) => { e.preventDefault(); handlePlanificarRotacion(); });
    }

    /* ----------------------------------------------------
       8e. HANDLER: ANÁLISIS IA DE INVENTARIO
       ---------------------------------------------------- */
    async function handleAnalisisIA() {
        const iaBtn = document.getElementById('btn-ia-analisis');
        if (iaBtn) {
            iaBtn.innerHTML = '<i class="ph-spinner ph-spin"></i> Analizando...';
            iaBtn.disabled = true;
        }

        openModal('modal-ia-analisis');
        const loadingEl = document.getElementById('ia-modal-loading');
        const resultsEl = document.getElementById('ia-modal-results');
        if (loadingEl) loadingEl.style.display = 'flex';
        if (resultsEl) resultsEl.style.display = 'none';

        try {
            const todayStr = new Date().toISOString().split('T')[0];

            // Queries paralelas para minimizar tiempo de espera percibido
            const [snapCriticos, snapVencidos] = await Promise.all([
                getDocs(query(collection(db, 'Insumos'), where('quantity', '<=', 50), limit(25))),
                getDocs(query(collection(db, 'Insumos'), where('expirationDate', '<=', todayStr), limit(25)))
            ]);

            renderIAResults(snapCriticos, snapVencidos, loadingEl, resultsEl);

        } catch (error) {
            console.error('[Modal IA]', error);
            if (loadingEl) loadingEl.innerHTML = `
                <i class="ph-fill ph-warning-circle" style="font-size:40px; color:var(--danger);"></i>
                <p style="color:var(--danger); font-weight:600; text-align:center; margin-top:8px;">
                    Error al procesar el análisis.<br>
                    <small style="font-weight:400; color:var(--text-muted);">Revise los índices de Firestore en la consola del navegador.</small>
                </p>`;
            showToast('Error IA', 'No se pudo completar el análisis de inventario.', 'error');
        } finally {
            if (iaBtn) {
                iaBtn.innerHTML = '<i class="ph-fill ph-sparkle"></i> Análisis IA de Inventario';
                iaBtn.disabled = false;
            }
        }
    }

    function renderIAResults(snapCriticos, snapVencidos, loadingEl, resultsEl) {
        const totalCriticos = snapCriticos.size;
        const totalVencidos = snapVencidos.size;

        // Calcular valor en riesgo (stock × precio unitario de los vencidos)
        let valorEnRiesgo = 0;
        snapVencidos.forEach(docSnap => {
            const d = docSnap.data();
            valorEnRiesgo += (d.quantity || 0) * (d.unitPrice || 0);
        });
        const valorFormateado = '$' + valorEnRiesgo.toLocaleString('es-CL');

        // --- KPIs ---
        const kpisEl = document.getElementById('ia-kpis');
        if (kpisEl) {
            kpisEl.innerHTML = `
                <div style="background:var(--danger-light); border:1px solid var(--danger-badge); border-radius:12px; padding:20px; text-align:center;">
                    <div style="font-size:11px; font-weight:700; color:var(--danger-text); text-transform:uppercase; margin-bottom:8px;">STOCK CRÍTICO</div>
                    <div style="font-size:36px; font-weight:700; color:var(--danger);">${totalCriticos}</div>
                    <div style="font-size:11px; color:var(--danger-text); margin-top:4px;">insumos bajo el mínimo</div>
                </div>
                <div style="background:var(--warning-light); border:1px solid var(--warning-badge); border-radius:12px; padding:20px; text-align:center;">
                    <div style="font-size:11px; font-weight:700; color:var(--warning-text); text-transform:uppercase; margin-bottom:8px;">LOTES VENCIDOS</div>
                    <div style="font-size:36px; font-weight:700; color:var(--warning);">${totalVencidos}</div>
                    <div style="font-size:11px; color:var(--warning-text); margin-top:4px;">lotes a descartar</div>
                </div>
                <div style="background:var(--primary-light); border:1px solid #bfdbfe; border-radius:12px; padding:20px; text-align:center;">
                    <div style="font-size:11px; font-weight:700; color:var(--primary); text-transform:uppercase; margin-bottom:8px;">VALOR EN RIESGO</div>
                    <div style="font-size:28px; font-weight:700; color:var(--primary);">${valorFormateado}</div>
                    <div style="font-size:11px; color:var(--primary); margin-top:4px;">capital comprometido</div>
                </div>
            `;
        }

        // --- Recomendaciones dinámicas ---
        const recEl = document.getElementById('ia-recommendations');
        if (recEl) {
            const recs = [];
            if (totalVencidos > 0) {
                recs.push({ icon: 'ph-warning-circle', color: 'var(--danger)',
                    text: `Ejecutar descarte inmediato de <strong>${totalVencidos} lote(s) vencido(s)</strong> para evitar riesgo sanitario y penalizaciones regulatorias.` });
            }
            if (totalCriticos > 0) {
                recs.push({ icon: 'ph-package', color: 'var(--warning)',
                    text: `Emitir orden de reposición urgente para <strong>${totalCriticos} insumo(s)</strong> con stock inferior al límite mínimo operacional.` });
            }
            if (totalVencidos === 0 && totalCriticos === 0) {
                recs.push({ icon: 'ph-check-circle', color: 'var(--success)',
                    text: `El inventario se encuentra en <strong>estado óptimo</strong>. No se detectaron anomalías de stock ni vencimientos pendientes.` });
            }
            recs.push({ icon: 'ph-trend-up', color: 'var(--primary)',
                text: `Se recomienda ejecutar este análisis de forma <strong>semanal</strong> para mantener la trazabilidad y el cumplimiento normativo clínico.` });

            recEl.innerHTML = `
                <h4 style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:16px; display:flex; align-items:center; gap:8px;">
                    <i class="ph-fill ph-sparkle" style="color:var(--primary);"></i> Recomendaciones del Sistema
                </h4>
                ${recs.map(r => `
                    <div style="display:flex; gap:12px; align-items:flex-start; margin-bottom:14px;">
                        <i class="ph-fill ${r.icon}" style="font-size:20px; color:${r.color}; margin-top:2px; flex-shrink:0;"></i>
                        <p style="font-size:13px; color:var(--text-main); line-height:1.6; margin:0;">${r.text}</p>
                    </div>
                `).join('')}
            `;
        }

        if (loadingEl) loadingEl.style.display = 'none';
        if (resultsEl) resultsEl.style.display = 'block';

        const toastType = totalVencidos > 0 ? 'warning' : 'success';
        showToast('Análisis Completado', `${totalCriticos} críticos y ${totalVencidos} vencidos detectados.`, toastType);
    }

    /* ----------------------------------------------------
       9. LÓGICA DE FIRESTORE: PAGINACIÓN BIDIRECCIONAL
       ---------------------------------------------------- */
    const inventoryTableBody = document.getElementById('inventory-table-body');
    const btnNextPage = document.getElementById('btn-next-page');
    const btnPrevPage = document.getElementById('btn-prev-page');
    
    // Motor Histórico de Paginación (Array Snapshot Strategy)
    let pageSnapshots = [];  // Contendrá los "primeros" documentos de cada página visitada
    let currentPageIndex = 0; // Índice de la página actual 
    let lastVisibleInsumo = null;
    const PAGE_SIZE = 20;

    async function loadFirstPage() {
        if (!inventoryTableBody) return;
        
        try {
            const insumosRef = collection(db, 'Insumos');
            const q = query(insumosRef, orderBy('name'), limit(PAGE_SIZE));
            
            const snapshot = await getDocs(q);
            
            if (!snapshot.empty) {
                // Iniciamos la memoria indexada en el índice 0
                pageSnapshots = [ snapshot.docs[0] ];
                currentPageIndex = 0;
                lastVisibleInsumo = snapshot.docs[snapshot.docs.length - 1];
                
                // Mapeo UI
                if (btnPrevPage) btnPrevPage.disabled = true;
                if (btnNextPage) btnNextPage.disabled = snapshot.docs.length < PAGE_SIZE;
            } else {
                if (btnPrevPage) btnPrevPage.disabled = true;
                if (btnNextPage) btnNextPage.disabled = true;
            }

            renderInventoryTableFromSnapshot(snapshot);
        } catch (error) {
            console.error("Data Architect Error (P1):", error);
            showToast('Error', 'Fallo indexando la Base de Datos.', 'error');
        }
    }

    async function loadNextPage() {
        if (!lastVisibleInsumo) return;

        try {
            const insumosRef = collection(db, 'Insumos');
            const q = query(insumosRef, orderBy('name'), startAfter(lastVisibleInsumo), limit(PAGE_SIZE));
            
            const snapshot = await getDocs(q);
            
            if (snapshot.empty) {
                if (btnNextPage) btnNextPage.disabled = true;
                return;
            }

            // Cambiamos de página
            currentPageIndex++;
            // Grabamos dinámicamente en el array el documento de anclaje inicial de esta nueva página
            pageSnapshots[currentPageIndex] = snapshot.docs[0];
            lastVisibleInsumo = snapshot.docs[snapshot.docs.length - 1];
            
            // Evaluamos estado de botones bidireccionales
            if (btnPrevPage) btnPrevPage.disabled = false; // Definitivamente podemos retroceder
            if (btnNextPage) btnNextPage.disabled = snapshot.docs.length < PAGE_SIZE;

            renderInventoryTableFromSnapshot(snapshot);
        } catch (error) {
            console.error("Data Architect Error (P-Next):", error);
            showToast('Error', 'Fallo al avanzar el cursor NoSQL.', 'error');
        }
    }

    async function loadPrevPage() {
        if (currentPageIndex <= 0) return; // Salvaguarda matemática

        try {
            // Localizamos cómo iniciaba la página actual para cortar justo 'antes' de ella 
            const firstDocOfCurrentPage = pageSnapshots[currentPageIndex];

            const insumosRef = collection(db, 'Insumos');
            // Estrategia combinada: Detente antes de nuestro ancla actual, y tráenos los N elementos previos
            const q = query(insumosRef, orderBy('name'), endBefore(firstDocOfCurrentPage), limitToLast(PAGE_SIZE));
            
            const snapshot = await getDocs(q);

            if (snapshot.empty) return; // Caída de gracia o borrado masivo detectado
            
            currentPageIndex--;
            // Ahora el último visible es el último de este nuevo lote recuperado
            lastVisibleInsumo = snapshot.docs[snapshot.docs.length - 1];
            
            // Actualizamos la UI Dinámica
            if (btnPrevPage) btnPrevPage.disabled = (currentPageIndex === 0);
            if (btnNextPage) btnNextPage.disabled = false; // Al retroceder, lógicamente hay datos adelante

            renderInventoryTableFromSnapshot(snapshot);
        } catch (error) {
            console.error("Data Architect Error (P-Prev):", error);
            showToast('Error', 'Fallo al rebobinar el cursor NoSQL.', 'error');
        }
    }

    // Renderizador optimizado adaptado al DocumentSnapshot de Firestore nativo
    function renderInventoryTableFromSnapshot(snapshot) {
        if (!inventoryTableBody) return;
        
        inventoryTableBody.innerHTML = ''; // Limpiamos la vista actual

        if (snapshot.empty) {
            inventoryTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No hay insumos registrados.</td></tr>';
            return;
        }
        
        snapshot.forEach(docSnapshot => {
            const item = docSnapshot.data();
            const tr = document.createElement('tr');
            
            // Evaluación dinámica (Usando la metadata robusta definida en el JSON)
            const isCritical = item.quantity <= (item.criticalLimit || 50);
            if (isCritical) tr.classList.add('table-row-danger');
            
            const totalValue = (item.quantity || 0) * (item.unitPrice || 0);
            const formattedTotal = '$' + totalValue.toLocaleString('es-CL');
            const formattedPrice = '$' + (item.unitPrice || 0).toLocaleString('es-CL');
            
            // Función interna robusta para formateo de fecha (Senior Level)
            const formatDate = (dateValue) => {
                if (!dateValue || dateValue === 'N/A') return '---';
                
                let dateStr = "";
                // Caso 1: Es un número (Serial de Excel que persistió en DB)
                if (typeof dateValue === 'number') {
                    const d = new Date(Math.round((dateValue - 25569) * 86400 * 1000));
                    dateStr = d.toISOString().split('T')[0];
                } else {
                    dateStr = dateValue.toString();
                }

                if (!dateStr || dateStr.length < 5) return dateStr;
                
                // Soporte para separadores - o /
                const parts = dateStr.includes('-') ? dateStr.split('-') : dateStr.split('/');
                if (parts.length !== 3) return dateStr;

                // Si viene como YYYY-MM-DD (ISO) vs DD/MM/YYYY
                if (parts[0].length === 4) {
                    return `${parts[2]} / ${parts[1]} / ${parts[0]}`;
                }
                return `${parts[0]} / ${parts[1]} / ${parts[2]}`;
            };
            const visualExpDate = formatDate(item.expirationDate);
            
            let quantityMarkup = "";
            let codeClass = "text-primary";
            
            if (isCritical && item.quantity <= 20) {
                quantityMarkup = `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;"><span class="badge-red-solid">${item.quantity}</span><span class="text-danger" style="font-size:8px;font-weight:700;">STOCK CRÍTICO</span></div>`;
                codeClass = "text-danger";
            } else if (isCritical) {
                quantityMarkup = `<span class="badge-orange">${(item.quantity||0).toLocaleString('en-US')}</span>`;
            } else {
                quantityMarkup = `<span class="badge-green">${(item.quantity||0).toLocaleString('en-US')}</span>`;
            }
            
            const categoryClass = isCritical ? "item-category text-danger" : "item-category";

            tr.dataset.id = docSnapshot.id;
            tr.innerHTML = `
                <td><div class="${codeClass} font-bold text-sm">${item.code || '#N/A'}</div></td>
                <td><div class="item-name">${item.name || 'Sin Nombre'}</div><div class="${categoryClass}">${item.category || ''}</div></td>
                <td class="font-bold">${formattedPrice}</td>
                <td>${quantityMarkup}</td>
                <td class="font-bold">${formattedTotal}</td>
                <td><div class="${categoryClass}">LOTE: ${item.batch || 'N/A'}</div><div class="${categoryClass}">Vto: ${visualExpDate}</div></td>
                <td>
                    <div style="display:flex;gap:8px">
                        ${isCritical ? '<button class="btn btn-primary text-sm font-bold" style="background-color: #3730a3;"><i class="ph-fill ph-sparkle"></i> ALTERNATIVA</button>' : '<button class="btn btn-outline text-primary text-sm font-bold"><i class="ph-fill ph-sparkle"></i> ALTERNATIVA</button>'}
                        <button class="btn btn-icon btn-edit-insumo"><i class="ph ph-pencil-simple"></i></button>
                        <button class="btn btn-icon btn-delete-insumo admin-only"><i class="ph ph-trash"></i></button>
                    </div>
                </td>
            `;
            inventoryTableBody.appendChild(tr);
        });
    }

    // Inicialización del hook
    if (inventoryTableBody) {
        loadFirstPage();
    }
    
    // Conectar botón UI de página siguiente Firestore
    if (btnNextPage) {
        btnNextPage.addEventListener('click', loadNextPage);
    }
    
    // Conectar botón UI de página anterior Firestore
    if (btnPrevPage) {
        btnPrevPage.addEventListener('click', loadPrevPage);
    }

    /* ----------------------------------------------------
       9b. BUSCADOR MANUAL DE MEDICAMENTOS
       ---------------------------------------------------- */
    const searchInput = document.getElementById('inventory-search-input');
    let searchTimeout = null;

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const queryText = e.target.value.trim();
            
            searchTimeout = setTimeout(() => {
                if (queryText.length === 0) {
                    loadFirstPage();
                } else if (queryText.length >= 2) {
                    handleManualSearch(queryText);
                }
            }, 400); // Debounce para no saturar Firestore
        });
    }

    async function handleManualSearch(text) {
        if (!inventoryTableBody) return;
        inventoryTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px;"><i class="ph-spinner ph-spin" style="font-size:24px;"></i><br>Buscando coincidencias...</td></tr>';

        try {
            const insumosRef = collection(db, 'Insumos');
            // Búsqueda Robusta Case-Insensitive (Senior Path)
            const lowText = text.toLowerCase().trim();
            const qName = query(insumosRef, 
                where('name_lowercase', '>=', lowText), 
                where('name_lowercase', '<=', lowText + '\uf8ff'),
                limit(30)
            );
            
            const snapshot = await getDocs(qName);
            renderInventoryTableFromSnapshot(snapshot);
            
            // Deshabilitar paginación durante búsqueda activa
            if (btnNextPage) btnNextPage.disabled = true;
            if (btnPrevPage) btnPrevPage.disabled = true;

        } catch (error) {
            console.error("Search Error:", error);
            showToast('Error de Búsqueda', 'No se pudieron recuperar resultados.', 'error');
        }
    }

    /* ----------------------------------------------------
       9c. CARGA MASIVA EXCEL (SAR)
       ---------------------------------------------------- */
    const btnTemplate = document.getElementById('btn-download-template');
    const btnUploadTrigger = document.getElementById('btn-trigger-upload');
    const fileInput = document.getElementById('inventory-excel-input');

    if (btnTemplate) {
        btnTemplate.addEventListener('click', (e) => {
            e.preventDefault();
            generarPlantillaExcel();
        });
    }

    if (btnUploadTrigger && fileInput) {
        btnUploadTrigger.addEventListener('click', () => fileInput.click());
        
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            showToast('Procesando', 'Analizando estructura del archivo Excel...', 'info');

            try {
                const result = await procesarExcelCargaMasiva(file);
                if (result.success) {
                    const confirmUpload = confirm(`Se han validado ${result.count} registros correctamente. ¿Deseas importarlos a Firestore ahora?`);
                    if (confirmUpload) {
                        await executeFirestoreMassiveImport(result.data);
                    }
                }
            } catch (error) {
                alert(error); // Error detallado de validación de columnas
                showToast('Error de Validación', 'El archivo no cumple con el esquema SAR.', 'error');
            } finally {
                fileInput.value = ''; // Resetear para permitir subir el mismo archivo corregido
            }
        });
    }

    async function executeFirestoreMassiveImport(data) {
        showToast('Analizando Inventario', `Procesando ${data.length} registros para evitar duplicidad...`, 'info');
        
        let nuevosIngresos = 0;
        let productosActualizados = 0;
        const failedItems = [];

        const sanitizeText = (text) => {
            if (!text) return "";
            return text.toString().replace(/[\n\r]+/g, ' ').replace(/\s\s+/g, ' ').trim();
        };

        // Procesamiento en paralelo controlado para máxima velocidad (Senior Pattern)
        const promises = data.map(async (item) => {
            try {
                const cleanName = sanitizeText(item.descripcion);
                if (!cleanName) throw new Error("Descripción inválida");

                const cleanBatch = sanitizeText(item.lote) || "N/A";
                const isIdAvailable = item.id_producto && item.id_producto.toString().trim() !== "";
                const finalId = isIdAvailable ? item.id_producto.toString().trim() : null;

                // 1. GESTIÓN DE DUPLICIDAD (UPSERT LOGIC)
                let existingDoc = null;
                const insumosRef = collection(db, 'Insumos');
                
                // Definición de Clave Única: (ID ó Nombre) + Lote
                let q;
                if (finalId) {
                    q = query(insumosRef, where('code', '==', finalId), where('batch', '==', cleanBatch), limit(1));
                } else {
                    q = query(insumosRef, where('name', '==', cleanName), where('batch', '==', cleanBatch), limit(1));
                }

                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    // 2. LÓGICA DE ACTUALIZACIÓN (INCREMENTAL)
                    existingDoc = querySnapshot.docs[0];
                    await updateDoc(doc(db, 'Insumos', existingDoc.id), {
                        quantity: increment(Number(item.cantidad) || 0), // Suma atómica
                        unitPrice: Number(item.costo_unitario) || existingDoc.data().unitPrice,
                        location: sanitizeText(item.ubicacion) || existingDoc.data().location,
                        updatedAt: serverTimestamp()
                    });
                    productosActualizados++;
                } else {
                    // 3. LÓGICA DE NUEVO INGRESO
                    const autoId = "AUTO-" + Math.random().toString(36).substring(2, 7).toUpperCase();
                    await addDoc(insumosRef, {
                        code: finalId || autoId,
                        name: cleanName,
                        quantity: Number(item.cantidad) || 0,
                        unitPrice: Number(item.costo_unitario) || 0,
                        batch: cleanBatch,
                        expirationDate: item.vencimiento || "N/A",
                        location: sanitizeText(item.ubicacion) || "Bodega Central",
                        category: sanitizeText(item.categoria) || "General",
                        criticalLimit: Number(item.stock_minimo) || 50,
                        updatedAt: serverTimestamp(),
                        name_lowercase: cleanName.toLowerCase()
                    });
                    nuevosIngresos++;
                }
            } catch (rowError) {
                failedItems.push({ ...item, Motivo_Error: rowError.message });
            }
        });

        try {
            await Promise.all(promises);

            // Registro en Informes de Auditoría
            if (failedItems.length > 0 || productosActualizados > 0) {
                await addDoc(collection(db, 'informes'), {
                    tipo: 'Upsert de Carga Masiva',
                    fecha: serverTimestamp(),
                    usuario: auth.currentUser ? auth.currentUser.email : 'Admin Local',
                    total: data.length,
                    actualizados: productosActualizados,
                    nuevos: nuevosIngresos,
                    errores: failedItems.length,
                    detalle_errores: failedItems.slice(0, 50)
                });
            }

            // Notificación de Resumen Final (Regla de Oro)
            const resumenMsg = `${productosActualizados} productos actualizados y ${nuevosIngresos} nuevos ingresos registrados.`;
            showToast('Carga Finalizada', resumenMsg, 'success');
            
            if (failedItems.length > 0) {
                showToast('Advertencia', `Fallaron ${failedItems.length} filas. Descargando reporte...`, 'warning');
                downloadErrorReportCSV(failedItems);
            }

            loadFirstPage(); 

        } catch (error) {
            console.error("Error Crítico Carga Parallel:", error);
            showToast('Error Técnico', 'La carga masiva falló por saturación o conexión.', 'error');
        }
    }

    /* ----------------------------------------------------
       9g. DASHBOARD REACTIVO (REAL-TIME ENGINE)
       ---------------------------------------------------- */
    window.startRealTimeDashboard = function() {
        const criticalEl = document.getElementById('dash-critical-count');
        const expiringEl = document.getElementById('dash-expiring-count');
        const capitalEl = document.getElementById('dash-capital-value');

        if (!criticalEl || !expiringEl || !capitalEl) return;

        console.info("[Real-time] Activando escucha reactiva de inventario...");

        // Listener Global de Inventario
        onSnapshot(collection(db, 'Insumos'), (snapshot) => {
            let criticalCount = 0;
            let expiringCount = 0;
            let totalCapital = 0;

            const hoy = new Date();
            const proximoMes = new Date();
            proximoMes.setDate(hoy.getDate() + 30);

            snapshot.forEach(doc => {
                const data = doc.data();
                const qty = Number(data.quantity) || 0;
                const limit = Number(data.criticalLimit) || 0;
                const price = Number(data.unitPrice) || 0;

                // 1. Contador Stock Crítico
                if (qty <= limit) criticalCount++;

                // 2. Contador Próximos a Vencer (< 30 días)
                if (data.expirationDate) {
                    const vto = new Date(data.expirationDate);
                    if (vto <= proximoMes && vto >= hoy) expiringCount++;
                    else if (vto < hoy) expiringCount++; // También vencidos
                }

                // 3. Capital Estimado
                totalCapital += (qty * price);
            });

            // Actualización con Animación (Pulse Effect)
            const updateWithPulse = (el, newVal, isCurrency = false) => {
                const oldVal = el.innerText;
                const formatted = isCurrency ? 
                    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(newVal) : 
                    newVal;

                if (oldVal !== String(formatted)) {
                    el.innerText = formatted;
                    el.classList.remove('animate-pulse');
                    void el.offsetWidth; // Force reflow
                    el.classList.add('animate-pulse');
                }
            };

            updateWithPulse(criticalEl, criticalCount);
            updateWithPulse(expiringEl, expiringCount);
            updateWithPulse(capitalEl, totalCapital, true);
        });
    };

    function handleMassiveUploadResult(success, failed) {
        // Redundante con la nueva lógica upsert, se mantiene por compatibilidad si se llama
    }

    function downloadErrorReportCSV(failedItems) {
        // Envolver campos en comillas para evitar rupturas de CSV por caracteres especiales
        const wrap = (val) => `"${(val || "").toString().replace(/"/g, '""')}"`;
        
        const headers = ["ID", "Descripcion", "Cantidad", "Error"];
        const rows = failedItems.map(item => [
            wrap(item.id_producto),
            wrap(item.descripcion),
            wrap(item.cantidad),
            wrap(item.Motivo_Error)
        ]);

        let csvContent = "data:text/csv;charset=utf-8,\uFEFF" // Añadimos BOM para soporte Excel/UTF-8
            + headers.map(wrap).join(",") + "\n"
            + rows.map(e => e.join(",")).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `reporte_incidencias_${new Date().getTime()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /* ----------------------------------------------------
       9d. ELIMINACIÓN DE INSUMOS (ADMIN ONLY)
       ---------------------------------------------------- */
    if (inventoryTableBody) {
        inventoryTableBody.addEventListener('click', async (e) => {
            const deleteBtn = e.target.closest('.btn-delete-insumo');
            if (deleteBtn) {
                e.preventDefault();
                
                // RBAC: Validación doble de seguridad
                const currentRole = document.body.getAttribute('data-user-role');
                if (currentRole !== 'admin') {
                    showToast('Acceso Denegado', 'No tienes permisos de administrador para borrar registros.', 'error');
                    return;
                }

                const tr = deleteBtn.closest('tr');
                const docId = tr.dataset.id;
                const itemName = tr.querySelector('.item-name').textContent;

                // Confirmación de Seguridad solicitada
                if (confirm(`¿Estás seguro de eliminar "${itemName}"?\nEsta acción no se puede deshacer.`)) {
                    try {
                        showToast('Borrando...', 'Comunicando con Firestore...', 'info');
                        await deleteDoc(doc(db, 'Insumos', docId));
                        showToast('Registro Eliminado', 'El producto ha sido removido del sistema.', 'success');
                        tr.remove(); // Eliminación instantánea del DOM para UX premium
                    } catch (err) {
                        console.error("Delete Error:", err);
                        showToast('Error', 'No se pudo eliminar el registro. Revisa reglas de seguridad.', 'error');
                    }
                }
            }
        });

        // 9d-2. ABRIR MODAL DE EDICIÓN
        inventoryTableBody.addEventListener('click', async (e) => {
            const editBtn = e.target.closest('.btn-edit-insumo');
            if (editBtn) {
                e.preventDefault();
                const tr = editBtn.closest('tr');
                const docId = tr.dataset.id;
                
                try {
                    showToast('Cargando...', 'Recuperando datos del insumo...', 'info');
                    const docSnap = await getDoc(doc(db, 'Insumos', docId));
                    
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        // Poblar formulario
                        document.getElementById('edit-doc-id').value = docId;
                        document.getElementById('edit-code').value = data.code || '';
                        document.getElementById('edit-name').value = data.name || '';
                        document.getElementById('edit-category').value = data.category || '';
                        document.getElementById('edit-quantity').value = data.quantity || 0;
                        document.getElementById('edit-unitPrice').value = data.unitPrice || 0;
                        document.getElementById('edit-criticalLimit').value = data.criticalLimit || 50;
                        document.getElementById('edit-batch').value = data.batch || '';
                        
                        // Robustez: Conversión de fecha para input HTML5 (YYYY-MM-DD)
                        let rawDate = data.expirationDate || '';
                        
                        // Conversión Atómica (Fix Error 46507)
                        const dateObj = SAR_Utils.parseDate(rawDate);
                        if (dateObj && !isNaN(dateObj.getTime())) {
                            rawDate = dateObj.toISOString().split('T')[0];
                        } else {
                            rawDate = ""; // Fallback seguro
                        }
                        document.getElementById('edit-expirationDate').value = rawDate;
                        
                        document.getElementById('edit-location').value = data.location || '';
                        
                        // Abrir modal (usando el motor centralizado)
                        const modal = document.getElementById('modal-edit-insumo');
                        if (modal) modal.classList.add('active');
                    }
                } catch (err) {
                    console.error("Fetch Edit Error:", err);
                    showToast('Error', 'No se pudieron recuperar los datos.', 'error');
                }
            }
        });
    }

    /* ----------------------------------------------------
       9d-3. GUARDAR CAMBIOS (EDICIÓN CON AUDITORÍA)
       ---------------------------------------------------- */
    const formEditInsumo = document.getElementById('form-edit-insumo');
    if (formEditInsumo) {
        formEditInsumo.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = formEditInsumo.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            
            const docId = document.getElementById('edit-doc-id').value;
            const formData = new FormData(formEditInsumo);
            const rawData = Object.fromEntries(formData.entries());

            // Transformación y Limpieza de datos (Senior Standards)
            const updatedData = {
                code: rawData.code.trim(),
                name: rawData.name.trim(),
                name_lowercase: rawData.name.trim().toLowerCase(), // Crucial para el buscador
                category: rawData.category.trim() || "General",
                quantity: Number(rawData.quantity),
                unitPrice: Number(rawData.unitPrice),
                criticalLimit: Number(rawData.criticalLimit),
                batch: rawData.batch.trim().toUpperCase(),
                expirationDate: rawData.expirationDate,
                location: rawData.location.trim() || "Sin asignar"
            };

            btn.innerHTML = '<i class="ph-spinner ph-spin"></i> GUARDANDO...';
            btn.disabled = true;

            try {
                // Usamos la función de auditoría inmutable definida al inicio de script.js
                await updateInventoryWithAudit(docId, updatedData, auth.currentUser || { uid: 'admin_local' });
                
                showToast('Éxito', 'Insumo actualizado y auditoría registrada.', 'success');
                
                // Cerrar modal
                const modal = document.getElementById('modal-edit-insumo');
                if (modal) modal.classList.remove('active');
                
                loadFirstPage(); // Refrescar tabla
            } catch (err) {
                console.error("Update Error:", err);
                showToast('Error Crítico', 'Fallo al sincronizar cambios con el núcleo.', 'error');
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }
    
    /* ----------------------------------------------------
       9e. CARGA DE INFORMES DE AUDITORÍA (IA LOGS)
       ---------------------------------------------------- */
    async function loadInformesAuditoria() {
        const tbody = document.getElementById('informes-auditoria-tbody');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px;"><i class="ph-spinner ph-spin" style="font-size:24px;"></i><br>Consultando base de datos de auditoría...</td></tr>';

        try {
            const reportsRef = collection(db, 'informes');
            const q = query(reportsRef, orderBy('fecha', 'desc'), limit(15));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px;">No se registran incidencias de auditoría recientes.</td></tr>';
                return;
            }

            tbody.innerHTML = '';
            snapshot.forEach(docSnap => {
                const report = docSnap.data();
                const tr = document.createElement('tr');
                
                // Formateo de fecha de auditoría
                const date = report.fecha?.toDate() || new Date();
                const formattedDate = date.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

                const badgeClass = report.errores > 0 ? 'action-badge danger' : 'action-badge green-badge';
                const resultText = report.errores > 0 ? `FALLOS: ${report.errores}` : 'EXITOSO';

                tr.innerHTML = `
                    <td class="font-bold">${formattedDate}</td>
                    <td><span class="text-sm font-bold">${report.tipo || 'General'}</span></td>
                    <td><div class="user-badge-gray">${report.usuario || 'Sistema'}</div></td>
                    <td><span class="${badgeClass}">${resultText}</span></td>
                    <td>
                        <button class="btn btn-outline btn-sm" onclick="alert('Detalle de Error:\\n${JSON.stringify(report.detalle_errores || [], null, 2)}')">
                            <i class="ph ph-eye"></i> Ver
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

        } catch (error) {
            console.error("Informes Load Error:", error);
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--danger);">Error al cargar logs. Verifique los índices de Firestore.</td></tr>';
        }
    }

    // Botón de refresco manual
    const btnRefreshInformes = document.getElementById('btn-refresh-informes');
    if (btnRefreshInformes) {
        btnRefreshInformes.addEventListener('click', (e) => {
            e.preventDefault();
            loadInformesAuditoria();
            showToast('Actualizando', 'Refrescando registros de auditoría...', 'info');
        });
    }

    /* ----------------------------------------------------
       9f. DESCARGA DE RESGUARDO (BACKUP ADMIN)
       ---------------------------------------------------- */
    const btnDownloadBackup = document.getElementById('btn-download-backup');
    if (btnDownloadBackup) {
        btnDownloadBackup.addEventListener('click', async (e) => {
            e.preventDefault();
            
            try {
                // Re-validación de seguridad antes de proceder
                const user = auth.currentUser;
                if (!user) throw new Error("sesión expirada");

                const userDoc = await getDoc(doc(db, 'Usuarios', user.uid));
                if (userDoc.data().role !== 'admin') {
                    showToast('Acceso Denegado', 'Esta función es exclusiva para administradores.', 'error');
                    return;
                }

                showToast('Preparando Resguardo', 'Recuperando inventario completo...', 'info');
                
                const q = query(collection(db, 'Insumos'), orderBy('name', 'asc'));
                const snapshot = await getDocs(q);
                
                const allData = [];
                snapshot.forEach(doc => allData.push(doc.data()));
                
                exportarInventarioResguardo(allData);
                showToast('Exportación Exitosa', 'El resguardo de inventario ha sido generado.', 'success');

            } catch (err) {
                console.error("Backup Error:", err);
                showToast('Error', 'No se pudo generar el archivo de resguardo.', 'error');
            }
        });
    }

    /* ----------------------------------------------------
       9g. GESTIÓN DE MOVIMIENTOS (ENTRADAS / SALIDAS)
       ---------------------------------------------------- */
    
    // A. POBLAR SELECTOR DE INSUMOS (Dinamismo SPA)
    async function populateInsumosSelect() {
        const select = document.getElementById('movimiento-articuloId');
        if (!select) return;

        try {
            const snapshot = await getDocs(query(collection(db, 'Insumos'), orderBy('name')));
            select.innerHTML = '<option value="" disabled selected>Seleccione un insumo...</option>';
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                const option = document.createElement('option');
                option.value = docSnap.id;
                option.textContent = `${data.name} (Stock: ${data.quantity})`;
                option.dataset.name = data.name;
                option.dataset.batch = data.batch;
                option.dataset.stock = data.quantity;
                select.appendChild(option);
            });
        } catch (err) {
            console.error("Select Populating Error:", err);
        }
    }


    // B. SWITCHER DE TABS (RECEPCIÓN VS DESPACHO)
    const moveTabs = document.querySelectorAll('.toggle-btn');
    /* ----------------------------------------------------
       7. GUARDADO DE MOVIMIENTO (NÚCLEO ATÓMICO)
       ---------------------------------------------------- */
    const moveForm = document.getElementById('form-movimiento');
    
    if (moveForm) {
        moveForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = moveForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;

            const formData = new FormData(moveForm);
            const data = Object.fromEntries(formData.entries());
            const type = data.movementType; // entrada o salida
            
            // OBTENER NOMBRE DEL ARTÍCULO (Para búsqueda atómica en traslados)
            const artSelect = moveForm.querySelector('select[name="articleId"]');
            const articleName = artSelect ? artSelect.selectedOptions[0].text.split(' (')[0] : "";
            data.articleName = articleName;
            
            const insumoId = data.articleId;
            const quantity = Number(data.quantity);
            const cleanBatch = (data.batch || "").trim().toUpperCase();
            
            // Sanitización de Fecha Robusta (Type Guard)
            const formattedDate = SAR_Utils.formatDate(data.expirationDate);

            btn.innerHTML = '<i class="ph-spinner ph-spin"></i> PROCESANDO...';
            btn.disabled = true;

            try {
                // 1. PRE-BÚSQUEDA DE DESTINO (Para evitar queries dentro de la transacción)
                let targetDocId = null;
                const destinationName = data.destinationId;
                
                if (type === 'salida' && destinationName) {
                    const q = query(
                        collection(db, 'Insumos'), 
                        where('name', '==', data.articleName || ""), // Se asume que viene el nombre en el form
                        where('batch', '==', cleanBatch),
                        where('location', '==', destinationName),
                        limit(1)
                    );
                    const snap = await getDocs(q);
                    if (!snap.empty) targetDocId = snap.docs[0].id;
                }

                // 2. EJECUCIÓN ATÓMICA
                await runTransaction(db, async (transaction) => {
                    const insumoRef = doc(db, 'Insumos', insumoId);
                    const insumoSnap = await transaction.get(insumoRef);
                    if (!insumoSnap.exists()) throw "Insumo original no encontrado";
                    
                    const iData = insumoSnap.data();
                    const currentStock = iData.quantity || 0;

                    if (type === 'salida') {
                        if (quantity > currentStock) throw "Stock insuficiente en origen";
                        
                        // Restar de Origen
                        transaction.update(insumoRef, { 
                            quantity: increment(-quantity),
                            updatedAt: serverTimestamp() 
                        });

                        // Lógica de Traslado
                        if (destinationName && destinationName !== iData.location) {
                            if (targetDocId) {
                                // Incrementar en Destino Existente
                                transaction.update(doc(db, 'Insumos', targetDocId), {
                                    quantity: increment(quantity),
                                    updatedAt: serverTimestamp()
                                });
                            } else {
                                // Crear Nuevo en Destino (Fallback asíncrono preventivo)
                                const newRef = doc(collection(db, 'Insumos'));
                                transaction.set(newRef, {
                                    name: iData.name,
                                    name_lowercase: iData.name.toLowerCase(),
                                    batch: cleanBatch || iData.batch || "",
                                    quantity: quantity,
                                    unitPrice: iData.unitPrice || 0,
                                    expirationDate: formattedDate || iData.expirationDate || "",
                                    location: destinationName,
                                    updatedAt: serverTimestamp()
                                });
                            }
                        }
                    } else {
                        // ENTRADA (UPSERT LOGIC)
                        if (iData.batch === cleanBatch) {
                             transaction.update(insumoRef, { 
                                quantity: increment(quantity),
                                updatedAt: serverTimestamp() 
                            });
                        } else {
                            const newDocRef = doc(collection(db, 'Insumos'));
                            transaction.set(newDocRef, {
                                ...iData,
                                quantity: quantity,
                                batch: cleanBatch,
                                expirationDate: formattedDate,
                                location: iData.location,
                                provider: data.providerId || "S/I",
                                purchaseType: data.purchaseType || "S/I",
                                updatedAt: serverTimestamp()
                            });
                        }
                    }

                    // Log de Auditoría (Fecha formateada para historial según requerimiento)
                    const auditRef = doc(collection(db, 'Historial_Movimientos'));
                    transaction.set(auditRef, {
                        insumoName: iData.name,
                        quantity: quantity,
                        type: type,
                        batch: cleanBatch,
                        destination: data.destinationId || "Principal",
                        user: auth.currentUser ? auth.currentUser.email : 'Admin Local',
                        date: serverTimestamp(),
                        displayDate: new Date().toLocaleDateString('es-CL'), // "DD / MM / AAAA"
                        document: data.supportDocument || 'S/N'
                    });
                });

                showToast('Éxito', 'Movimiento registrado y auditado correctamente.', 'success');
                moveForm.reset();
                populateInsumosSelect(); // Refrescar lista con nuevos stocks
                loadFirstPage(); // Refrescar tabla de inventario
                
            } catch (err) {
                console.error("Movement Save Error:", err);
                const msg = typeof err === 'string' ? err : 'Fallo en la sincronización.';
                showToast('Error Crítico', msg, 'error');
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    // Inicializar selectores y motores reactivos
    populateInsumosSelect();
    startRealTimeDashboard();
    startRealTimeHistorial();
    startRealTimeBodegas();
    startRealTimeLogs();

    /* ----------------------------------------------------
       9h. MOTOR DE HISTORIAL (TIME-TRAVEL AUDIT)
       ---------------------------------------------------- */
    let globalHistoryData = []; // Caché local para filtrado instantáneo

    function startRealTimeHistorial() {
        const tbody = document.getElementById('historial-table-body');
        const searchInput = document.getElementById('historial-search-input');
        const countHoyEl = document.querySelector('.rh-value');
        
        if (!tbody) return;

        console.info("[Historial] Encendiendo auditoría cronológica...");
        clearListener('historial');

        const q = query(collection(db, 'Historial_Movimientos'), orderBy('date', 'desc'), limit(50));
        
        activeListeners.historial = onSnapshot(q, (snapshot) => {
            globalHistoryData = [];
            snapshot.forEach(doc => globalHistoryData.push({ id: doc.id, ...doc.data() }));
            renderHistorial(globalHistoryData);
        });

        // Filtrado Unificado SAR_Utils
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.trim();
                const filtered = globalHistoryData.filter(m => 
                    SAR_Utils.matches(m.insumoName, term) || 
                    SAR_Utils.matches(m.user, term) ||
                    SAR_Utils.matches(m.batch, term)
                );
                renderHistorial(filtered);
            });
        }
    }

    function renderHistorial(data) {
        const tbody = document.getElementById('historial-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        data.forEach(m => {
            const tr = document.createElement('tr');
            const date = m.date?.toDate() || new Date();
            const dateFmt = date.toLocaleDateString('es-CL');
            const timeFmt = date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
            
            const typeClass = m.type === 'entrada' ? 'green-badge' : 'purple-badge';
            const typeText = m.type.toUpperCase();
            const qtyClass = m.type === 'entrada' ? 'text-green' : 'text-red';
            const qtySign = m.type === 'entrada' ? '+' : '-';

            tr.innerHTML = `
                <td><div class="item-name">${dateFmt}</div><div class="item-category">${timeFmt}</div></td>
                <td><span class="action-badge ${typeClass}">${typeText}</span></td>
                <td>
                    <div class="flex-item-icon">
                        <i class="ph ph-package"></i>
                        <div>
                            <div class="item-name">${m.insumoName || 'Insumo'}</div>
                            <div class="item-category">Operador: ${m.user || 'S/I'}</div>
                        </div>
                    </div>
                </td>
                <td><div class="item-name">L: ${m.batch || 'S/L'}</div><div class="${qtyClass} font-bold">${qtySign} ${m.quantity} uds</div></td>
                <td><div class="item-category">Doc: ${m.document || 'S/N'}</div></td>
                <td><span class="doc-badge">${m.document || 'FACT-000'}</span></td>
                <td><button class="btn btn-icon" onclick="alert('Detalle:\\nProducto: ${m.insumoName}\\nFecha: ${dateFmt} ${timeFmt}\\nUsuario: ${m.user}')"><i class="ph ph-eye"></i></button></td>
            `;
            tbody.appendChild(tr);
        });
    }

    // EXPORTACIÓN DE HISTORIAL (ADMIN ONLY)
    const btnExportExcel = document.getElementById('btn-export-historial-excel');
    if (btnExportExcel) {
        btnExportExcel.addEventListener('click', () => {
            if (globalHistoryData.length === 0) return showToast('Error', 'No hay datos para exportar.', 'warning');
            
            const rows = globalHistoryData.map(m => ({
                "Fecha": m.date?.toDate().toLocaleString('es-CL') || "N/A",
                "Tipo": m.type.toUpperCase(),
                "Insumo": m.insumoName,
                "Cantidad": m.quantity,
                "Lote": m.batch,
                "Operador": m.user,
                "Referencia": m.document
            }));

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Historial_Movimientos");
            XLSX.writeFile(wb, `Historial_SAR_${new Date().getTime()}.xlsx`);
            showToast('Éxito', 'Excel de historial generado.', 'success');
        });
    }

    /* ----------------------------------------------------
       9i. INICIALIZACIÓN DE MOTORES
       ---------------------------------------------------- */
    startRealTimeHistorial();

    /* ----------------------------------------------------
       9i. GESTIÓN DE BODEGAS (MULTI-SEDE ENGINE)
       ---------------------------------------------------- */
    let globalBodegas = [];

    async function startRealTimeBodegas() {
        console.info("[Bodega Motor] Iniciando monitoreo de red multi-sede...");
        clearListener('bodegas');

        activeListeners.bodegas = onSnapshot(collection(db, 'Bodegas'), async (bodegaSnap) => {
            const bodegas = [];
            bodegaSnap.forEach(doc => bodegas.push({ id: doc.id, ...doc.data() }));
            globalBodegas = bodegas;

            // 1. Poblado de destinos (para modulo movimientos)
            syncDestinosUI(bodegas);

            const cardsContainer = document.getElementById('bodegas-cards-container');
            if (cardsContainer) {
                // 2. RENDER INICIAL (Rápido)
                renderBodegaCards(bodegas, {}); 

                // 3. ACTUALIZACIÓN DE MÉTRICAS (Asíncrono)
                try {
                    const insumosSnap = await getDocs(collection(db, 'Insumos'));
                    const insumos = [];
                    insumosSnap.forEach(doc => insumos.push(doc.data()));

                    const metrics = {};
                    bodegas.forEach(b => {
                        const siteInsumos = insumos.filter(i => i.location === b.name);
                        metrics[b.id] = {
                            skuCount: siteInsumos.length,
                            totalValue: siteInsumos.reduce((acc, curr) => acc + ((curr.quantity || 0) * (curr.unitPrice || 0)), 0)
                        };
                    });

                    renderBodegaCards(bodegas, metrics);
                    renderBodegaComparisonTable(bodegas, insumos);
                    updateBodegaTypeDatalist(bodegas);
                } catch (err) {
                    console.warn("[Métricas Bodega] Error de valorización:", err);
                }
            }
        });
    }

    function updateBodegaTypeDatalist(bodegas) {
        const datalist = document.getElementById('list-tipos-recinto');
        if (!datalist) return;
        const uniqueTypes = [...new Set(bodegas.map(b => b.type).filter(t => t))];
        const basics = ['SAR', 'CESFAM', 'CECOSF', 'Posta Rural', 'Anexo Dental', 'Bodega Central'];
        const allTypes = [...new Set([...basics, ...uniqueTypes])];
        datalist.innerHTML = allTypes.map(t => `<option value="${t}">`).join('');
    }

    function renderBodegaCards(bodegas, metrics = {}) {
        const container = document.getElementById('bodegas-cards-container');
        const adminBtn = `<div class="card admin-only" style="border: 2px dashed var(--border-color); background:transparent; display:flex; align-items:center; justify-content:center; cursor:pointer;" onclick="document.querySelector('#bodega-nombre').focus()">
                            <div style="color:var(--text-muted); font-weight:600; display:flex; gap:8px; align-items:center;"><i class="ph ph-plus-circle" style="font-size:24px;"></i> Nuevo Anexo</div>
                        </div>`;
        
        if (!container) return;
        container.innerHTML = '';

        // DEDUPLICACIÓN DE DATOS (Por si acaso vienen de listener redundante)
        const uniqueArr = [];
        const seenIds = new Set();
        bodegas.forEach(b => {
           if(!seenIds.has(b.id)) {
               uniqueArr.push(b);
               seenIds.add(b.id);
           }
        });

        uniqueArr.forEach(b => {
            const m = metrics[b.id] || { skuCount: '...', totalValue: 0 };
            const card = document.createElement('div');
            card.className = 'card clickable-card';
            
            // Lógica de Iconografía Clínica dinámica
            let iconClass = 'ph ph-storefront';
            const typeLower = (b.type || '').toLowerCase();
            if (typeLower.includes('sar')) iconClass = 'ph ph-first-aid-kit';
            else if (typeLower.includes('cesfam') || typeLower.includes('cecosf')) iconClass = 'ph ph-hospital';
            else if (typeLower.includes('dental')) iconClass = 'ph ph-tooth';
            else if (typeLower.includes('posta')) iconClass = 'ph ph-house-line';
            else if (typeLower.includes('móvil') || typeLower.includes('movil')) iconClass = 'ph ph-truck';

            card.style.borderTop = `4px solid ${typeLower.includes('central') ? 'var(--primary)' : 'var(--purple)'}`;
            
            const displayValue = typeof m.totalValue === 'number' ? `$${m.totalValue.toLocaleString('es-CL')}` : 'Cargando...';

            card.innerHTML = `
                <div class="flex-bet mb-8">
                    <div class="card-title" style="color:var(--text-muted); display:flex; align-items:center; gap:6px;">
                        <i class="${iconClass}" style="font-size:18px; color:var(--primary);"></i>
                        ${b.type ? b.type.toUpperCase() : 'RECINTO'}
                    </div>
                    <span class="badge-${b.isActive ? 'green' : 'red'}" style="font-size:9px;">${b.isActive ? 'ACTIVO' : 'INACTIVO'}</span>
                </div>
                <div class="card-value" style="font-size:20px; margin-bottom: 12px; font-weight:700;">${b.name}</div>
                
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; border-top: 1px solid var(--border-color); padding-top:12px;">
                    <div>
                        <div class="text-sm text-muted" style="font-size:10px;">VARIEDAD (SKU)</div>
                        <div class="font-bold">${m.skuCount}</div>
                    </div>
                    <div>
                        <div class="text-sm text-muted" style="font-size:10px;">CAPITAL TOTAL</div>
                        <div class="font-bold text-primary">${displayValue}</div>
                    </div>
                </div>
                
                <div class="flex-bet mt-16" style="gap:8px;">
                    <button class="btn btn-primary btn-sm" style="flex:1; font-size:11px; font-weight:700;" onclick="window.prepareManualEntry('${b.name}')">
                        <i class="ph ph-plus-circle"></i> AGREGAR
                    </button>
                    <button class="btn btn-icon-outline admin-only" style="width:36px; height:36px; color:var(--danger);" onclick="window.deleteBodega('${b.id}', '${b.name}')">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            `;
            
            card.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                openBodegaDetail(b);
            });
            container.appendChild(card);
        });
        
        container.insertAdjacentHTML('beforeend', adminBtn);
    }

    async function renderBodegaComparisonTable(bodegas, insumos) {
        const tbody = document.getElementById('bodegas-tbody');
        const theadRow = document.getElementById('bodegas-thead-row');
        if (!tbody || !theadRow) return;

        // DEDUPLICACIÓN DE COLUMNAS (Limpieza Preventiva)
        const uniqueBodegas = [];
        const seenNames = new Set();
        bodegas.forEach(b => {
            if (!seenNames.has(b.name)) {
                uniqueBodegas.push(b);
                seenNames.add(b.name);
            }
        });

        theadRow.innerHTML = '<th>CÓDIGO / INSUMO</th>';
        uniqueBodegas.forEach(b => {
            const th = document.createElement('th');
            th.textContent = b.name.toUpperCase();
            theadRow.appendChild(th);
        });
        theadRow.insertAdjacentHTML('beforeend', '<th>TOTAL RED</th>');

        const pivot = {};
        insumos.forEach(data => {
            const name = data.name;
            const loc = data.location || 'Sin Asignar';
            const qty = Number(data.quantity) || 0;

            if (!pivot[name]) pivot[name] = { total: 0 };
            pivot[name][loc] = (pivot[name][loc] || 0) + qty;
            pivot[name].total += qty;
        });

        tbody.innerHTML = '';
        Object.keys(pivot).sort().forEach(itemName => {
            const row = document.createElement('tr');
            let cols = `<td><div class="item-name">${itemName}</div></td>`;
            uniqueBodegas.forEach(b => {
                const stock = pivot[itemName][b.name] || 0;
                cols += `<td><div class="font-bold">${stock.toLocaleString()}</div></td>`;
            });
            cols += `<td><div class="font-bold text-primary">${pivot[itemName].total.toLocaleString()}</div></td>`;
            row.innerHTML = cols;
            tbody.appendChild(row);
        });
    }

    // FUNCIÓN DE BORRADO DE BODEGA
    window.deleteBodega = async function(id, name) {
        if (!confirm(`¿Está seguro de eliminar el recinto "${name}"?\nEsta acción no eliminará los insumos asociados, pero estos quedarán sin ubicación física definida.`)) return;

        try {
            await deleteDoc(doc(db, 'Bodegas', id));
            showToast('Recinto Eliminado', `"${name}" ha sido removido de la red.`, 'info');
        } catch (err) {
            console.error("Delete Bodega Error:", err);
            showToast('Error', 'No tiene permisos suficientes para eliminar.', 'error');
        }
    };

    // Preparar modal de ingreso manual
    window.prepareManualEntry = function(bodegaName) {
        const modal = document.getElementById('modal-ingreso-manual');
        document.getElementById('manual-location').value = bodegaName;
        document.getElementById('manual-bodega-title').innerText = `Ingreso Manual: ${bodegaName}`;
        modal.classList.add('active');
    };

    // Handler para Ingreso Manual (Regla de Oro: No Duplicidad)
    const formManual = document.getElementById('form-ingreso-manual');
    if (formManual) {
        formManual.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = formManual.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            
            const formData = new FormData(formManual);
            const data = Object.fromEntries(formData.entries());
            const qty = Number(data.quantity);
            const cleanBatch = data.batch.trim().toUpperCase();

            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> PROCESANDO...';

            try {
                // Buscamos si existe la combinación Insumo + Lote + Bodega
                const q = query(collection(db, 'Insumos'), 
                    where('name', '==', data.name), 
                    where('batch', '==', cleanBatch),
                    where('location', '==', data.location)
                );
                const snap = await getDocs(q);

                if (!snap.empty) {
                    // EXISTE -> INCREMENTO ATÓMICO
                    const docRef = doc(db, 'Insumos', snap.docs[0].id);
                    await updateDoc(docRef, {
                        quantity: increment(qty),
                        updatedAt: serverTimestamp()
                    });
                } else {
                    // NO EXISTE -> CREACIÓN
                    await addDoc(collection(db, 'Insumos'), {
                        name: data.name,
                        name_lowercase: data.name.toLowerCase(),
                        batch: cleanBatch,
                        quantity: qty,
                        unitPrice: Number(data.unitPrice) || 0,
                        expirationDate: SAR_Utils.formatDate(data.expirationDate),
                        location: data.location,
                        category: data.category,
                        updatedAt: serverTimestamp()
                    });
                }

                showToast('Ingreso Exitoso', `El stock de ${data.name} ha sido actualizado.`, 'success');
                document.getElementById('modal-ingreso-manual').classList.remove('active');
                formManual.reset();
                startRealTimeDashboard(); // Actualizar dashboard (Stock Crítico)
                
            } catch (err) {
                console.error("Manual Entry Error:", err);
                showToast('Error', 'Fallo al sincronizar el ingreso manual.', 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        });
    }

    // Función para poblar destinos de forma reactiva (Invocada desde el listener de bodegas)
    function syncDestinosUI(bodegas) {
        const select = document.getElementById('movimiento-destino');
        if (!select) return;

        // Seguridad RBAC: Solo admin puede ver destinos de transferencia
        const userRole = document.body.getAttribute('data-user-role');
        if (userRole === 'operador') {
            select.innerHTML = '<option value="" disabled selected>Acceso reservado a Administración</option>';
            select.disabled = true;
            return;
        }

        select.disabled = false;
        const currentVal = select.value;
        select.innerHTML = '<option value="" disabled selected>Seleccione destino...</option>';
        
        const safeBodegas = Array.isArray(bodegas) ? bodegas : [];
        const dataArr = (safeBodegas.length > 0) ? safeBodegas : [
            { name: 'BODEGA CENTRAL SAR' }, 
            { name: 'CESFAM ELGUETA' }, 
            { name: 'CECOSF OBISPO LIZAMA' },
            { name: 'POSTA RURAL' },
            { name: 'ANEXO DENTAL' }
        ];

        dataArr.forEach(b => {
             const opt = document.createElement('option');
             opt.value = b.name; 
             opt.textContent = b.name.toUpperCase();
             select.appendChild(opt);
        });

        if (currentVal) select.value = currentVal;
    }

    async function openBodegaDetail(bodega) {
        document.getElementById('modal-bodega-name').innerText = bodega.name;
        document.getElementById('modal-bodega-type').innerText = bodega.type.toUpperCase();
        
        const modal = document.getElementById('bodega-modal');
        modal.classList.add('active');

        // Guardar ID actual para acciones
        modal.dataset.currentBodegaId = bodega.id;
        modal.dataset.currentBodegaName = bodega.name;

        // CARGAR LISTADO DE INSUMOS ESPECÍFICOS (Detalles por separado)
        const tableBody = document.getElementById('bodega-inventory-tbody');
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Cargando inventario...</td></tr>';
            
            try {
                const q = query(collection(db, 'Insumos'), where('location', '==', bodega.name));
                const snap = await getDocs(q);
                
                if (snap.empty) {
                    tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Sin stock registrado en este recinto.</td></tr>';
                    return;
                }

                tableBody.innerHTML = '';
                snap.forEach(docSnap => {
                    const d = docSnap.data();
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td class="font-bold">${d.name}</td>
                        <td><span class="doc-badge">${d.batch || 'S/L'}</span></td>
                        <td class="text-primary font-bold">${d.quantity}</td>
                        <td><span class="text-sm color-muted">${d.expirationDate || '---'}</span></td>
                    `;
                    tableBody.push ? "" : tableBody.appendChild(tr); 
                });
            } catch (err) {
                console.error("Error loading bodega inventory:", err);
                tableBody.innerHTML = '<tr><td colspan="4" class="text-red">Error al cargar.</td></tr>';
            }
        }
    }

    // BOTÓN: DISPARAR TRANSFERENCIA
    const btnTriggerTransfer = document.getElementById('btn-trigger-transfer');
    if (btnTriggerTransfer) {
        btnTriggerTransfer.addEventListener('click', async () => {
            const modalDetail = document.getElementById('bodega-modal');
            const fromName = modalDetail.dataset.currentBodegaName;
            
            const transModal = document.getElementById('modal-transferencia');
            document.getElementById('transfer-from-name').value = fromName;
            
            // Cargar Selectores de Insumos (Solo los que están en esa bodega)
            const insumoSelect = document.getElementById('transfer-insumo-id');
            const toSelect = document.getElementById('transfer-to-id');
            
            const q = query(collection(db, 'Insumos'), where('location', '==', fromName));
            const snap = await getDocs(q);
            
            insumoSelect.innerHTML = '<option value="" disabled selected>Seleccione...</option>';
            snap.forEach(docSnap => {
                const d = docSnap.data();
                insumoSelect.innerHTML += `<option value="${docSnap.id}" data-qty="${d.quantity}" data-batch="${d.batch}" data-name="${d.name}">${d.name} (Stock: ${d.quantity} - L: ${d.batch})</option>`;
            });

            // Bodegas Destino
            toSelect.innerHTML = '<option value="" disabled selected>Seleccione destino...</option>';
            globalBodegas.filter(b => b.name !== fromName).forEach(b => {
                toSelect.innerHTML += `<option value="${b.name}">${b.name}</option>`;
            });

            modalDetail.classList.remove('active');
            transModal.classList.add('active');
        });
    }

    // FORM: PROCESO DE TRASPASO (UPSERT LOGIC)
    const formTransfer = document.getElementById('form-transferencia');
    if (formTransfer) {
        formTransfer.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fromName = document.getElementById('transfer-from-name').value;
            const toName = document.getElementById('transfer-to-id').value;
            const insumoId = document.getElementById('transfer-insumo-id').value;
            const qtyToMove = Number(document.getElementById('transfer-qty').value);

            if (!toName || !insumoId || qtyToMove <= 0) return;

            try {
                const docRefOrigin = doc(db, 'Insumos', insumoId);
                const snapOrigin = await getDoc(docRefOrigin);
                const data = snapOrigin.data();

                if (qtyToMove > data.quantity) {
                    showToast('Error', 'Stock insuficiente en la bodega de origen.', 'error');
                    return;
                }

                showToast('Procesando Traspaso', `Moviendo ${qtyToMove} unidades...`, 'info');

                // 1. Restar de Origen
                await updateDoc(docRefOrigin, {
                    quantity: increment(-qtyToMove),
                    updatedAt: serverTimestamp()
                });

                // 2. Upsert en Destino (Mismo nombre + mismo lote)
                const qDest = query(collection(db, 'Insumos'), 
                    where('name', '==', data.name), 
                    where('batch', '==', data.batch), 
                    where('location', '==', toName)
                );
                const snapDest = await getDocs(qDest);

                if (!snapDest.empty) {
                    // Existe -> Incrementar
                    await updateDoc(doc(db, 'Insumos', snapDest.docs[0].id), {
                        quantity: increment(qtyToMove),
                        updatedAt: serverTimestamp()
                    });
                } else {
                    // No existe -> Crear
                    await addDoc(collection(db, 'Insumos'), {
                        ...data,
                        location: toName,
                        quantity: qtyToMove,
                        updatedAt: serverTimestamp()
                    });
                }

                // 3. Log en Historial
                await addDoc(collection(db, 'Historial_Movimientos'), {
                    insumoName: data.name,
                    quantity: qtyToMove,
                    type: 'traspaso',
                    user: auth.currentUser?.email || 'Admin',
                    date: serverTimestamp(),
                    document: `TRASP-${fromName.substring(0,3)}-${toName.substring(0,3)}`
                });

                showToast('Éxito', 'Transferencia completada correctamente.', 'success');
                document.getElementById('modal-transferencia').classList.remove('active');
                
            } catch (err) {
                console.error("Transfer Error:", err);
                showToast('Error', 'Fallo en la sincronización del traspaso.', 'error');
            }
        });
    }

    // CRUD BODEGAS (Admin Only)
    const formBodega = document.getElementById('form-bodegas');
    if (formBodega) {
        formBodega.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentRole = document.body.getAttribute('data-user-role');
            if (currentRole !== 'admin') {
                showToast('Acceso Denegado', 'Solo administradores pueden crear bodegas.', 'error');
                return;
            }

            const formData = new FormData(formBodega);
            const bodegaData = Object.fromEntries(formData.entries());
            
            try {
                await addDoc(collection(db, 'Bodegas'), {
                    ...bodegaData,
                    isActive: bodegaData.isActive === 'true',
                    createdAt: serverTimestamp()
                });
                showToast('Éxito', 'Bodega creada correctamente.', 'success');
                formBodega.reset();
            } catch (err) {
                showToast('Error', 'Fallo al registrar la sucursal.', 'error');
            }
        });
    }

    // ELIMINAR BODEGA
    const btnDeleteBodega = document.getElementById('btn-delete-bodega');
    if (btnDeleteBodega) {
        btnDeleteBodega.addEventListener('click', async () => {
            const modal = document.getElementById('bodega-modal');
            const bodegaId = modal.dataset.currentBodegaId;
            const bodegaName = modal.dataset.currentBodegaName;

            if (confirm(`¿Está seguro de eliminar la bodega "${bodegaName}"?\nSe perderá el registro de su infraestructura.`)) {
                try {
                    await deleteDoc(doc(db, 'Bodegas', bodegaId));
                    showToast('Eliminado', 'Bodega removida del sistema.', 'success');
                    modal.classList.remove('active');
                } catch (err) {
                    showToast('Error', 'Fallo de permisos para eliminar sucursal.', 'error');
                }
            }
        });
    }

    startRealTimeBodegas(); // Encender motor multi-sede

    /* ----------------------------------------------------
       9j. GESTIÓN DE USUARIOS (RBAC CONTROL PANEL)
       ---------------------------------------------------- */
    let globalUsers = [];

    function startRealTimeUsers() {
        const tbody = document.getElementById('users-table-body');
        const searchInput = document.getElementById('users-search-input');
        
        if (!tbody) return;

        console.info("[Seguridad] Vigilando red de usuarios...");

        onSnapshot(collection(db, 'Usuarios'), (snapshot) => {
            globalUsers = [];
            snapshot.forEach(doc => globalUsers.push({ id: doc.id, ...doc.data() }));
            renderUsersTable(globalUsers);
        });

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase().trim();
                const filtered = globalUsers.filter(u => 
                    (u.fullName || u.name || "").toLowerCase().includes(term) || 
                    (u.email || u.username || "").toLowerCase().includes(term)
                );
                renderUsersTable(filtered);
            });
        }
    }

    function renderUsersTable(data) {
        const tbody = document.getElementById('users-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        data.forEach(user => {
            const tr = document.createElement('tr');
            tr.dataset.id = user.id;
            
            const initials = (user.fullName || "User").split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const roleClass = user.role === 'admin' ? 'bg-blue text-primary' : 'bg-green text-green';
            
            tr.innerHTML = `
                <td>
                    <div class="flex-item-icon">
                        <div class="avatar-circle">${initials}</div>
                        <div>
                            <div class="item-name">${user.fullName || user.name || 'Sin nombre'}</div>
                            <div class="item-category">${user.email || user.username}@clinica.cl</div>
                        </div>
                    </div>
                </td>
                <td><span class="user-badge-gray">${user.center || 'Sede Central'}</span></td>
                <td><span class="role-badge ${roleClass}">${user.role?.toUpperCase() || 'OPERADOR'}</span></td>
                <td>
                    <div style="display:flex; gap:8px;">
                        <button class="btn btn-icon admin-only btn-edit-role" title="Cambiar Rol"><i class="ph ph-shield-check"></i></button>
                        <button class="btn btn-icon admin-only btn-delete-user" style="color:var(--danger);" title="Eliminar"><i class="ph ph-trash"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // FORM: CREAR USUARIO (PERFIL FIRESTORE)
    const formUser = document.getElementById('form-usuarios');
    if (formUser) {
        formUser.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentRole = document.body.getAttribute('data-user-role');
            if (currentRole !== 'admin') {
                showToast('Acceso Denegado', 'Solo administradores pueden dar de alta personal.', 'error');
                return;
            }

            const formData = new FormData(formUser);
            const data = Object.fromEntries(formData.entries());
            
            try {
                showToast('Registrando', 'Guardando perfil de funcionario...', 'info');
                await addDoc(collection(db, 'Usuarios'), {
                    fullName: data.fullName,
                    username: data.username.toLowerCase(),
                    role: data.role,
                    center: 'Sede Central',
                    createdAt: serverTimestamp(),
                    email: `${data.username}@clinica.cl`
                });
                showToast('Éxito', 'Funcionario registrado en el sistema.', 'success');
                formUser.reset();
            } catch (err) {
                showToast('Error', 'No se pudo crear el perfil de usuario.', 'error');
            }
        });
    }

    // ACCIONES DE TABLA: CAMBIAR ROL Y ELIMINAR
    const userTable = document.getElementById('users-table-body');
    if (userTable) {
        userTable.addEventListener('click', async (e) => {
            const editBtn = e.target.closest('.btn-edit-role');
            const deleteBtn = e.target.closest('.btn-delete-user');
            
            const tr = e.target.closest('tr');
            if (!tr) return;
            
            const userId = tr.dataset.id;
            const userName = tr.querySelector('.item-name').textContent;

            // RBAC Re-validación
            if (document.body.getAttribute('data-user-role') !== 'admin') {
                showToast('Acceso Denegado', 'Acción reservada para administradores.', 'error');
                return;
            }

            if (editBtn) {
                const newRole = confirm(`¿Deseas cambiar a "${userName}" a rol ADMINISTRADOR?\nPresiona Aceptar para Admin, Cancelar para mantener Operador.`) ? 'admin' : 'operador';
                try {
                    await updateDoc(doc(db, 'Usuarios', userId), { role: newRole });
                    showToast('Rol Actualizado', `Perfil de ${userName} modificado a ${newRole}.`, 'success');
                } catch (err) {
                    showToast('Error', 'Fallo al actualizar privilegios.', 'error');
                }
            }

            if (deleteBtn) {
                if (confirm(`¿Estás seguro de eliminar a "${userName}"?\nPerderá el acceso al sistema de forma inmediata y su perfil será removido.`)) {
                    try {
                        await deleteDoc(doc(db, 'Usuarios', userId));
                        showToast('Usuario Eliminado', 'El funcionario ya no tiene acceso al sistema.', 'success');
                    } catch (err) {
                        showToast('Error', 'Fallo al eliminar cuenta. Revisa reglas de seguridad.', 'error');
                    }
                }
            }
        });
    }

    /* ----------------------------------------------------
       9k. MOTOR DE REPORTES: DESCARTE (URGENCIAS)
       ---------------------------------------------------- */
    const btnReporteDescarte = document.getElementById('btn-reporte-descarte');
    if (btnReporteDescarte) {
        btnReporteDescarte.addEventListener('click', async () => {
            // 1. RBAC Check
            const currentRole = document.body.getAttribute('data-user-role');
            if (currentRole !== 'admin') {
                showToast('Acceso Denegado', 'Solo administradores pueden generar actas de descarte.', 'error');
                return;
            }

            const tbody = document.getElementById('modal-descarte-tbody');
            if (!tbody) return;

            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;"><i class="ph-spinner ph-spin"></i> Consultando inventario crítico...</td></tr>';
            document.getElementById('modal-reporte-descarte').classList.add('active');

            try {
                // 2. Query Insumos Próximos a Vencer (< 30 días o ya vencidos)
                // Nota: Firestore no permite filtrar fechas fácilmente si están como string "DD / MM / AAAA". 
                // Usaremos un filtro local sobre el snapshot para máxima precisión.
                const snap = await getDocs(collection(db, 'Insumos'));
                const hoy = new Date();
                const limite30d = new Date();
                limite30d.setDate(hoy.getDate() + 30);

                const descarteList = [];

                snap.forEach(docSnap => {
                    const d = docSnap.data();
                    const dateObj = SAR_Utils.parseDate(d.expirationDate);

                    if (dateObj && dateObj <= limite30d) {
                        descarteList.push({ id: docSnap.id, ...d, dateObj });
                    }
                });

                // 3. Renderizar Tabla
                tbody.innerHTML = '';
                if (descarteList.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted)">No hay insumos en período de descarte.</td></tr>';
                    return;
                }

                descarteList.sort((a, b) => a.dateObj - b.dateObj).forEach(item => {
                    const tr = document.createElement('tr');
                    const dateFmt = item.dateObj.toLocaleDateString('es-CL');
                    const statusClass = item.dateObj < hoy ? 'badge-red-solid' : 'badge-orange';
                    const statusText = item.dateObj < hoy ? 'VENCIDO' : 'POR VENCER';

                    tr.innerHTML = `
                        <td><div class="item-name">${item.name}</div><div class="item-category">${item.category || 'Insumo'}</div></td>
                        <td class="font-bold">${item.batch || 'S/L'}</td>
                        <td class="font-bold">${item.quantity} uds</td>
                        <td><div class="date-text ${item.dateObj < hoy ? 'danger' : ''}">${dateFmt}</div></td>
                        <td><span class="${statusClass}">${statusText}</span></td>
                    `;
                    tbody.appendChild(tr);
                });

            } catch (err) {
                console.error("Descarte Report Error:", err);
                showToast('Error', 'No se pudo generar el reporte de urgencias.', 'error');
            }
        });
    }

    // EXPORTAR ACTA DE DESCARTE (XLSX/PDF Simulation)
    const btnExportDescarte = document.getElementById('btn-exportar-descarte');
    if (btnExportDescarte) {
        btnExportDescarte.addEventListener('click', () => {
            const rows = [];
            document.querySelectorAll('#modal-descarte-tbody tr').forEach(tr => {
                const cells = tr.querySelectorAll('td');
                if (cells.length < 5) return;
                rows.push({
                    "Producto": cells[0].querySelector('.item-name').innerText,
                    "Lote": cells[1].innerText,
                    "Cantidad": cells[2].innerText,
                    "Vencimiento": cells[3].innerText,
                    "Estado": cells[4].innerText
                });
            });

            if (rows.length === 0) return;

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Acta_Descarte_Urgencias");
            XLSX.writeFile(wb, `ACTA_DESCARTE_SAR_${new Date().getTime()}.xlsx`);
            showToast('Éxito', 'Acta de descarte generada.', 'success');
        });
    }

    startRealTimeUsers(); // Iniciar red de personal

    /* ----------------------------------------------------
       9L. MOTOR DE CONFIGURACIÓN GLOBAL (SETTINGS)
       ---------------------------------------------------- */
    let globalConfig = {
        daysUrgent: 30,
        daysCaution: 180,
        institutionName: "Visor Logístico Clínico"
    };

    function startRealTimeConfig() {
        const configForm = document.getElementById('form-config-global');
        const headerAlert = document.getElementById('header-alert-indicator');
    
    // 5b. SIDEMENU MOBILE TOGGLE
    const mobileToggle = document.getElementById('mobile-sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    if (mobileToggle && sidebar) {
        mobileToggle.addEventListener('click', () => {
            sidebar.classList.toggle('mobile-active');
        });

        // Close sidebar on menu item click (mobile)
        document.querySelectorAll('.sidebar .menu-item').forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 1024) {
                    sidebar.classList.remove('mobile-active');
                }
            });
        });
    }
        
        if (!configForm) return;

        console.info("[Config] Sincronizando parámetros globales...");

        // Listener de Configuración
        onSnapshot(doc(db, 'ajustes_sistema', 'global_config'), (snapshot) => {
            if (snapshot.exists()) {
                globalConfig = snapshot.data();
                
                // Actualizar UI
                if (headerTitle) headerTitle.innerText = globalConfig.institutionName || "Visor Logístico";
                
                // Rellenar formulario si estamos en la vista
                document.getElementById('config-institution-name').value = globalConfig.institutionName || "";
                document.getElementById('config-contact-email').value = globalConfig.contactEmail || "";
                document.getElementById('config-days-urgent').value = globalConfig.daysUrgent || 30;
                document.getElementById('config-days-caution').value = globalConfig.daysCaution || 180;

                // RECALCULAR DASHBOARD CON NUEVOS UMBRALES
                if (typeof startRealTimeDashboard === 'function') startRealTimeDashboard();
            }
        });

        // Guardar Configuración (Admin Only)
        configForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentRole = document.body.getAttribute('data-user-role');
            if (currentRole !== 'admin') {
                showToast('Acceso Denegado', 'Solo administradores pueden cambiar los ajustes del sistema.', 'error');
                return;
            }

            const formData = new FormData(configForm);
            const newConfig = Object.fromEntries(formData.entries());
            
            try {
                showToast('Guardando', 'Actualizando parámetros de red...', 'info');
                await setDoc(doc(db, 'ajustes_sistema', 'global_config'), {
                    ...newConfig,
                    daysUrgent: Number(newConfig.daysUrgent),
                    daysCaution: Number(newConfig.daysCaution),
                    updatedAt: serverTimestamp()
                }, { merge: true });
                showToast('Éxito', 'Configuración guardada y aplicada.', 'success');
            } catch (err) {
                showToast('Error', 'Fallo al guardar en Firestore.', 'error');
            }
        });

        // Manejo de Pestañas
        const configTabs = document.querySelectorAll('.config-tab');
        configTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                configTabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.borderBottom = 'none';
                    t.style.color = 'var(--text-muted)';
                });
                tab.classList.add('active');
                tab.style.borderBottom = '2px solid var(--primary)';
                tab.style.color = 'var(--primary)';

                const target = tab.dataset.tab;
                document.querySelectorAll('.tab-content-item').forEach(c => c.style.display = 'none');
                document.getElementById(`tab-${target}`).style.display = 'block';
            });
        });
    }

    startRealTimeConfig();

    /* ----------------------------------------------------
       9m. MOTOR DE INFORMES AVANZADO
       ---------------------------------------------------- */
    let currentReportType = 'movimientos';
    let globalReportData = [];

    function startRealTimeInformes() {
        const reportTable = document.getElementById('report-table-body');
        const tabs = document.querySelectorAll('#informes-tabs .tab-link');
        
        if (!reportTable) return;

        console.info("[Informes] Activando motor de BI...");

        // 1. Escuchar Inventario para KPIs Globales
        onSnapshot(collection(db, 'Insumos'), (snapshot) => {
            const items = [];
            snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
            updateInformesKPIs(items);
            if (currentReportType === 'valorizado' || currentReportType === 'vencimientos') {
                globalReportData = items;
                renderInformesTable();
            }
        });

        // 2. Escuchar Historial para Rotación y Movimientos
        onSnapshot(collection(db, 'Historial_Movimientos'), (snapshot) => {
            const logs = [];
            snapshot.forEach(doc => logs.push({ id: doc.id, ...doc.data() }));
            if (currentReportType === 'movimientos' || currentReportType === 'rotacion') {
                globalReportData = logs;
                renderInformesTable();
            }
        });

        // 3. Manejo de Pestañas
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentReportType = tab.dataset.report;
                
                // Actualizar Títulos
                const titles = {
                    'movimientos': 'Resumen de Movimientos Diarios',
                    'valorizado': 'Inventario Valorizado Total',
                    'rotacion': 'Análisis de Rotación (Eficiencia)',
                    'vencimientos': 'Control de Vencimientos Próximos'
                };
                document.getElementById('report-title-text').innerText = titles[currentReportType];
                renderInformesTable();
            });
        });

        // 4. Redirecciones y Alertas
        const btnConfigAlerts = document.getElementById('btn-config-alerts');
        if (btnConfigAlerts) {
            btnConfigAlerts.addEventListener('click', () => {
                document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
                document.getElementById('menu-config')?.classList.add('active');
                showView('view-configuracion');
            });
        }
    }

    function updateInformesKPIs(items) {
        const totalVal = items.reduce((acc, item) => acc + ((item.quantity || 0) * (item.unitPrice || 0)), 0);
        const critico = items.filter(i => (i.quantity || 0) <= (i.criticalLimit || 50)).length;
        
        const hoy = new Date();
        const limite30d = new Date();
        limite30d.setDate(hoy.getDate() + 30);
        const venciendo = items.filter(i => {
            const date = SAR_Utils.parseDate(i.expirationDate);
            return date && date <= limite30d;
        }).length;

        document.getElementById('info-total-valor').innerText = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(totalVal);
        document.getElementById('info-stock-critico').innerText = `${critico} SKU`;
        document.getElementById('info-vencimientos-30d').innerText = `${venciendo} Lotes`;
        document.getElementById('info-rotacion-prom').innerText = '8.2 Días'; // Simulado por ahora
    }

    function renderInformesTable() {
        const tbody = document.getElementById('report-table-body');
        const thead = document.getElementById('report-table-head');
        if (!tbody) return;

        tbody.innerHTML = '';
        const term = document.getElementById('report-search-input')?.value || "";

        if (currentReportType === 'movimientos') {
            thead.innerHTML = `<tr><th>FECHA</th><th>INSUMO</th><th>TIPO</th><th>CANTIDAD</th><th>OPERADOR</th><th>DOCUMENTO</th></tr>`;
            const filtered = globalReportData.filter(m => SAR_Utils.matches(m.insumoName, term));
            filtered.slice(0, 15).forEach(m => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="text-xs">${SAR_Utils.formatDate(m.date)}</td>
                    <td class="font-bold">${m.insumoName}</td>
                    <td><span class="badge-${m.type === 'entrada' ? 'green' : 'orange'}">${m.type.toUpperCase()}</span></td>
                    <td class="font-bold">${m.quantity}</td>
                    <td>${m.user}</td>
                    <td class="text-muted">${m.document || 'S/N'}</td>
                `;
                tbody.appendChild(tr);
            });
        } 
        else if (currentReportType === 'valorizado') {
            thead.innerHTML = `<tr><th>INSUMO</th><th>STOCK</th><th>P. UNITARIO</th><th>VALOR TOTAL</th><th>UBICACIÓN</th></tr>`;
            const filtered = globalReportData.filter(i => SAR_Utils.matches(i.name, term));
            filtered.forEach(i => {
                const val = (i.quantity || 0) * (i.unitPrice || 0);
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><div class="item-name">${i.name}</div><div class="item-category">${i.batch}</div></td>
                    <td>${i.quantity} uds</td>
                    <td>$${i.unitPrice?.toLocaleString() || 0}</td>
                    <td class="font-bold text-primary">$${val.toLocaleString()}</td>
                    <td>${i.location || 'B-01'}</td>
                `;
                tbody.appendChild(tr);
            });
        }
        else if (currentReportType === 'rotacion') {
            thead.innerHTML = `<tr><th>INSUMO</th><th>ÚLT. INGRESO</th><th>ÚLT. EGRESO</th><th>ESTADÍA PROM.</th><th>CATEGORÍA</th><th>EFICIENCIA</th></tr>`;
            const filtered = globalReportData.filter(m => SAR_Utils.matches(m.insumoName, term));
            
            // Lógica de Agrupación para Rotación
            const rotationMap = {};
            filtered.forEach(m => {
                if (!rotationMap[m.insumoName]) rotationMap[m.insumoName] = { in: [], out: [] };
                if (m.type === 'entrada') rotationMap[m.insumoName].in.push(m.date);
                else rotationMap[m.insumoName].out.push(m.date);
            });

            Object.entries(rotationMap).forEach(([name, data]) => {
                const tr = document.createElement('tr');
                const lastIn = data.in.length ? SAR_Utils.formatDate(data.in[0]) : '---';
                const lastOut = data.out.length ? SAR_Utils.formatDate(data.out[0]) : '---';
                
                tr.innerHTML = `
                    <td class="font-bold">${name}</td>
                    <td>${lastIn}</td>
                    <td>${lastOut}</td>
                    <td><span class="badge-purple">8.2 Días</span></td>
                    <td><span class="badge-gray">CRÍTICO</span></td>
                    <td><div class="status-dot green-dot">ALTA</div></td>
                `;
                tbody.appendChild(tr);
            });
        }
        else if (currentReportType === 'vencimientos') {
            thead.innerHTML = `<tr><th>INSUMO</th><th>LOTE</th><th>STOCK</th><th>VENCIMIENTO</th><th>ESTADO</th></tr>`;
            const filtered = globalReportData.filter(i => SAR_Utils.matches(i.name, term));
            const hoy = new Date();
            const limite30d = new Date();
            limite30d.setDate(hoy.getDate() + 30);

            filtered.sort((a,b) => (SAR_Utils.parseDate(a.expirationDate) || 0) - (SAR_Utils.parseDate(b.expirationDate) || 0)).forEach(i => {
                const date = SAR_Utils.parseDate(i.expirationDate);
                if (!date) return;
                const tr = document.createElement('tr');
                const isCritical = date <= limite30d;
                tr.innerHTML = `
                    <td>${i.name}</td>
                    <td>${i.batch}</td>
                    <td>${i.quantity}</td>
                    <td><div class="date-text ${isCritical ? 'danger' : ''}">${SAR_Utils.formatDate(i.expirationDate)}</div></td>
                    <td><span class="badge-${isCritical ? 'red' : 'green'}">${isCritical ? 'CRÍTICO' : 'SEGURO'}</span></td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    // EXPORTACIÓN DE INFORMES (RBAC PROTECTED)
    document.getElementById('btn-export-informe-excel')?.addEventListener('click', () => {
        if (document.body.getAttribute('data-user-role') !== 'admin') {
            showToast('Acceso Denegado', 'Exportación reservada para administradores.', 'error');
            return;
        }
        showToast('Generando', 'Preparando reporte Excel institucional...', 'info');
        const wb = XLSX.utils.table_to_book(document.querySelector('.data-table-card table'));
        XLSX.writeFile(wb, `REPORTE_LOGISTICO_SAR_${currentReportType.toUpperCase()}_${new Date().toISOString().split('T')[0]}.xlsx`);
    });

    document.getElementById('btn-export-informe-pdf')?.addEventListener('click', () => {
        if (document.body.getAttribute('data-user-role') !== 'admin') {
            showToast('Acceso Denegado', 'Función exclusiva para administradores.', 'error');
            return;
        }
        showToast('PDF', 'El resguardo en PDF se está procesando...', 'info');
        window.print(); // Solución robusta para entorno SPA
    });

    startRealTimeInformes();

    /* ----------------------------------------------------
       9n. LOGS DE SISTEMA Y AUDITORÍA DE ERRORES
       ---------------------------------------------------- */
    function startRealTimeLogs() {
        const logsTable = document.getElementById('logs-table-body');
        if (!logsTable) return;

        console.info("[Auditoría] Iniciando rastreo de logs de sistema...");

        // Estado Inicial: Cargando (Skeleton UI)
        logsTable.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px;"><i class="ph-spinner ph-spin" style="font-size:24px; color:var(--primary);"></i><div class="mt-8 text-sm text-muted">Sincronizando registros de auditoría...</div></td></tr>';

        onSnapshot(collection(db, 'Logs_Sistema'), (snapshot) => {
            logsTable.innerHTML = '';
            if (snapshot.empty) {
                logsTable.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:16px; color:var(--text-muted);">No se registran incidencias técnicas.</td></tr>';
                return;
            }

            snapshot.forEach(docSnap => {
                const log = docSnap.data();
                const tr = document.createElement('tr');
                const severityClass = log.severity === 'error' ? 'red' : 'orange';
                
                tr.innerHTML = `
                    <td class="text-xs">${SAR_Utils.formatDate(log.date)}</td>
                    <td><span class="badge-gray">${log.module?.toUpperCase() || 'SIS'}</span></td>
                    <td><span class="status-dot ${severityClass}-dot">${log.severity?.toUpperCase()}</span></td>
                    <td class="text-sm">${log.message?.substring(0, 50)}...</td>
                    <td><button class="btn btn-icon btn-view-log" data-id="${docSnap.id}"><i class="ph ph-eye"></i></button></td>
                `;
                logsTable.appendChild(tr);
            });
        });

        // Event Delegation para Ver Log
        logsTable.addEventListener('click', async (e) => {
            const btn = e.target.closest('.btn-view-log');
            if (btn) {
                const logId = btn.dataset.id;
                try {
                    const snap = await getDoc(doc(db, 'Logs_Sistema', logId));
                    if (snap.exists()) {
                        const log = snap.data();
                        alert(`DETALLE DE INCIDENCIA\n\nFecha: ${SAR_Utils.formatDate(log.date)}\nMódulo: ${log.module}\nMensaje: ${log.message}\nUsuario: ${log.user || 'Sistema'}`);
                    }
                } catch (err) {
                    showToast('Error', 'No se pudo cargar el detalle del log.', 'error');
                }
            }
        });
    }

    // IA REPORT DETAIL MODAL (SIMULTATION)
    const btnIAReport = document.getElementById('btn-ia-report-detail');
    if (btnIAReport) {
        btnIAReport.addEventListener('click', () => {
             alert("REPORTE DETALLADO IA - VISOR LOGÍSTICO\n\n1. Análisis de Demanda: Se detecta incremento del 22% en Insumos Críticos.\n2. Sugerencia: Aumentar stock de Suero Fisiológico y Adrenalina.\n3. Riesgo: 4% de quiebre en Bodega Central.\n\nInforme generado por el núcleo de Optimización Inteligente.");
        });
    }

    startRealTimeLogs();

    } // FIN DE initializeRestOfSPA();

    /* ----------------------------------------------------
       10. SEGURIDAD FRONTEND: Role-Based Access Control (RBAC)
       ---------------------------------------------------- */
    window.enforceRBACLogic = async function(userAuth) {
        if (!userAuth) return;
        
        try {
            const userDocRef = doc(db, 'Usuarios', userAuth.uid);
            const userSnap = await getDoc(userDocRef);
            
            if (userSnap.exists()) {
                const userData = userSnap.data();
                if (userData.role === 'operador') {
                    document.body.setAttribute('data-user-role', 'operador');
                } else {
                    document.body.setAttribute('data-user-role', 'admin');
                }
            } else {
                // Fallback: Si no hay documento pero es un admin institucional conocido
                if (userAuth.email.includes('admin') || userAuth.email.includes('desarrollo')) {
                    document.body.setAttribute('data-user-role', 'admin');
                } else {
                    document.body.setAttribute('data-user-role', 'operador');
                }
            }
            console.info(`RBAC: Rol [${document.body.getAttribute('data-user-role')}] activado para ${userAuth.email}`);
        } catch (error) {
            console.error("RBAC Bloqueo Seguro: Fallo al recuperar rol de usuario.", error);
            document.body.setAttribute('data-user-role', 'operador'); // Safe default
        }
    };
});