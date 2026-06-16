const fs = require('fs');

let lines = fs.readFileSync('script.js', 'utf8').split('\n');

// Goal: Rewrite the query inside startMisBandejasListener

let startIndex = -1;
let endIndex = -1;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('if (currentRole === \'enfermero\') {') && lines[i-1].includes('let q;')) {
        startIndex = i;
    }
    if (startIndex !== -1 && i > startIndex && lines[i].includes('});') && lines[i+1].includes('};') && lines[i-2].includes('container.appendChild(div);')) {
        endIndex = i;
        break;
    }
}

if (startIndex !== -1 && endIndex !== -1) {
    const fixedBlock = `        if (currentRole === 'enfermero') {
            // Local filter used inside onSnapshot to avoid Firebase composite index requirement
            q = query(
                collection(db, 'Bandejas_Turno'),
                where('enfermeroAsignado', '==', auth.currentUser.email)
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

            let hasVisibleTrays = false;

            snapshot.forEach(docSnap => {
                const data = docSnap.data();

                // Local filtering for enfermero role
                if (currentRole === 'enfermero' && !['CREADA', 'EN_USO'].includes(data.estado)) {
                    return;
                }

                hasVisibleTrays = true;
                const div = document.createElement('div');
                div.className = 'data-table-card';
                div.style.padding = '16px';
                div.style.marginBottom = '16px';

                let html = \`
                    <div style="display:flex; justify-content:space-between; margin-bottom:12px; border-bottom:1px solid #eee; padding-bottom:12px;">
                        <div>
                            <strong>Bandeja:</strong> \${data.identificador || docSnap.id.substring(0, 8)}<br>
                            <span class="text-muted text-sm">Creada por: \${data.creadoPor}</span>
                        </div>
                        <div>
                            <span class="badge" style="background:\${data.estado === 'CREADA' ? 'var(--warning)' : 'var(--success)'}; color:#000;">
                                ESTADO: \${data.estado}
                            </span>
                        </div>
                    </div>
                    \${data.fechaCreacion ? \`<div style="font-size:0.85em; color:#666; margin-bottom: 10px; display:flex; justify-content:space-between;">
                        <span><i class="ph ph-clock"></i> Creada: \${data.fechaCreacion.toDate().toLocaleString()}</span>
                        \${data.estado === 'CREADA' && document.body.getAttribute('data-user-role') !== 'enfermero' ? \`<a href="#" onclick="window.abrirGestionBandeja('\${docSnap.id}', '\${data.enfermeroAsignado}')" style="color:var(--primary); font-weight:bold;">⚙️ Gestionar (Reasignar/Anular)</a>\` : ''}
                    </div>\` : ''}

                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>FÁRMACO</th>
                                    <th>ASIGNADO</th>
                                    \${data.estado === 'CREADA' ? '<th>RECIBIDO (FÍSICO)</th><th>OBSERVACIÓN (Obligatoria si difiere)</th>' : ''}
                                </tr>
                            </thead>
                            <tbody>
                \`;

                data.medicamentos.forEach((med, idx) => {

                    if (data.estado === 'EN_USO' && document.body.getAttribute('data-user-role') === 'enfermero') {
                        html += \`
                        <div style="margin-top: 16px; display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #dee2e6;">
                            <button class="btn btn-outline-primary" onclick="window.abrirModalConsumo('\${docSnap.id}')" style="font-weight: 500;">
                                <i class="ph ph-pill"></i> Registrar Consumo / Merma
                            </button>
                            <button class="btn btn-outline-danger" onclick="window.terminarTurno('\${docSnap.id}')" style="font-weight: 500;">
                                <i class="ph ph-flag-checkered"></i> Terminar Turno y Devolver Bandeja
                            </button>
                        </div>
                        \`;
                    }

                    html += \`
                                <tr>
                                    <td>
                                        \${med.nombreInsumo}
                                        \${data.estado === 'EN_USO' ? \`<div style="font-size:0.8em; color:var(--primary);">Consumidos: \${med.cantidadConsumida || 0} | Mermas: \${med.cantidadMerma || 0}</div>\` : ''}
                                    </td>
                                    <td><strong>\${med.cantidadAsignada}</strong></td>
                                    \${data.estado === 'CREADA' ? \`
                                    <td style="width:120px;">
                                        <input type="number" class="form-control recepcion-cantidad" data-idx="\${idx}" value="\${med.cantidadAsignada}" min="0" onchange="window.validarFilaRecepcion(this)">
                                    </td>
                                    <td>
                                        <input type="text" class="form-control recepcion-obs" data-idx="\${idx}" placeholder="Solo si hay diferencia..." disabled>
                                    </td>\` : ''}
                                </tr>
                    \`;
                });

                html += \`
                            </tbody>
                        </table>
                    </div>
                \`;

                if (data.estado === 'CREADA' && document.body.getAttribute('data-user-role') === 'enfermero') {
                    html += \`
                        <div style="margin-top: 16px; display: flex; gap: 10px; justify-content: flex-end; align-items:center;">
                            <span id="warning-msg-\${docSnap.id}" style="color:var(--danger); font-size:0.9em; display:none; font-weight:bold;">Hay faltantes. Debes justificar en Observaciones.</span>
                            <button class="btn btn-primary" onclick="window.confirmarRecepcionBandeja('\${docSnap.id}')">
                                <i class="ph ph-check-circle"></i> Confirmar Recepción Física
                            </button>
                        </div>
                    \`;
                }

                div.innerHTML = html;
                container.appendChild(div);
            });

            if (!hasVisibleTrays) {
                container.innerHTML = '<div class="text-center text-muted" style="padding: 20px;">No tienes bandejas asignadas pendientes.</div>';
            }

        }, (error) => {
            console.error("Error en onSnapshot de Mis Bandejas:", error);
            const container = document.getElementById('lista-mis-bandejas');
            if (container) container.innerHTML = \`<div class="text-center text-danger" style="padding: 20px;">Error interno al consultar las bandejas: \${error.message}</div>\`;
        });`;

    lines.splice(startIndex, endIndex - startIndex + 1, fixedBlock);
    fs.writeFileSync('script.js', lines.join('\n'), 'utf8');
    console.log("Fixed composite index query.");
} else {
    console.log("Indices not found", startIndex, endIndex);
}
