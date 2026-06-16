const fs = require('fs');

const indexHtmlPath = 'c:/Users/usuario/Documents/VISOR/index.html';
const scriptJsPath = 'c:/Users/usuario/Documents/VISOR/script.js';

let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
let scriptJs = fs.readFileSync(scriptJsPath, 'utf8');

console.log("Parcheando index.html...");

// 1. Inyectar botn en los tabs
const tabToFind = `<button id="tab-mis-bandejas" class="btn btn-outline-primary" style="font-weight: 500; font-size: 1.05em; padding: 10px 25px;">
                <i class="ph ph-list-checks" style="font-size: 1.2em; vertical-align: middle; margin-right: 8px;"></i> Mis Bandejas Activas
            </button>`;

const newTab = `<button id="tab-mis-bandejas" class="btn btn-outline-primary" style="font-weight: 500; font-size: 1.05em; padding: 10px 25px;">
                <i class="ph ph-list-checks" style="font-size: 1.2em; vertical-align: middle; margin-right: 8px;"></i> Mis Bandejas Activas
            </button>
            <button id="tab-historial-bandejas" class="btn btn-outline-primary" style="font-weight: 500; font-size: 1.05em; padding: 10px 25px;">
                <i class="ph ph-clock-counter-clockwise" style="font-size: 1.2em; vertical-align: middle; margin-right: 8px;"></i> Historial de Bandejas
            </button>`;

if (indexHtml.includes(tabToFind)) {
    indexHtml = indexHtml.replace(tabToFind, newTab);
    console.log("Tab inyectado.");
} else {
    console.log("! No se encontr el botn tab-mis-bandejas.");
}

// 2. Inyectar el panel
const panelToFind = `<div id="panel-mis-bandejas" style="display: none; background: white; padding: 35px; border-radius: 10px; border: 1px solid #dee2e6; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
                <h3 style="margin: 0; color: #212529;"><i class="ph ph-list-dashes" style="margin-right: 10px;"></i>Mis Bandejas Activas</h3>
            </div>
            
            <div id="lista-mis-bandejas" style="display: flex; flex-direction: column; gap: 20px; width: 100%;">
                <!-- Tarjetas de bandejas renderizadas dinmicamente -->
            </div>
        </div>`;

const newPanel = `<div id="panel-mis-bandejas" style="display: none; background: white; padding: 35px; border-radius: 10px; border: 1px solid #dee2e6; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
                <h3 style="margin: 0; color: #212529;"><i class="ph ph-list-dashes" style="margin-right: 10px;"></i>Mis Bandejas Activas</h3>
            </div>
            
            <div id="lista-mis-bandejas" style="display: flex; flex-direction: column; gap: 20px; width: 100%;">
                <!-- Tarjetas de bandejas renderizadas dinmicamente -->
            </div>
        </div>

        <!-- PANEL 3: HISTORIAL DE BANDEJAS -->
        <div id="panel-historial-bandejas" style="display: none; background: white; padding: 35px; border-radius: 10px; border: 1px solid #dee2e6; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
                <h3 style="margin: 0; color: #212529;"><i class="ph ph-clock-counter-clockwise" style="margin-right: 10px;"></i>Historial de Bandejas y Recepciones</h3>
                <span class="text-muted text-sm"><i class="ph ph-info"></i> Mostrando ltimos 30 das</span>
            </div>
            
            <div id="lista-historial-bandejas" style="display: flex; flex-direction: column; gap: 20px; width: 100%;">
                <!-- Tarjetas histricas renderizadas dinmicamente -->
            </div>
        </div>`;

if (indexHtml.includes(panelToFind)) {
    indexHtml = indexHtml.replace(panelToFind, newPanel);
    console.log("Panel inyectado.");
} else {
    console.log("! No se encontr el panel-mis-bandejas.");
}

fs.writeFileSync(indexHtmlPath, indexHtml);


console.log("Parcheando script.js...");

// 3. Modificar startBandejasModule para el tercer tab
const bandejasModuleRegex = /window\.startBandejasModule = async function \(\) \{[\s\S]*?const tabCrear = document\.getElementById\('tab-crear-bandeja'\);[\s\S]*?newTabMis\.className = 'btn btn-primary';\s*newTabCrear\.className = 'btn btn-outline-primary';\s*\}\);\s*\}/m;

const replacementModule = `window.startBandejasModule = async function () {
        // 1. Lgica de Pestaas (Tabs)
        const tabCrear = document.getElementById('tab-crear-bandeja');
        const tabMis = document.getElementById('tab-mis-bandejas');
        const tabHistorial = document.getElementById('tab-historial-bandejas');
        const panelCrear = document.getElementById('panel-crear-bandeja');
        const panelMis = document.getElementById('panel-mis-bandejas');
        const panelHistorial = document.getElementById('panel-historial-bandejas');

        if (tabCrear && tabMis && panelCrear && panelMis && tabHistorial && panelHistorial) {
            // Limpiar listeners anteriores clonando
            const newTabCrear = tabCrear.cloneNode(true);
            tabCrear.parentNode.replaceChild(newTabCrear, tabCrear);
            const newTabMis = tabMis.cloneNode(true);
            tabMis.parentNode.replaceChild(newTabMis, tabMis);
            const newTabHistorial = tabHistorial.cloneNode(true);
            tabHistorial.parentNode.replaceChild(newTabHistorial, tabHistorial);

            const deseleccionarTodos = () => {
                panelCrear.style.display = 'none';
                panelMis.style.display = 'none';
                panelHistorial.style.display = 'none';
                newTabCrear.className = 'btn btn-outline-primary';
                newTabMis.className = 'btn btn-outline-primary';
                newTabHistorial.className = 'btn btn-outline-primary';
            };

            newTabCrear.addEventListener('click', () => {
                deseleccionarTodos();
                panelCrear.style.display = 'block';
                newTabCrear.className = 'btn btn-primary';
            });

            newTabMis.addEventListener('click', () => {
                deseleccionarTodos();
                panelMis.style.display = 'block';
                newTabMis.className = 'btn btn-primary';
            });

            newTabHistorial.addEventListener('click', () => {
                deseleccionarTodos();
                panelHistorial.style.display = 'block';
                newTabHistorial.className = 'btn btn-primary';
                if(window.startHistorialBandejasEnfermero) window.startHistorialBandejasEnfermero();
            });
        }`;

if (bandejasModuleRegex.test(scriptJs)) {
    scriptJs = scriptJs.replace(bandejasModuleRegex, replacementModule);
    console.log("startBandejasModule actualizado para soportar 3 tabs.");
} else {
    console.log("! No se encontr startBandejasModule para reemplazar.");
}


// 4. Aadir lgica de historial al final
const historialLogic = `
// ==========================================
// FASE 33: HISTORIAL Y TRAZABILIDAD ENFERMERA
// ==========================================
let unsubHistorialBandejas = null;
window.startHistorialBandejasEnfermero = async function() {
    if (!auth.currentUser) return;
    if (unsubHistorialBandejas) unsubHistorialBandejas();

    const container = document.getElementById('lista-historial-bandejas');
    if (!container) return;
    container.innerHTML = '<div class="text-center"><i class="ph-spinner ph-spin"></i> Cargando historial...</div>';

    // Fecha de hace 30 das
    const hace30Dias = new Date();
    hace30Dias.setDate(hace30Dias.getDate() - 30);

    // Consulta: Bandejas del enfermero que no estn CREADA o EN_USO
    // Nota: Como Firestore requiere ndices compuestos, filtramos estado localmente si es necesario, 
    // pero podemos consultar por enfermero y order by fecha.
    const q = window.firebaseFirestore.query(
        window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno'),
        window.firebaseFirestore.where('enfermeroAsignado', '==', auth.currentUser.email),
        window.firebaseFirestore.orderBy('fechaDespacho', 'desc')
    );

    unsubHistorialBandejas = window.firebaseFirestore.onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        let hasVisibleTrays = false;

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            
            // Filtrar las que estn cerradas o en recepcin, y dentro de los ltimos 30 das
            const validEstados = ['EN_RECEPCION', 'CERRADA_BODEGA', 'ANULADA'];
            if (!validEstados.includes(data.estado)) return;
            
            let fechaDate = data.fechaCruce ? (typeof data.fechaCruce.toDate === 'function' ? data.fechaCruce.toDate() : new Date()) : 
                           (data.fechaDespacho ? (typeof data.fechaDespacho.toDate === 'function' ? data.fechaDespacho.toDate() : new Date()) : new Date());
            
            if (fechaDate < hace30Dias) return;

            hasVisibleTrays = true;
            
            const div = document.createElement('div');
            div.className = 'data-table-card';
            div.style.marginBottom = '16px';
            div.style.border = '1px solid #dee2e6';
            div.style.borderRadius = '8px';
            div.style.overflow = 'hidden';

            const trackingDisplay = data.tracking || data.identificador || docSnap.id.substring(0, 8);
            let badgeBg = '#6c757d';
            if (data.estado === 'EN_RECEPCION') badgeBg = 'var(--warning)';
            if (data.estado === 'CERRADA_BODEGA') badgeBg = 'var(--success)';
            if (data.estado === 'ANULADA') badgeBg = 'var(--danger)';
            
            const dateStr = fechaDate.toLocaleString();

            let html = \`
                <!-- HEADER ACORDEN -->
                <div class="bandeja-accordion-header" style="background: \${data.estado === 'CERRADA_BODEGA' ? '#f0fdf4' : '#f8f9fa'}; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none';">
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <strong style="font-size: 1.1em; color: #212529;">\${trackingDisplay}</strong>
                        <span class="text-muted" style="font-size: 0.85em;"><i class="ph ph-calendar"></i> Fecha Cierre: \${dateStr}</span>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                        <span class="badge" style="background: \${badgeBg}; color: \${data.estado === 'EN_RECEPCION' ? '#000' : '#fff'}; font-weight: bold; padding: 6px 12px; border-radius: 20px;">\${data.estado.replace('_', ' ')}</span>
                    </div>
                </div>
                
                <!-- BODY ACORDEN -->
                <div class="bandeja-accordion-body" style="display: none; padding: 20px; border-top: 1px solid #dee2e6; background: white;">
                    <div style="margin-bottom: 15px; font-weight: bold; color: #495057;">
                        <i class="ph ph-scales"></i> Arqueo Tripartito
                    </div>
            \`;

            if (data.estado === 'ANULADA') {
                html += \`<div class="alert alert-danger">Bandeja anulada. Motivo: \${data.justificacionAnulacion || 'N/A'}</div>\`;
            } else if (data.medicamentos && data.medicamentos.length > 0) {
                // Generar tabla comparativa
                html += \`
                    <div class="table-responsive" style="border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden;">
                        <table class="table table-hover table-sm mb-0">
                            <thead style="background: #f1f3f5;">
                                <tr>
                                    <th>Fármaco</th>
                                    <th style="text-align: center;" title="Reportado en Visor por Enfermera">Uso VISOR</th>
                                    <th style="text-align: center;" title="Según reporte de sistema Rayen">Uso EXCEL</th>
                                    <th style="text-align: center;" title="Cantidades sobrantes que volvieron a bodega central">Físico en Bodega</th>
                                    <th>Incidencias Bodega</th>
                                </tr>
                            </thead>
                            <tbody>
                \`;

                // Combinamos info
                const cruceArray = data.cruceCierreTurno || [];
                
                data.medicamentos.forEach(med => {
                    const nombre = med.nombreInsumo || med.nombre;
                    const cantidadConsumida = med.cantidadConsumida || 0;
                    const devueltoBodega = med.cantidadRetornadaOperador !== undefined ? med.cantidadRetornadaOperador : '?';
                    const obsOperador = med.observacionOperador || '';

                    // Buscar en cruce
                    const cruceMatch = cruceArray.find(c => c.nombreInsumo === nombre);
                    const excelValor = cruceMatch ? cruceMatch.usoRayen : '?';

                    // Chequear discrepancias
                    let rowBg = '';
                    if (devueltoBodega !== '?') {
                        // Formula: Asignado - Consumido - Mermas = Lo que DEBI volver
                        const debioVolver = (med.cantidadRecibida || 0) - (med.cantidadConsumida || 0) - (med.cantidadMerma || 0);
                        if (devueltoBodega < debioVolver) rowBg = '#ffe0e0'; // Rojo suave si bodega recibi menos de lo esperado
                        if (devueltoBodega === debioVolver && debioVolver > 0) rowBg = '#e0ffe0'; // Verde si devolvi justo lo esperado
                    }

                    html += \`
                        <tr style="background-color: \${rowBg};">
                            <td>\${nombre}</td>
                            <td style="text-align: center; font-weight: bold; color: #0d6efd;">\${cantidadConsumida}</td>
                            <td style="text-align: center; font-weight: bold; color: \${cruceMatch && !cruceMatch.coincide ? '#dc3545' : '#28a745'};">\${excelValor}</td>
                            <td style="text-align: center; font-weight: bold;">\${devueltoBodega}</td>
                            <td>\${obsOperador ? \`<span style="color: #dc3545; font-size: 0.85em;"><i class="ph ph-warning-circle"></i> \${obsOperador}</span>\` : '<span class="text-muted">-</span>'}</td>
                        </tr>
                    \`;
                });

                html += \`
                            </tbody>
                        </table>
                    </div>
                \`;
            }

            html += \`</div>\`; // Fin Body
            div.innerHTML = html;
            container.appendChild(div);
        });

        if (!hasVisibleTrays) {
            container.innerHTML = '<div class="text-center text-muted" style="padding: 20px;"><i class="ph ph-package" style="font-size: 3em; color: #dee2e6; display: block; margin-bottom: 10px;"></i>No tienes historial de bandejas cerradas en los últimos 30 días.</div>';
        }
    });
};
`;

if (!scriptJs.includes('startHistorialBandejasEnfermero')) {
    scriptJs += '\n' + historialLogic;
    console.log("Lgica de historial aadida.");
}

fs.writeFileSync(scriptJsPath, scriptJs);
console.log("Hecho.");
