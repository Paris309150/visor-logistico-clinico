const fs = require('fs');

// 1. UPDATE HTML
let htmlCode = fs.readFileSync('c:/Users/usuario/Documents/VISOR/index.html', 'utf8');
if (!htmlCode.includes('modal-recepcion-operador')) {
    const modalHtml = `
    <!-- Modal Recepcion Operador -->
    <div id="modal-recepcion-operador" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 9999; justify-content: center; align-items: center; backdrop-filter: blur(5px);">
        <div style="background: white; padding: 30px; border-radius: 15px; width: 90%; max-width: 800px; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f1f5f9; padding-bottom: 15px; margin-bottom: 20px;">
                <h3 style="margin: 0; color: #005A9C;"><i class="ph ph-check-square-offset"></i> Recepción de Bandeja en Bodega</h3>
                <button onclick="document.getElementById('modal-recepcion-operador').style.display='none'" style="background: none; border: none; font-size: 1.5em; cursor: pointer; color: #64748b;">&times;</button>
            </div>
            
            <p class="text-muted" style="margin-bottom: 20px;">Verifique que las cantidades físicas devueltas por la enfermera coincidan con lo reportado por la cuadratura. Si hay diferencias, ajuste la "Cantidad Real" antes de confirmar.</p>
            
            <div id="lista-medicamentos-recepcion-operador" style="margin-bottom: 20px;">
                <!-- Dinámico -->
            </div>
            
            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; border-top: 2px solid #f1f5f9; padding-top: 20px;">
                <button class="btn btn-outline-secondary" onclick="document.getElementById('modal-recepcion-operador').style.display='none'">Cancelar</button>
                <button class="btn btn-success" id="btn-guardar-recepcion-operador"><i class="ph ph-check-circle"></i> Confirmar y Reintegrar Stock</button>
            </div>
        </div>
    </div>
    `;
    
    htmlCode = htmlCode.replace('<!-- Overlay Notificaciones -->', modalHtml + '\n    <!-- Overlay Notificaciones -->');
    fs.writeFileSync('c:/Users/usuario/Documents/VISOR/index.html', htmlCode);
    console.log("HTML patched.");
}

// 2. UPDATE SCRIPT
let jsCode = fs.readFileSync('c:/Users/usuario/Documents/VISOR/script.js', 'utf8');

// A. Revertir `btn-finalizar-turno`
const revertFinalizarRegex = /await window\.firebaseFirestore\.runTransaction[\s\S]*?medicamentos:\s*medicamentosActualizados\s*\}\);\s*\}\);\s*\/\/ Post-Transaction: Update Global Stock[\s\S]*?\}\s*\}/m;

if (revertFinalizarRegex.test(jsCode)) {
    const revertedLogic = `await window.firebaseFirestore.updateDoc(docRef, {
                    estado: 'CERRADA_ENFERMERIA',
                    fechaCierre: window.firebaseFirestore.serverTimestamp(),
                    cruceCierreTurno: finalCruce,
                    excelRawLength: window._excelData ? window._excelData.length : 0
                });`;
    jsCode = jsCode.replace(revertFinalizarRegex, revertedLogic);
    console.log("Reverted finalizar-turno logic.");
}

// B. Agregar Botón en Historial
const badgeRegex = /if\(data\.estado === 'CERRADA_ENFERMERIA'\) badgeColor = '#ffc107';/g;
if (badgeRegex.test(jsCode)) {
    // Modify btnCruce logic
    const cruceHtmlRegex = /if\(data\.cruceCierreTurno\) \{\s*btnCruce = `<button class="btn btn-sm btn-outline-primary" onclick="window\.verCruceHistorico\('\$\{docSnap\.id\}'\)" title="Ver Cruce RAYEN"><i class="ph ph-magnifying-glass"><\/i><\/button>`;\s*\}/m;
    
    const newCruceLogic = `if(data.cruceCierreTurno) {
                    btnCruce = \`<button class="btn btn-sm btn-outline-primary" onclick="window.verCruceHistorico('\${docSnap.id}')" title="Ver Cruce RAYEN" style="margin-right: 5px;"><i class="ph ph-magnifying-glass"></i></button>\`;
                }
                
                // Botón de Operador para Recepcionar
                if (data.estado === 'CERRADA_ENFERMERIA' && (currentRole === 'operador' || currentRole === 'admin' || currentRole === 'superadmin')) {
                    btnCruce += \`<button class="btn btn-sm btn-success" onclick="window.abrirRecepcionOperador('\${docSnap.id}')" title="Recepcionar Bandeja" style="margin-right: 5px;"><i class="ph ph-check-square-offset"></i> Recepcionar</button>\`;
                }`;
    jsCode = jsCode.replace(cruceHtmlRegex, newCruceLogic);
    console.log("Added button to Historial.");
}

// C. Inyectar Lógica de Operador
const operatorLogic = `
    window.abrirRecepcionOperador = async function(docId) {
        window._bandejaOperadorId = docId;
        const container = document.getElementById('lista-medicamentos-recepcion-operador');
        container.innerHTML = '<div class="text-center"><i class="ph-spinner ph-spin"></i> Cargando...</div>';
        document.getElementById('modal-recepcion-operador').style.display = 'flex';
        
        try {
            const docRef = window.firebaseFirestore.doc(db, 'Bandejas_Turno', docId);
            const snap = await window.firebaseFirestore.getDoc(docRef);
            if (!snap.exists()) throw new Error("Bandeja no encontrada.");
            
            const data = snap.data();
            let html = \`
                <table class="table table-bordered">
                    <thead style="background:#f8f9fa;">
                        <tr>
                            <th>Fármaco</th>
                            <th>Reportado por Enfermera (Sobrante)</th>
                            <th>Cantidad Real Física Recibida</th>
                            <th>Observación Operador (Si difiere)</th>
                        </tr>
                    </thead>
                    <tbody>
            \`;
            
            data.medicamentos.forEach((med, idx) => {
                const recibida = med.cantidadRecibida || 0;
                const consumida = med.cantidadConsumida || 0;
                const merma = med.cantidadMerma || 0;
                const reportado = recibida - consumida - merma;
                
                html += \`
                    <tr>
                        <td><strong>\${med.nombreInsumo || med.nombre}</strong></td>
                        <td style="text-align: center; vertical-align: middle; font-size: 1.1em;">\${reportado}</td>
                        <td style="width: 150px;">
                            <input type="number" id="op-recibido-\${idx}" class="form-control text-center" value="\${reportado}" min="0">
                        </td>
                        <td>
                            <input type="text" id="op-obs-\${idx}" class="form-control" placeholder="Motivo de ajuste...">
                        </td>
                    </tr>
                \`;
            });
            
            html += \`</tbody></table>\`;
            container.innerHTML = html;
        } catch(e) {
            console.error(e);
            container.innerHTML = '<div class="text-danger">Error al cargar datos.</div>';
        }
    };

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#btn-guardar-recepcion-operador')) {
            const docId = window._bandejaOperadorId;
            if(!docId) return;
            
            const btn = e.target.closest('#btn-guardar-recepcion-operador');
            btn.disabled = true;
            btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Procesando...';
            
            try {
                const docRef = window.firebaseFirestore.doc(db, 'Bandejas_Turno', docId);
                
                // Ejecutamos transaccion
                await window.firebaseFirestore.runTransaction(db, async (transaction) => {
                    const snap = await transaction.get(docRef);
                    if (!snap.exists()) throw new Error("La bandeja no existe.");
                    
                    const data = snap.data();
                    if (data.estado !== 'CERRADA_ENFERMERIA') throw new Error("La bandeja no está en estado CERRADA_ENFERMERIA.");
                    
                    let hayAjusteNoJustificado = false;
                    const inputsReal = document.querySelectorAll('[id^="op-recibido-"]');
                    const inputsObs = document.querySelectorAll('[id^="op-obs-"]');
                    
                    const medicamentosActualizados = data.medicamentos.map((med, idx) => {
                        const recibida = med.cantidadRecibida || 0;
                        const consumida = med.cantidadConsumida || 0;
                        const merma = med.cantidadMerma || 0;
                        const reportado = recibida - consumida - merma;
                        
                        const inputVal = inputsReal[idx] ? Number(inputsReal[idx].value) : reportado;
                        const obsVal = inputsObs[idx] ? inputsObs[idx].value.trim() : '';
                        
                        if (inputVal !== reportado && obsVal === '') {
                            hayAjusteNoJustificado = true;
                        }
                        
                        if (inputVal > 0) {
                            // Generar Movimiento de Retorno
                            const histRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(db, 'Historial_Movimientos'));
                            transaction.set(histRef, {
                                tipoAccion: 'RETORNO_BANDEJA',
                                fechaHora: window.firebaseFirestore.serverTimestamp(),
                                usuario: auth.currentUser.email,
                                nombreInsumo: med.nombreInsumo || med.nombre,
                                cantidadAnterior: 0,
                                cantidadNueva: inputVal,
                                cantidadDiferencia: inputVal,
                                observaciones: 'Retorno desde Bandeja ' + (data.identificador || docId) + (inputVal !== reportado ? '. AJUSTE OPERADOR: ' + obsVal : ''),
                                idBandeja: docId
                            });
                        }
                        
                        return { 
                            ...med, 
                            cantidadRetornadaOperador: inputVal,
                            observacionOperador: obsVal
                        };
                    });
                    
                    if (hayAjusteNoJustificado) {
                        throw new Error("AJUSTE_SIN_OBS");
                    }
                    
                    transaction.update(docRef, {
                        estado: 'CERRADA_FINAL',
                        fechaRecepcionBodega: window.firebaseFirestore.serverTimestamp(),
                        operadorReceptor: auth.currentUser.email,
                        medicamentos: medicamentosActualizados
                    });
                });
                
                // Actualizar Stock General post-transaccion
                const docSnapResult = await window.firebaseFirestore.getDoc(docRef);
                const dataResult = docSnapResult.data();
                for (let med of dataResult.medicamentos) {
                    if (med.cantidadRetornadaOperador > 0) {
                        const insumosSnapshot = await window.firebaseFirestore.getDocs(window.firebaseFirestore.query(window.firebaseFirestore.collection(db, 'Insumos'), window.firebaseFirestore.where('nombre', '==', med.nombreInsumo || med.nombre)));
                        if (!insumosSnapshot.empty) {
                            const insumoDoc = insumosSnapshot.docs[0];
                            const insumoRef = window.firebaseFirestore.doc(db, 'Insumos', insumoDoc.id);
                            const insumoData = insumoDoc.data();
                            await window.firebaseFirestore.updateDoc(insumoRef, {
                                cantidad: (insumoData.cantidad || 0) + med.cantidadRetornadaOperador
                            });
                        }
                    }
                }
                
                document.getElementById('modal-recepcion-operador').style.display = 'none';
                window.showToast('Recepción Exitosa', 'El stock ha sido devuelto a bodega.', 'success');
                if (window.cargarHistorialBandejas) window.cargarHistorialBandejas();
            } catch (error) {
                console.error(error);
                if (error.message === "AJUSTE_SIN_OBS") {
                    window.showToast('Error', 'Debe justificar las diferencias que ajustó.', 'warning');
                } else {
                    window.showToast('Error', 'No se pudo recepcionar: ' + error.message, 'error');
                }
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="ph ph-check-circle"></i> Confirmar y Reintegrar Stock';
            }
        }
    });
`;

if (!jsCode.includes('window.abrirRecepcionOperador')) {
    jsCode += '\n' + operatorLogic;
    fs.writeFileSync('c:/Users/usuario/Documents/VISOR/script.js', jsCode);
    console.log("Operator logic injected.");
}

