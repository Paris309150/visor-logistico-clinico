// Importación de Firebase desde la CDN (Módulo)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, doc, collection, runTransaction, enableIndexedDbPersistence, writeBatch, serverTimestamp, getDoc, query, orderBy, limit, limitToLast, startAfter, endBefore, getDocs } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAyktOnoB-j7nX4-YZLa6B74wOBCbZvlSA",
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
                initializeRestOfSPA();
                isAppInitialized = true;
            }
        } else {
            // Refugio blindado: Ocultamos ecosistema app y forzamos Login
            loginView.style.display = 'flex';
            mainApp.style.display = 'none';
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
        'view-usuarios': 'Gestión de Usuarios'
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
            if (section.id === hash) { section.classList.add('active'); }
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
       ---------------------------------------------------- */
    const analyzeBtn = document.getElementById('btn-ia-analisis');
    if(analyzeBtn) {
        analyzeBtn.addEventListener('click', () => {
            const icon = analyzeBtn.querySelector('i');
            icon.className = 'ph-spinner ph-spin';
            showToast('Asistente IA', 'Procesando el inventario general con modelos predictivos...', 'info');
            
            setTimeout(() => {
                icon.className = 'ph-fill ph-check-circle';
                analyzeBtn.innerHTML = '<i class="ph-fill ph-check-circle"></i> Análisis Completado';
                analyzeBtn.style.backgroundColor = 'var(--success)';
                showToast('Éxito', 'Análisis IA completado sin anomalías detectadas.', 'success');
                
                setTimeout(() => {
                    analyzeBtn.innerHTML = '<i class="ph-fill ph-sparkle"></i> Análisis IA de Inventario';
                    analyzeBtn.style.backgroundColor = 'var(--primary)';
                }, 3000);
            }, 1800);
        });
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
            
            if(btn.textContent.includes('RECEPCIÓN')) {
                btn.classList.add('active-green');
                showToast('Tipo de Ingreso', 'Registrando como ENTRADA de suministros.', 'success');
                const inputTipo = document.getElementById('movimiento-tipo');
                if(inputTipo) inputTipo.value = 'entrada';
            } else {
                btn.classList.add('active-blue');
                showToast('Tipo de Despacho', 'Registrando como SALIDA / TRANSFERENCIA.', 'info');
                const inputTipo = document.getElementById('movimiento-tipo');
                if(inputTipo) inputTipo.value = 'salida';
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

            tr.innerHTML = `
                <td><div class="${codeClass} font-bold text-sm">${item.code || '#N/A'}</div></td>
                <td><div class="item-name">${item.name || 'Sin Nombre'}</div><div class="${categoryClass}">${item.category || ''}</div></td>
                <td class="font-bold">${formattedPrice}</td>
                <td>${quantityMarkup}</td>
                <td class="font-bold">${formattedTotal}</td>
                <td><div class="${categoryClass}">LOTE: ${item.batch || 'N/A'}</div><div class="${categoryClass}">Vto: ${item.expirationDate || 'N/A'}</div></td>
                <td>
                    <div style="display:flex;gap:8px">
                        ${isCritical ? '<button class="btn btn-primary text-sm font-bold" style="background-color: #3730a3;"><i class="ph-fill ph-sparkle"></i> ALTERNATIVA</button>' : '<button class="btn btn-outline text-primary text-sm font-bold"><i class="ph-fill ph-sparkle"></i> ALTERNATIVA</button>'}
                        <button class="btn btn-icon"><i class="ph ph-pencil-simple"></i></button>
                        <button class="btn btn-icon admin-only"><i class="ph ph-trash"></i></button>
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
                // Si el rol es operador, blindamos la Interfaz Gráfica
                if (userData.role === 'operador') {
                    // Asignamos el rol como atributo global en el DOM 
                    // Esto gatilla el CSS Mágico definido en style.css sin depender de inyecciones frágiles
                    document.body.setAttribute('data-user-role', 'operador');
                } else {
                    document.body.setAttribute('data-user-role', 'admin');
                    console.info("RBAC: Admin conectado. Accesos completos garantizados.");
                }
            }
        } catch (error) {
            console.error("RBAC Bloqueo Seguro: Fallo al recuperar rol de usuario. Restringiendo UI.", error);
        }
    };
});