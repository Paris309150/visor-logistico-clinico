const fs = require('fs');

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
                            await window.firebaseFirestore.updateDoc(insumoRef, {
                                cantidad: window.firebaseFirestore.increment(med.cantidadRetornadaOperador)
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

fs.appendFileSync('c:/Users/usuario/Documents/VISOR/script.js', '\n' + operatorLogic);
console.log('Appended clean function.');
