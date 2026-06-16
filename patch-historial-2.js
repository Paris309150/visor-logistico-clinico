const fs = require('fs');

const scriptJsPath = 'c:/Users/usuario/Documents/VISOR/script.js';
let scriptJs = fs.readFileSync(scriptJsPath, 'utf8');

const regex = /window\.startHistorialBandejasEnfermero = async function\(\) \{[\s\S]*?(?=\/\/ Modificar el manejador para btn-procesar-cierre-final|\/\/ ==========================================|$)/m;

const newLogic = `window._historialEnfermeroData = [];

window.startHistorialBandejasEnfermero = async function() {
    if (!auth.currentUser) return;
    if (unsubHistorialBandejas) unsubHistorialBandejas();

    const container = document.getElementById('lista-historial-bandejas');
    if (!container) return;
    container.innerHTML = '<div class="text-center"><i class="ph-spinner ph-spin"></i> Cargando historial...</div>';

    // REMOVED orderBy('fechaDespacho', 'desc') to prevent composite index requirement crash!
    const q = window.firebaseFirestore.query(
        window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno'),
        window.firebaseFirestore.where('enfermeroAsignado', '==', auth.currentUser.email)
    );

    unsubHistorialBandejas = window.firebaseFirestore.onSnapshot(q, (snapshot) => {
        window._historialEnfermeroData = [];
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const validEstados = ['EN_RECEPCION', 'CERRADA_BODEGA', 'ANULADA'];
            if (!validEstados.includes(data.estado)) return;
            
            let fechaDate = data.fechaCruce ? (typeof data.fechaCruce.toDate === 'function' ? data.fechaCruce.toDate() : new Date(data.fechaCruce)) : 
                           (data.fechaDespacho ? (typeof data.fechaDespacho.toDate === 'function' ? data.fechaDespacho.toDate() : new Date(data.fechaDespacho)) : new Date());
            
            window._historialEnfermeroData.push({
                id: docSnap.id,
                ...data,
                _fechaOrden: fechaDate
            });
        });
        
        // Sort descending by date locally
        window._historialEnfermeroData.sort((a, b) => b._fechaOrden - a._fechaOrden);
        
        window.renderHistorialBandejas();
    }, (error) => {
        console.error("Error en onSnapshot de Historial:", error);
        container.innerHTML = \`<div class="text-center text-danger">Error: \${error.message}</div>\`;
    });
};

window.renderHistorialBandejas = function() {
    const container = document.getElementById('lista-historial-bandejas');
    if (!container) return;
    container.innerHTML = '';
    
    const inputSearch = document.getElementById('input-search-historial');
    const selectTime = document.getElementById('select-filtro-tiempo-historial');
    
    const searchTerm = inputSearch ? inputSearch.value.trim().toLowerCase() : '';
    const timeFilter = selectTime ? selectTime.value : '30days';
    
    let now = new Date();
    let limiteFecha = null;
    
    if (timeFilter === '30days') {
        limiteFecha = new Date();
        limiteFecha.setDate(now.getDate() - 30);
    } else if (timeFilter === '7days') {
        limiteFecha = new Date();
        limiteFecha.setDate(now.getDate() - 7);
    }

    let count = 0;
    
    window._historialEnfermeroData.forEach(data => {
        // Filtro de Tiempo
        if (limiteFecha && data._fechaOrden < limiteFecha) return;
        
        // Búsqueda
        const trackingDisplay = data.tracking || data.identificador || data.id.substring(0, 8);
        const searchString = \`\${trackingDisplay} \${data.identificador}\`.toLowerCase();
        
        if (searchTerm && !searchString.includes(searchTerm)) return;

        count++;
        
        const div = document.createElement('div');
        div.className = 'data-table-card';
        div.style.marginBottom = '16px';
        div.style.border = '1px solid #dee2e6';
        div.style.borderRadius = '8px';
        div.style.overflow = 'hidden';

        let badgeBg = '#6c757d';
        if (data.estado === 'EN_RECEPCION') badgeBg = 'var(--warning)';
        if (data.estado === 'CERRADA_BODEGA') badgeBg = 'var(--success)';
        if (data.estado === 'ANULADA') badgeBg = 'var(--danger)';
        
        const dateStr = data._fechaOrden.toLocaleString();
        
        // Analizar si hay incidencias para pintar el header de rojo
        let hayIncidencia = false;
        if (data.estado === 'ANULADA') hayIncidencia = true;
        
        const cruceArray = data.cruceCierreTurno || [];
        if (data.medicamentos && data.medicamentos.length > 0) {
            data.medicamentos.forEach(med => {
                const devueltoBodega = med.cantidadRetornadaOperador !== undefined ? med.cantidadRetornadaOperador : '?';
                if (devueltoBodega !== '?') {
                    const debioVolver = (med.cantidadRecibida || 0) - (med.cantidadConsumida || 0) - (med.cantidadMerma || 0);
                    if (devueltoBodega < debioVolver) hayIncidencia = true;
                }
                if (med.observacionOperador && med.observacionOperador.trim() !== '') hayIncidencia = true;
                
                const nombre = med.nombreInsumo || med.nombre;
                const cruceMatch = cruceArray.find(c => c.nombreInsumo === nombre);
                if (cruceMatch && !cruceMatch.coincide) hayIncidencia = true;
            });
        }
        
        let headerBg = data.estado === 'CERRADA_BODEGA' ? '#f0fdf4' : '#f8f9fa';
        let headerBorder = '';
        
        // SOBRESCRIBIR DISEÑO SI HAY INCIDENCIA:
        if (hayIncidencia) {
            headerBg = '#fff0f0'; // Fondo rojo claro
            headerBorder = 'border-left: 5px solid #dc3545;'; // Borde rojo fuerte a la izquierda
        }

        let html = \`
            <!-- HEADER ACORDEÓN -->
            <div class="bandeja-accordion-header" style="background: \${headerBg}; \${headerBorder} padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none';">
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <strong style="font-size: 1.1em; color: \${hayIncidencia ? '#dc3545' : '#212529'};">\${hayIncidencia ? '<i class="ph ph-warning"></i> ' : ''}\${trackingDisplay}</strong>
                    <span class="text-muted" style="font-size: 0.85em;"><i class="ph ph-calendar"></i> Fecha Cierre: \${dateStr}</span>
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                    <span class="badge" style="background: \${badgeBg}; color: \${data.estado === 'EN_RECEPCION' ? '#000' : '#fff'}; font-weight: bold; padding: 6px 12px; border-radius: 20px;">\${data.estado.replace('_', ' ')}</span>
                    \${hayIncidencia ? '<small style="color: #dc3545; font-weight: bold;">Presenta Incidencias</small>' : ''}
                </div>
            </div>
            
            <!-- BODY ACORDEÓN -->
            <div class="bandeja-accordion-body" style="display: none; padding: 20px; border-top: 1px solid #dee2e6; background: white;">
                <div style="margin-bottom: 15px; font-weight: bold; color: #495057;">
                    <i class="ph ph-scales"></i> Arqueo Tripartito
                </div>
        \`;

        if (data.estado === 'ANULADA') {
            html += \`<div class="alert alert-danger">Bandeja anulada. Motivo: \${data.justificacionAnulacion || 'N/A'}</div>\`;
        } else if (data.medicamentos && data.medicamentos.length > 0) {
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

            data.medicamentos.forEach(med => {
                const nombre = med.nombreInsumo || med.nombre;
                const cantidadConsumida = med.cantidadConsumida || 0;
                const devueltoBodega = med.cantidadRetornadaOperador !== undefined ? med.cantidadRetornadaOperador : '?';
                const obsOperador = med.observacionOperador || '';

                const cruceMatch = cruceArray.find(c => c.nombreInsumo === nombre);
                const excelValor = cruceMatch ? cruceMatch.usoRayen : '?';

                let rowBg = '';
                if (devueltoBodega !== '?') {
                    const debioVolver = (med.cantidadRecibida || 0) - (med.cantidadConsumida || 0) - (med.cantidadMerma || 0);
                    if (devueltoBodega < debioVolver) rowBg = '#ffe0e0'; 
                    if (devueltoBodega === debioVolver && debioVolver > 0) rowBg = '#e0ffe0'; 
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

        html += \`</div>\`;
        div.innerHTML = html;
        container.appendChild(div);
    });

    if (count === 0) {
        container.innerHTML = '<div class="text-center text-muted" style="padding: 20px;"><i class="ph ph-magnifying-glass" style="font-size: 3em; color: #dee2e6; display: block; margin-bottom: 10px;"></i>No se encontraron resultados para los filtros actuales.</div>';
    }
};

`;

if (regex.test(scriptJs)) {
    scriptJs = scriptJs.replace(regex, newLogic);
    fs.writeFileSync(scriptJsPath, scriptJs);
    console.log("Parche aplicado con xito.");
} else {
    console.log("No se pudo encontrar el bloque startHistorialBandejasEnfermero con el regex.");
}
