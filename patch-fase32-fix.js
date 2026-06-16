const fs = require('fs');

const FILE_PATH = 'c:/Users/usuario/Documents/VISOR/script.js';
let code = fs.readFileSync(FILE_PATH, 'utf8');

// 1. Tracking Fix
const trackingRegex = /(const bandejaRef = window\.firebaseFirestore\.doc\(window\.firebaseFirestore\.collection\(window\.firebaseFirestore\.db \|\| window\.db \|\| db, 'Bandejas_Turno'\)\);\s*transaction\.set\(bandejaRef, \{\s*identificador: valorSelect,)/m;

const trackingReplacement = `const bandejaRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(window.firebaseFirestore.db || window.db || db, 'Bandejas_Turno'));
                    
                    const _now = new Date();
                    const _dd = String(_now.getDate()).padStart(2, '0');
                    const _mm = String(_now.getMonth() + 1).padStart(2, '0');
                    const _hh = String(_now.getHours()).padStart(2, '0');
                    const _min = String(_now.getMinutes()).padStart(2, '0');
                    const trackingNumber = \`BAN-\${_dd}\${_mm}-\${_hh}\${_min}\`;
                    
                    transaction.set(bandejaRef, {
                        tracking: trackingNumber,
                        creador: auth.currentUser.email,
                        identificador: valorSelect,`;

if (trackingRegex.test(code)) {
    code = code.replace(trackingRegex, trackingReplacement);
    console.log("Tracking number inyectado con xito.");
}

// 2. Accordion Fix
const bandejasRenderStartRegex = /const div = document\.createElement\('div'\);\s*div\.className = 'data-table-card';[\s\S]*?container\.appendChild\(div\);\s*console\.log\("\[Bandejas\] Appended OK\. Hijos despues:", container\.children\.length\);/g;

const renderAccordionReplacement = `const div = document.createElement('div');
                    div.className = 'data-table-card';
                    div.style.marginBottom = '16px';
                    div.style.border = '1px solid #dee2e6';
                    div.style.borderRadius = '8px';
                    div.style.overflow = 'hidden';

                    const trackingDisplay = data.tracking || data.identificador || docSnap.id.substring(0, 8);
                    const creatorDisplay = data.creador || data.creadoPor || 'Desconocido';
                    const badgeBg = data.estado === 'CREADA' ? 'var(--warning)' : 'var(--success)';
                    
                    let html = \`
                        <!-- HEADER DEL ACORDEN -->
                        <div class="bandeja-accordion-header" style="background: #f8f9fa; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.2s;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none';">
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <strong style="font-size: 1.1em; color: #212529;">\${trackingDisplay}</strong>
                                <span class="text-muted" style="font-size: 0.85em;"><i class="ph ph-package"></i> ID Fsico: \${data.identificador || docSnap.id.substring(0,8)}</span>
                            </div>
                            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                                <span class="badge" style="background: \${badgeBg}; color: #000; font-weight: bold; padding: 6px 12px; border-radius: 20px;">\${data.estado}</span>
                                <small style="color: #6c757d;">Creada por: \${creatorDisplay}</small>
                            </div>
                        </div>
                        
                        <!-- BODY DEL ACORDEN (OCULTO POR DEFECTO) -->
                        <div class="bandeja-accordion-body" style="display: none; padding: 20px; border-top: 1px solid #dee2e6; background: white;">
                    \`;

                    try {
                        if (data.fechaCreacion) {
                            const dateStr = typeof data.fechaCreacion.toDate === 'function' ? data.fechaCreacion.toDate().toLocaleString() : String(data.fechaCreacion);
                            html += \`<div style="font-size:0.85em; color:#666; margin-bottom: 15px; display:flex; justify-content:space-between; align-items: center;">
                                <span><i class="ph ph-clock"></i> <strong>Fecha Creacin:</strong> \${dateStr}</span>
                                \${data.estado === 'CREADA' && currentRole !== 'enfermero' ? \`<button type="button" class="btn btn-outline-primary btn-sm" onclick="window.abrirGestionBandeja('\${docSnap.id}', '\${data.enfermeroAsignado}')"><i class="ph ph-gear"></i> Gestionar</button>\` : ''}
                            </div>\`;
                        }
                    } catch (e) { console.error("Error formatting date:", e); }

                    if (data.estado === 'ANULADA') {
                        html += \`<div style="color:red; margin-bottom:10px;"><strong>Bandeja Anulada</strong> (\${data.justificacionAnulacion || 'Sin justificar'})</div>\`;
                    }

                    if (data.medicamentos && data.medicamentos.length > 0) {
                        html += \`
                            <div class="table-responsive" style="border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
                                <table class="table table-hover table-sm mb-0">
                                    <thead style="background: #f1f3f5;">
                                        <tr>
                                            <th>Frmaco / Insumo</th>
                                            <th style="text-align: center;">Stock Asignado</th>
                                            <th style="text-align: center; width: 120px;">Cant. Consumida</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                        \`;
                        
                        data.medicamentos.forEach((med, idx) => {
                            const maxVal = med.cantidadAsignada || 0;
                            const consumidoVal = med.cantidadConsumida !== undefined ? med.cantidadConsumida : 0;
                            const isEnUso = data.estado === 'EN_USO';
                            html += \`
                                <tr>
                                    <td>
                                        \${med.nombreInsumo || med.nombre}
                                        \${med.observacionAdicional ? \`<br><small class="text-muted">\${med.observacionAdicional}</small>\` : ''}
                                    </td>
                                    <td style="text-align: center; font-weight: bold;">\${maxVal}</td>
                                    <td style="text-align: center;">
                                        <input type="number" class="form-control input-consumo" 
                                            data-idx="\${idx}" 
                                            value="\${consumidoVal}" 
                                            min="0" max="\${maxVal}" 
                                            style="width: 80px; margin: 0 auto; text-align: center;"
                                            \${!isEnUso ? 'disabled' : ''}>
                                    </td>
                                </tr>
                            \`;
                        });
                        html += \`</tbody></table></div>\`;
                    }

                    // Acciones/Botones del Footer del Body
                    if (data.estado === 'CREADA') {
                        html += \`
                            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                                <button type="button" class="btn btn-primary" onclick="window.confirmarRecepcionBandeja('\${docSnap.id}')">
                                    <i class="ph ph-check-circle"></i> Aceptar y Poner en Uso
                                </button>
                            </div>
                        \`;
                    } else if (data.estado === 'EN_USO') {
                        html += \`
                            <div style="display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap;">
                                <button type="button" class="btn btn-primary" onclick="window.guardarProgresoBandeja('\${docSnap.id}')">
                                    <i class="ph ph-floppy-disk"></i> Guardar Registro
                                </button>
                                <button type="button" class="btn btn-warning" onclick="window.abrirModalCuadratura('\${docSnap.id}', '\${trackingDisplay}')">
                                    <i class="ph ph-scales"></i> Terminar Turno y Cuadrar
                                </button>
                                <button type="button" class="btn btn-danger" onclick="window.finalizarTurnoBandeja('\${docSnap.id}')">
                                    <i class="ph ph-arrow-u-down-left"></i> Devolver a Bodega
                                </button>
                            </div>
                        \`;
                    }

                    html += \`</div>\`; // Cierra Body

                    div.innerHTML = html;
                    container.appendChild(div);`;

let accordionFound = false;
code = code.replace(bandejasRenderStartRegex, () => {
    accordionFound = true;
    return renderAccordionReplacement;
});

if (accordionFound) {
    console.log("Acorden renderizado correctamente.");
} else {
    console.log("! No se encontr el bloque de renderizacin de bandejas para reemplazar.");
}

fs.writeFileSync(FILE_PATH, code);
console.log("Hecho.");
