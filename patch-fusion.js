const fs = require('fs');
let code = fs.readFileSync('c:/Users/usuario/Documents/VISOR/script.js', 'utf8');

// 1. Modificar el botón de la interfaz del enfermero
const uiBtnRegex = /<button class="btn btn-outline-danger" onclick="window\.terminarTurno\('\$\{docSnap\.id\}'\)" style="font-weight: 500;">/g;
if (uiBtnRegex.test(code)) {
    code = code.replace(uiBtnRegex, `<button class="btn btn-outline-danger" onclick="window.abrirCierreTurno('\${docSnap.id}')" style="font-weight: 500;">`);
    console.log("Replaced UI button onclick action.");
} else {
    console.error("UI button not found.");
}

// 2. Modificar btn-finalizar-turno logic
// Find the block starting at `const docRef = doc(db, 'Bandejas_Turno', docId);`
// inside `btn-finalizar-turno` event listener.

const finalizarLogicRegex = /const docRef = doc\(db, 'Bandejas_Turno', docId\);\s*await updateDoc\(docRef, \{\s*estado: 'CERRADA_ENFERMERIA',\s*fechaCierre: serverTimestamp\(\),\s*cruceCierreTurno: finalCruce,\s*excelRawLength: window\._excelData \? window\._excelData\.length : 0\s*\}\);/m;

const replacementLogic = `const docRef = doc(db, 'Bandejas_Turno', docId);

                await window.firebaseFirestore.runTransaction(db, async (transaction) => {
                    const snap = await transaction.get(docRef);
                    if (!snap.exists()) throw new Error("La bandeja no existe.");

                    const data = snap.data();
                    const medicamentosActualizados = data.medicamentos.map(med => {
                        const recibida = med.cantidadRecibida || 0;
                        const consumida = med.cantidadConsumida || 0;
                        const merma = med.cantidadMerma || 0;
                        const sobrante = recibida - consumida - merma;

                        if (sobrante > 0) {
                            // Generar Movimiento de Retorno en el Historial
                            const histRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(db, 'Historial_Movimientos'));
                            transaction.set(histRef, {
                                tipoAccion: 'RETORNO_BANDEJA',
                                fechaHora: window.firebaseFirestore.serverTimestamp(),
                                usuario: auth.currentUser.email,
                                nombreInsumo: med.nombreInsumo,
                                cantidadAnterior: 0,
                                cantidadNueva: sobrante,
                                cantidadDiferencia: sobrante,
                                observaciones: 'Retorno tras Cuadratura Excel de Bandeja ' + (data.identificador || docId),
                                idBandeja: docId
                            });

                            // El update Global Stock lo haremos despues de la transaccion para no cruzar referencias tan complejo 
                            // O si lo hacemos, es igual que en terminarTurno
                        }
                        return { ...med, cantidadRetornada: sobrante };
                    });

                    transaction.update(docRef, {
                        estado: 'CERRADA_FINAL', // Cambio de estado a CERRADA_FINAL o RETORNADA
                        fechaCierre: window.firebaseFirestore.serverTimestamp(),
                        cruceCierreTurno: finalCruce,
                        excelRawLength: window._excelData ? window._excelData.length : 0,
                        medicamentos: medicamentosActualizados
                    });
                });

                // Post-Transaction: Update Global Stock
                const docSnapResult = await window.firebaseFirestore.getDoc(docRef);
                const dataResult = docSnapResult.data();
                for (let med of dataResult.medicamentos) {
                    if (med.cantidadRetornada > 0) {
                        const insumosSnapshot = await window.firebaseFirestore.getDocs(window.firebaseFirestore.query(window.firebaseFirestore.collection(db, 'Insumos'), window.firebaseFirestore.where('nombre', '==', med.nombreInsumo)));
                        if (!insumosSnapshot.empty) {
                            const insumoDoc = insumosSnapshot.docs[0];
                            const insumoRef = window.firebaseFirestore.doc(db, 'Insumos', insumoDoc.id);
                            const insumoData = insumoDoc.data();
                            await window.firebaseFirestore.updateDoc(insumoRef, {
                                cantidad: (insumoData.cantidad || 0) + med.cantidadRetornada
                            });
                        }
                    }
                }`;

if (finalizarLogicRegex.test(code)) {
    code = code.replace(finalizarLogicRegex, replacementLogic);
    console.log("Replaced finalizar-turno logic.");
} else {
    console.error("finalizar logic not found.");
}

fs.writeFileSync('c:/Users/usuario/Documents/VISOR/script.js', code);
console.log("File saved.");
