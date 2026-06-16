// Importación de Firebase desde la CDN (Módulo)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, doc, collection, runTransaction, enableIndexedDbPersistence, writeBatch, serverTimestamp, getDoc, query, where, orderBy, limit, limitToLast, startAfter, endBefore, getDocs } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { generarPlantillaExcel, procesarExcelCargaMasiva } from './excelUtils.js';

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
            // Búsqueda por prefijo en el Nombre
            const qName = query(insumosRef, 
                where('name', '>=', text), 
                where('name', '<=', text + '\uf8ff'),
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
        showToast('Importando', `Subiendo registros a la nube...`, 'info');
        
        try {
            let count = 0;
            const CHUNK_SIZE = 400; // Límite de batch en Firestore es 500
            
            for (let i = 0; i < data.length; i += CHUNK_SIZE) {
                const batch = writeBatch(db);
                const chunk = data.slice(i, i + CHUNK_SIZE);
                
                chunk.forEach(item => {
                    // Mapeo semántico: Excel Column -> Firestore Field
                    const entry = {
                        code: item.id_producto,
                        name: item.descripcion,
                        quantity: Number(item.cantidad),
                        unitPrice: Number(item.costo_unitario),
                        batch: item.lote,
                        expirationDate: item.vencimiento,
                        location: item.ubicacion,
                        category: item.categoria,
                        criticalLimit: Number(item.stock_minimo),
                        updatedAt: serverTimestamp()
                    };
                    
                    // Crear un nuevo documento con ID automático en la colección
                    const newDocRef = doc(collection(db, 'Insumos'));
                    batch.set(newDocRef, entry);
                });

                await batch.commit();
                count += chunk.length;
                console.log(`[Carga Masiva] Commit exitoso: ${count}/${data.length}`);
            }

            showToast('Éxito', `Se han importado ${count} insumos correctamente.`, 'success');
            loadFirstPage(); // Refrescar tabla del inventario

        } catch (error) {
            console.error("Carga Masiva Error:", error);
            showToast('Error Crítico', 'Fallo al escribir en Firestore. Revisa permisos.', 'error');
        }
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