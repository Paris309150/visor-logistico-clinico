// Importación de Firebase desde la CDN (Módulo)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
// Exportaremos Auth aquí pronto...
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAyktOnoB-j7nX4-YZLa6B74wOBCbZvlSA",
  authDomain: "sarinventario.firebaseapp.com",
  projectId: "sarinventario",
  storageBucket: "sarinventario.firebasestorage.app",
  messagingSenderId: "358257655117",
  appId: "1:358257655117:web:b7f46ad97e94afa1324b04"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app); // Listo y exportado para usar la Autenticación

document.addEventListener('DOMContentLoaded', () => {
    console.log('Visor Logístico Clínico Inicializado - Todos los módulos activos');
    
    /* ----------------------------------------------------
       1. SISTEMA COMPLETO DE FEEDBACK (TOAST NOTIFICATIONS)
       ---------------------------------------------------- */
    const toastContainer = document.createElement('div');
    toastContainer.style.position = 'fixed';
    toastContainer.style.bottom = '20px';
    toastContainer.style.right = '20px';
    toastContainer.style.zIndex = '9999';
    toastContainer.style.display = 'flex';
    toastContainer.style.flexDirection = 'column';
    toastContainer.style.gap = '10px';
    document.body.appendChild(toastContainer);

    function showToast(title, text, type = 'info') {
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
    }

    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = `
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes spin { 100% { transform: rotate(360deg); } } 
        .ph-spin { animation: spin 1s linear infinite; }
    `;
    document.head.appendChild(styleSheet);


    /* ----------------------------------------------------
       2. NAVEGACIÓN PRINCIPAL (SIDEBAR)
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

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-target');
            if (!targetId) {
                if (item.classList.contains('danger')) {
                    showToast('Cierre de Sesión', 'Cerrando sesión del usuario...', 'warning');
                } else {
                    showToast('Configuración', 'Preparando entorno de configuración...', 'info');
                }
                return;
            }

            menuItems.forEach(i => { i.classList.remove('active'); i.classList.add('normal'); });
            item.classList.add('active'); item.classList.remove('normal');

            viewSections.forEach(section => {
                section.classList.remove('active');
                if (section.id === targetId) { section.classList.add('active'); }
            });

            if(topbarTitle && viewTitles[targetId]) {
                topbarTitle.textContent = viewTitles[targetId];
            }
            
            showToast('Navegación', `Cargando módulo: ${item.textContent.trim()}`, 'info');
        });
    });

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
            } else {
                btn.classList.add('active-blue');
                showToast('Tipo de Despacho', 'Registrando como SALIDA / TRANSFERENCIA.', 'info');
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
    if(formMovimiento) {
        formMovimiento.addEventListener('submit', (e) => {
            e.preventDefault();
            const btn = formMovimiento.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            
            btn.innerHTML = 'MOVIMIENTO REGISTRADO EXITOSAMENTE <i class="ph-fill ph-check-circle"></i>';
            btn.style.backgroundColor = 'var(--success)';
            showToast('Confirmación Logística', 'El inventario ha sido actualizado correctamente.', 'success');
            formMovimiento.reset();
            
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.backgroundColor = 'var(--primary)';
            }, 3000);
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
});