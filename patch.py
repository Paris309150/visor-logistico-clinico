import re

with open('script.js', 'r', encoding='utf-8') as f:
    content = f.read()

correct_block = """                if (real !== esperado && !obs) {
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
                window.showAlertCenter("Notificación", "Debe ingresar una observación para todas las cantidades físicas que difieran del stock teórico esperado.");
                return;
            }
            
            if(!confirm("¿Confirmar la recepción final de esta bandeja? El stock físico ingresado será sumado al Inventario Central.")) return;
            
            try {
                const btn = e.target.closest('#btn-confirmar-recepcion-bodega');
                btn.disabled = true;
                btn.innerHTML = '<i class="ph-spinner ph-spin"></i> Procesando...';
                
                const docRef = doc(db, 'Bandejas_Turno', docId);
                const invRef = collection(db, 'Insumos');
                
                // 1. PRE-FETCH: Buscar referencias de los items a retornar ANTES de la transacción
                let docIdsMap = {};
                for (const item of stockARetornar) {
                    const key = item.nombre.toLowerCase().trim();
                    const q1 = query(invRef, where('name', '==', item.nombre), limit(1));
                    const snap1 = await getDocs(q1);
                    if (!snap1.empty) {
                        docIdsMap[key] = snap1.docs[0].id;
                    }
                }
                
                await runTransaction(db, async (transaction) => {
                    const snap = await transaction.get(docRef);
                    if (!snap.exists()) throw new Error("La bandeja no existe.");
                    
                    // 2. Sumar stock a retornar al Insumos
                    for (const item of stockARetornar) {
                        const key = item.nombre.toLowerCase().trim();
                        if (docIdsMap[key]) {
                            const itemRef = doc(db, 'Insumos', docIdsMap[key]);
                            transaction.update(itemRef, {
                                quantity: window.firebaseFirestore.increment(item.cantidad)
                            });
                        } else {
                            // Si no existiera en inventario central, se crea el item
                            const newItemRef = doc(collection(db, 'Insumos'));
                            transaction.set(newItemRef, {
                                name: item.nombre,
                                quantity: item.cantidad,
                                lpn: 'N/A',
                                lote: 'RETORNO',
                                expirationDate: 'N/A',
                                date: serverTimestamp(),
                                operator: auth.currentUser.email
                            });
                            docIdsMap[key] = newItemRef.id;
                        }
                        
                        // Registrar ENTRADA en Historial
                        const histRef = doc(collection(db, 'Historial_Movimientos'));
                        transaction.set(histRef, {
                            tipoAccion: 'ENTRADA',
                            detalle: 'Devolución de Bandeja de Turno (Recepción Física Bodega)',
                            cantidad: item.cantidad,
                            quantity: item.cantidad,
                            nombreInsumo: item.nombre,
                            documentoRespaldo: 'Bandeja ID: ' + docId.substring(0,8),
                            usuario: auth.currentUser.email,
                            fechaHora: serverTimestamp(),
                            origen: 'Bandeja de Turno',
                            destino: 'Insumos'
                        });
                    }"""

regex = r"const obs = obsInput \? obsInput\.value\.trim\(\) : \'\';\s*cantidad: item\.cantidad,\s*nombreInsumo: item\.nombre,.*?documentoRespaldo: 'Bandeja ID: ' \+ docId\.substring\(0,8\),.*?(?=// 3\. Cambiar estado de la bandeja a CERRADA_FINAL)"
new_content = re.sub(regex, "const obs = obsInput ? obsInput.value.trim() : '';\n                \n" + correct_block + "\n                    \n                    ", content, flags=re.MULTILINE | re.DOTALL)

with open('script.js', 'w', encoding='utf-8') as f:
    f.write(new_content)
print("Patcher executed successfully!")
