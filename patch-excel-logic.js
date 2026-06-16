const fs = require('fs');

let scriptJs = fs.readFileSync('script.js', 'utf8');

const target = `                    const json = XLSX.utils.sheet_to_json(sheet);
                    
                    console.log("Excel leido:", json);
                    
                    // Por ahora solo mostrar un mensaje genérico porque necesitamos saber el formato del usuario
                    const res = document.getElementById('resultado-cuadratura');
                    res.style.display = 'block';
                    res.innerHTML = \\\`<p style="color:var(--success);">✅ Excel cargado correctamente (\\\${json.length} filas procesadas). Pendiente cruce inteligente de columnas.</p>\\\`;
                    
                    // Habilitar cierre
                    document.getElementById('btn-finalizar-turno').style.display = 'inline-block';
                    window._excelData = json;`;

const replacement = `                    // Usamos {header: 1} para obtener la tabla como matriz 2D y sortear celdas combinadas y saltos de pagina
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
                            if (val === 'total solicitado') colSolicitado = j;
                        }
                        
                        if (colFarmacos !== -1 && colSolicitado !== -1) break;
                    }
                    
                    if (colFarmacos === -1 || colSolicitado === -1) {
                        throw new Error("No se encontraron las columnas 'Fármacos' (o 'Insumos') y 'Total solicitado' en el Excel.");
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
                            const normName = nombre.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
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
                        const normName = nombre.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
                        
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
                    let tableHtml = \`
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
                    \`;
                    
                    let tieneDiferencias = false;
                    
                    matchResults.forEach((res, idx) => {
                        if (res.requiereObs) tieneDiferencias = true;
                        
                        tableHtml += \`
                            <tr style="background: \${res.color}15;">
                                <td style="font-size: 0.9em;">
                                    <strong>V:</strong> \${res.visorName}<br>
                                    <strong>R:</strong> \${res.rayenName}
                                </td>
                                <td style="font-size: 1.1em; font-weight: bold; text-align: center;">\${res.consumidoVisor}</td>
                                <td style="font-size: 1.1em; font-weight: bold; text-align: center;">\${res.solicitadoRayen}</td>
                                <td><span class="badge" style="background: \${res.color}; color: #fff;">\${res.estado}</span></td>
                                <td>
                                    \${res.requiereObs ? 
                                        \`<input type="text" class="form-control obs-cruce" data-idx="\${idx}" placeholder="Indique motivo de diferencia" style="min-width: 150px;">\` : 
                                        '<span style="color: #6c757d; font-size: 0.85em;">No requiere</span>'
                                    }
                                </td>
                            </tr>
                        \`;
                    });
                    
                    tableHtml += \`</tbody></table></div>\`;
                    
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
                    };`;

if (scriptJs.includes(target)) {
    scriptJs = scriptJs.replace(target, replacement);
    fs.writeFileSync('script.js', scriptJs);
    console.log("Patched excel logic.");
} else {
    console.log("Target not found");
}
