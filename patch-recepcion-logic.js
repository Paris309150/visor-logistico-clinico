const fs = require('fs');
let code = fs.readFileSync('script.js', 'utf8');

// 1. Update the query for Mis Bandejas Activas
const qRegex = /const q = query\([\s\S]*?where\('estado', 'in', \['CREADA', 'EN_USO'\]\)\s*\);/;
const qReplace = `const currentRole = document.body.getAttribute('data-user-role');
        let q;
        if (currentRole === 'enfermero') {
            q = query(
                collection(db, 'Bandejas_Turno'),
                where('enfermeroAsignado', '==', auth.currentUser.email),
                where('estado', 'in', ['CREADA', 'EN_USO'])
            );
        } else {
            q = query(
                collection(db, 'Bandejas_Turno'),
                where('estado', 'in', ['CREADA', 'EN_USO', 'CERRADA_ENFERMERIA'])
            );
        }`;

code = code.replace(qRegex, qReplace);

// 2. Add the button for CERRADA_ENFERMERIA in the loop
// Find where we close the table `html += \`</tbody></table></div>\`;` and inject after it
const tableCloseRegex = /(html \+= `<\/tbody><\/table><\/div>`;)/;
const buttonInject = `$1
                if (data.estado === 'CERRADA_ENFERMERIA' && document.body.getAttribute('data-user-role') !== 'enfermero') {
                    html += \`
                        <div style="margin-top: 16px; text-align: right;">
                            <button class="btn btn-warning" onclick="window.abrirRecepcionBodega('\${docSnap.id}')" style="font-weight: bold; color: #000; background: #ffc107;">
                                <i class="ph ph-warehouse"></i> Auditar y Recepcionar Retorno
                            </button>
                        </div>
                    \`;
                }
`;

code = code.replace(tableCloseRegex, buttonInject);

// 3. Inject the logic for `abrirRecepcionBodega`
const injectRecepcionLogic = `
    // ==========================================
    // RECEPCION EN BODEGA (OPERADOR)
    // ==========================================
    window.abrirRecepcionBodega = async function(docId) {
        window._recepcionBodegaId = docId;
        const cruceDiv = document.getElementById('recepcion-bodega-cruce');
        const fisicaDiv = document.getElementById('recepcion-bodega-fisica');
        if (!cruceDiv || !fisicaDiv) return;
        
        try {
            const docRef = doc(db, 'Bandejas_Turno', docId);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) throw new Error("Bandeja no encontrada");
            
            const data = docSnap.data();
            const cruceData = data.cruceCierreTurno || [];
            
            // 1. Renderizar tabla de cruce
            let cruceHtml = \`
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead style="background: #f8f9fa;">
                            <tr>
                                <th>Insumo</th>
                                <th>Consumo (Visor)</th>
                                <th>Solicitado (Rayen)</th>
                                <th>Estado</th>
                                <th>Justificación de Enfermería</th>
                            </tr>
                        </thead>
                        <tbody>
            \`;
            
            if (cruceData.length === 0) {
                cruceHtml += \`<tr><td colspan="5" class="text-center">No hay datos de cruce disponibles.</td></tr>\`;
            } else {
                cruceData.forEach(res => {
                    cruceHtml += \`
                        <tr style="background: \${res.color}15;">
                            <td style="font-size: 0.85em;">
                                <strong>V:</strong> \${res.visorName}<br>
                                <strong>R:</strong> \${res.rayenName}
                            </td>
                            <td style="font-weight: bold; text-align: center;">\${res.consumidoVisor}</td>
                            <td style="font-weight: bold; text-align: center;">\${res.solicitadoRayen}</td>
                            <td><span class="badge" style="background: \${res.color}; color: #fff;">\${res.estado}</span></td>
                            <td style="font-size: 0.9em; font-style: italic; color: #555;">\${res.observacionCierre || 'N/A'}</td>
                        </tr>
                    \`;
                });
            }
            cruceHtml += \`</tbody></table></div>\`;
            cruceDiv.innerHTML = cruceHtml;
            
            // 2. Renderizar tabla física
            let fisicaHtml = \`
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead style="background: #f8f9fa;">
                            <tr>
                                <th>Fármaco Original de Bandeja</th>
                                <th>Stock Esperado (Teórico)</th>
                                <th>Recepción Física (Real)</th>
                                <th>Obs (Si difiere)</th>
                            </tr>
                        </thead>
                        <tbody>
            \`;
            
            data.medicamentos.forEach((med, idx) => {
                const nombre = med.nombreInsumo || med.nombre;
                const esperado = Number(med.cantidadRecibida || 0); // Esto es lo que quedó despues de mermas/consumos
                
                fisicaHtml += \`
                    <tr>
                        <td style="font-weight: bold;">\${nombre}</td>
                        <td style="text-align: center; font-size: 1.1em; color: var(--primary);">\${esperado}</td>
                        <td>
                            <input type="number" class="form-control input-recepcion-real" data-idx="\${idx}" data-esperado="\${esperado}" data-nombre="\${nombre}" value="\${esperado}" min="0" style="width: 80px;">
                        </td>
                        <td>
                            <input type="text" class="form-control input-recepcion-obs" data-idx="\${idx}" placeholder="Motivo de diferencia">
                        </td>
                    </tr>
                \`;
            });
            
            fisicaHtml += \`</tbody></table></div>\`;
            fisicaDiv.innerHTML = fisicaHtml;
            
            document.getElementById('modal-recepcion-bodega').style.display = 'flex';
            
        } catch (error) {
            console.error(error);
            window.showToast('Error', error.message, 'error');
        }
    };

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#btn-confirmar-recepcion-bodega')) {
            const docId = window._recepcionBodegaId;
            if(!docId) return;
            
            // Validar que las diferencias tengan observación
            const inputsReal = document.querySelectorAll('.input-recepcion-real');
            const inputsObs = document.querySelectorAll('.input-recepcion-obs');
            
            let isValid = true;
            let mermasExtras = [];
            let stockARetornar = [];
            
            inputsReal.forEach(inp => {
                const idx = inp.getAttribute('data-idx');
                const esperado = Number(inp.getAttribute('data-esperado'));
                const real = Number(inp.value);
                const nombre = inp.getAttribute('data-nombre');
                
                const obsInput = Array.from(inputsObs).find(o => o.getAttribute('data-idx') === idx);
                const obs = obsInput ? obsInput.value.trim() : '';
                
                if (real !== esperado && !obs) {
                    isValid = false;
                }
                
                if (real > 0) {
                    stockARetornar.push({ nombre, cantidad: real });
                }
                
                if (real < esperado) {
                    const diff = esperado - real;
                    mermasExtras.push({ nombre, cantidad: diff, observacion: obs });
                } else if (real > esperado) {
                     // Caso raro: devuelve mas de lo esperado.
                     const diff = real - esperado;
                     mermasExtras.push({ nombre, cantidad: -diff, observacion: obs + " (Sobrante no reportado)"});
                }
            });
            
            if (!isValid) {
                alert("Debe ingresar una observación para todas las cantidades físicas que difieran del stock teórico esperado.");
                return;
            }
            
            if(!confirm("¿Confirmar la recepción final de esta bandeja? El stock físico ingresado será sumado al Inventario Central.")) return;
            
            try {
                const btn = e.target.closest('#btn-confirmar-recepcion-bodega');
                btn.disabled = true;
                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Procesando...';
                
                const docRef = doc(db, 'Bandejas_Turno', docId);
                const invRef = collection(db, 'Inventario_Central');
                
                // 1. PRE-FETCH: Buscar referencias de los items a retornar ANTES de la transacción
                let docIdsMap = {};
                for (const item of stockARetornar) {
                    const key = item.nombre.toLowerCase().trim();
                    const q1 = query(invRef, where('nombreInsumo', '==', item.nombre), limit(1));
                    const snap1 = await getDocs(q1);
                    if (!snap1.empty) {
                        docIdsMap[key] = snap1.docs[0].id;
                    } else {
                        const q2 = query(invRef, where('nombre', '==', item.nombre), limit(1));
                        const snap2 = await getDocs(q2);
                        if (!snap2.empty) {
                            docIdsMap[key] = snap2.docs[0].id;
                        }
                    }
                }
                
                await runTransaction(db, async (transaction) => {
                    const snap = await transaction.get(docRef);
                    if (!snap.exists()) throw new Error("La bandeja no existe.");
                    
                    // 2. Sumar stock a retornar al Inventario_Central
                    for (const item of stockARetornar) {
                        const key = item.nombre.toLowerCase().trim();
                        if (docIdsMap[key]) {
                            const itemRef = doc(db, 'Inventario_Central', docIdsMap[key]);
                            transaction.update(itemRef, {
                                cantidadRecibida: increment(item.cantidad)
                            });
                        } else {
                            // Si no existiera en inventario central, se crea el item (poco comun pero posible)
                            const newItemRef = doc(collection(db, 'Inventario_Central'));
                            transaction.set(newItemRef, {
                                nombreInsumo: item.nombre,
                                nombre: item.nombre,
                                cantidadRecibida: item.cantidad,
                                lpn: 'N/A',
                                lote: 'RETORNO',
                                expirationDate: 'N/A',
                                fechaIngreso: serverTimestamp(),
                                operador: auth.currentUser.email
                            });
                            // Guardar su ID para posibles mermas o movimientos en historial
                            docIdsMap[key] = newItemRef.id;
                        }
                        
                        // Registrar ENTRADA en Historial
                        const histRef = doc(collection(db, 'Historial_Movimientos'));
                        transaction.set(histRef, {
                            tipoAccion: 'ENTRADA',
                            detalle: 'Devolución de Bandeja de Turno (Recepción Física Bodega)',
                            cantidad: item.cantidad,
                            nombreInsumo: item.nombre,
                            documentoRespaldo: 'Bandeja ID: ' + docId.substring(0,8),
                            usuario: auth.currentUser.email,
                            fecha: serverTimestamp(),
                            origen: 'Bandeja de Turno',
                            destino: 'Inventario_Central'
                        });
                    }
                    
                    // 3. Cambiar estado de la bandeja a CERRADA_FINAL
                    transaction.update(docRef, {
                        estado: 'CERRADA_FINAL',
                        fechaRecepcionBodega: serverTimestamp(),
                        operadorReceptor: auth.currentUser.email,
                        mermasRecepcionFisica: mermasExtras
                    });
                });
                
                document.getElementById('modal-recepcion-bodega').style.display = 'none';
                window.showToast('Recepción Exitosa', 'El stock ha retornado al Inventario Central.', 'success');
                btn.disabled = false;
                btn.innerHTML = '<i class="ph ph-check-circle"></i> Confirmar Retorno y Finalizar';
            } catch (error) {
                console.error(error);
                alert("Error al procesar: " + error.message);
                e.target.closest('#btn-confirmar-recepcion-bodega').disabled = false;
                e.target.closest('#btn-confirmar-recepcion-bodega').innerHTML = '<i class="ph ph-check-circle"></i> Confirmar Retorno y Finalizar';
            }
        }
    });
`;

// Insert the logic before the KARDEX block
const kardexBlock = '    // KARDEX CLÍNICO INTERACTIVO (TRAZABILIDAD)';
code = code.replace(kardexBlock, injectRecepcionLogic + '\n' + kardexBlock);

fs.writeFileSync('script.js', code, 'utf8');
console.log("Logica de Recepcion de Bodega inyectada correctamente.");
