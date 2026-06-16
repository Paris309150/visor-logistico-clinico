const fs = require('fs');
let code = fs.readFileSync('c:/Users/usuario/Documents/VISOR/script.js', 'utf8');

const injection = `
window.terminarTurno = async function (docId) {
    if (!confirm('¿Estás seguro de terminar el turno y devolver la bandeja? Asegúrate de haber registrado todos los consumos.')) return;

    try {
        const docRef = window.firebaseFirestore.doc(db, 'Bandejas_Turno', docId);

        await window.firebaseFirestore.runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists()) {
                throw new Error("La bandeja no existe.");
            }

            const data = docSnap.data();
            if (data.estado !== 'EN_USO') {
                throw new Error("La bandeja no está en uso.");
            }

            const medicamentosActualizados = data.medicamentos.map(med => {
                const recibida = med.cantidadRecibida || 0;
                const consumida = med.cantidadConsumida || 0;
                const merma = med.cantidadMerma || 0;
                const sobrante = recibida - consumida - merma;

                if (sobrante < 0) {
                    throw new Error("El sobrante no puede ser menor a cero para el insumo " + med.nombreInsumo);
                }

                if (sobrante > 0) {
                    // Generar Movimiento de Retorno en el Historial
                    const histRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(db, 'Historial_Movimientos'));
                    transaction.set(histRef, {
                        tipoAccion: 'RETORNO_BANDEJA',
                        fechaHora: window.firebaseFirestore.serverTimestamp(),
                        usuario: auth.currentUser.email,
                        nombreInsumo: med.nombreInsumo,
                        cantidadAnterior: 0, // Not explicitly needed, we focus on adjustment
                        cantidadNueva: sobrante,
                        cantidadDiferencia: sobrante,
                        observaciones: 'Retorno automático desde Bandeja ' + (data.identificador || docId),
                        idBandeja: docId
                    });

                    // Update Global Stock for the Insumo
                    const insumosSnapshot = await window.firebaseFirestore.getDocs(window.firebaseFirestore.query(window.firebaseFirestore.collection(db, 'Insumos'), window.firebaseFirestore.where('nombre', '==', med.nombreInsumo)));
                    if (!insumosSnapshot.empty) {
                        const insumoDoc = insumosSnapshot.docs[0];
                        const insumoRef = window.firebaseFirestore.doc(db, 'Insumos', insumoDoc.id);
                        const insumoData = insumoDoc.data();
                        transaction.update(insumoRef, {
                            cantidad: (insumoData.cantidad || 0) + sobrante
                        });
                    }
                }

                return {
                    ...med,
                    cantidadRetornada: sobrante
                };
            });

            transaction.update(docRef, {
                estado: 'RETORNADA',
                medicamentos: medicamentosActualizados,
                fechaRetorno: window.firebaseFirestore.serverTimestamp()
            });
        });

        window.showToast('Éxito', 'Turno finalizado y bandeja retornada al stock central.', 'success');
    } catch (err) {
        console.error("Error al terminar turno:", err);
        window.showToast('Error', 'No se pudo devolver la bandeja: ' + err.message, 'error');
    }
};
`;

if (!code.includes('window.terminarTurno = async function')) {
    code += '\n' + injection;
    fs.writeFileSync('c:/Users/usuario/Documents/VISOR/script.js', code);
    console.log("Successfully appended terminarTurno.");
} else {
    console.log("terminarTurno already exists.");
}
