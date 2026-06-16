const fs = require('fs');
let code = fs.readFileSync('c:/Users/usuario/Documents/VISOR/script.js', 'utf8');

const regex = /transaction\.update\(docRef,\s*\{\s*estado:\s*'EN_USO',\s*medicamentos:\s*medicamentosActualizados,\s*fechaRecepcion:\s*serverTimestamp\(\)\s*\}\);/m;

const replacement = `
                // Generar Mermas de Despacho
                medicamentosActualizados.forEach(med => {
                    if (med.cantidadRecibida < med.cantidadAsignada) {
                        const diferencia = med.cantidadAsignada - med.cantidadRecibida;
                        const histRef = window.firebaseFirestore.doc(window.firebaseFirestore.collection(db, 'Historial_Movimientos'));
                        transaction.set(histRef, {
                            tipoAccion: 'MERMA_DESPACHO',
                            fechaHora: window.firebaseFirestore.serverTimestamp(),
                            usuario: auth.currentUser.email,
                            nombreInsumo: med.nombreInsumo,
                            cantidadAnterior: med.cantidadAsignada,
                            cantidadNueva: med.cantidadRecibida,
                            cantidadDiferencia: diferencia,
                            observaciones: 'Faltante reportado por enfermería: ' + med.observacion,
                            idBandeja: docId
                        });
                    }
                });

                transaction.update(docRef, {
                    estado: 'EN_USO',
                    medicamentos: medicamentosActualizados,
                    fechaRecepcion: window.firebaseFirestore.serverTimestamp()
                });`;

if (regex.test(code)) {
    code = code.replace(regex, replacement);
    fs.writeFileSync('c:/Users/usuario/Documents/VISOR/script.js', code);
    console.log("Successfully replaced MERMA_DESPACHO logic.");
} else {
    console.error("Could not find the block to replace.");
}
