const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const serviceAccountPath = "../serviceAccountKey.json";
const serviceAccount = require(serviceAccountPath);

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

async function runTest() {
    console.log("=== INICIANDO PRUEBA DE INTEGRACIÓN: FLUJO DE AJUSTES ===");
    
    // 1. Obtener un insumo válido para probar
    const insumosSnap = await db.collection("Insumos").limit(1).get();
    if (insumosSnap.empty) {
        console.error("Error: No hay insumos en la colección 'Insumos' para realizar la prueba.");
        process.exit(1);
    }

    const insumoDoc = insumosSnap.docs[0];
    const insumoId = insumoDoc.id;
    const insumoData = insumoDoc.data();
    const originalQuantity = insumoData.quantity || 0;
    const originalBatches = insumoData.batches || [];
    const originalBatch = insumoData.batch || null;
    const originalExpirationDate = insumoData.expirationDate || null;
    const insumoName = insumoData.name || "Insumo Test";

    console.log(`Insumo seleccionado para la prueba: ${insumoName} (ID: ${insumoId})`);
    console.log(`Stock actual: ${originalQuantity}`);

    // Asegurarse de tener suficiente stock para restar en la prueba
    const cantidadAjustar = -5;
    const previousStock = originalQuantity;
    const projectedStock = previousStock + cantidadAjustar;

    if (projectedStock < 0) {
        console.log("Stock insuficiente para restar 5. Ajustaremos la prueba a sumar +5.");
        cantidadAjustar = 5;
        projectedStock = previousStock + cantidadAjustar;
    }

    const testCode = "ADJ-TEST-" + Math.floor(10000 + Math.random() * 90000);
    console.log(`Código de solicitud generado para la prueba: ${testCode}`);

    // 2. Simular envío de solicitud por el Operador
    console.log("\n[Paso 1/4] Simulando creación de solicitud en estado 'pendiente'...");
    const solicitudRef = db.collection("Solicitudes_Ajuste").doc();
    await solicitudRef.set({
        code: testCode,
        insumoId: insumoId,
        insumoName: insumoName,
        cantidad: cantidadAjustar,
        justificacion: "Prueba automática de flujo de ajustes integrados",
        previousStock: previousStock,
        projectedStock: projectedStock,
        status: "pendiente",
        date: FieldValue.serverTimestamp(),
        requester: "operador.test@cormumel.cl"
    });
    console.log("✅ Solicitud pendiente creada.");

    // 3. Simular aprobación por parte del Superadministrador
    console.log("\n[Paso 2/4] Simulando aprobación por el Superadministrador vía Transacción...");
    let histRef = null;
    let auditRef = null;

    try {
        await db.runTransaction(async (transaction) => {
            const insRef = db.collection("Insumos").doc(insumoId);
            const insSnap = await transaction.get(insRef);
            if (!insSnap.exists) {
                throw new Error("El insumo no existe.");
            }

            const data = insSnap.data();
            const currentStock = data.quantity || 0;
            const updatedStock = currentStock + cantidadAjustar;

            if (updatedStock < 0) {
                throw new Error("El stock resultante no puede ser negativo.");
            }

            // Manejo de lotes FEFO
            let batches = data.batches || [];
            if (batches.length === 0 && data.batch) {
                batches.push({
                    batch: data.batch,
                    quantity: currentStock,
                    expirationDate: data.expirationDate || ''
                });
            }

            if (cantidadAjustar < 0) {
                let qtyToReduce = Math.abs(cantidadAjustar);
                batches.sort((a, b) => new Date(a.expirationDate || '2099-12-31') - new Date(b.expirationDate || '2099-12-31'));
                for (let i = 0; i < batches.length && qtyToReduce > 0; i++) {
                    if (batches[i].quantity > 0) {
                        const available = batches[i].quantity;
                        if (available >= qtyToReduce) {
                            batches[i].quantity -= qtyToReduce;
                            qtyToReduce = 0;
                        } else {
                            qtyToReduce -= available;
                            batches[i].quantity = 0;
                        }
                    }
                }
                batches = batches.filter(b => b.quantity > 0);
            } else {
                if (batches.length > 0) {
                    batches[0].quantity += cantidadAjustar;
                } else {
                    batches.push({
                        batch: "AJUSTE",
                        quantity: cantidadAjustar,
                        expirationDate: ""
                    });
                }
            }

            // Actualizar stock e insumo
            transaction.update(insRef, {
                quantity: updatedStock,
                batches: batches,
                lastUpdated: FieldValue.serverTimestamp()
            });

            // Registrar Historial
            const hRef = db.collection("Historial_Movimientos").doc();
            histRef = hRef;
            transaction.set(hRef, {
                type: 'AJUSTE_CRITICO',
                item: insumoName,
                quantity: cantidadAjustar,
                user: "superadmin.test@cormumel.cl",
                date: FieldValue.serverTimestamp(),
                origin: 'Ajuste Manual Crítico',
                dest: 'N/A'
            });

            // Registrar Auditoría
            const aRef = db.collection("Auditoria").doc();
            auditRef = aRef;
            transaction.set(aRef, {
                code: testCode,
                user: "superadmin.test@cormumel.cl",
                item: insumoName,
                action: cantidadAjustar > 0 ? `Suma de stock: ${currentStock} -> ${updatedStock} (+${cantidadAjustar})` : `Resta de stock: ${currentStock} -> ${updatedStock} (-${Math.abs(cantidadAjustar)})`,
                justification: "Prueba automática de flujo de ajustes integrados",
                date: FieldValue.serverTimestamp()
            });

            // Actualizar solicitud como aprobada
            transaction.update(solicitudRef, {
                status: 'aprobado',
                dateActioned: FieldValue.serverTimestamp(),
                actioner: "superadmin.test@cormumel.cl"
            });
        });

        console.log("✅ Transacción de aprobación exitosa.");
    } catch (e) {
        console.error("❌ Fallo en la transacción:", e);
        // Limpiar la solicitud antes de salir
        await solicitudRef.delete();
        process.exit(1);
    }

    // 4. Validar resultados en Base de Datos
    console.log("\n[Paso 3/4] Validando persistencia y estados...");
    const updatedInsumoSnap = await db.collection("Insumos").doc(insumoId).get();
    const updatedInsumoData = updatedInsumoSnap.data();
    const updatedQuantity = updatedInsumoData.quantity;

    console.log(`Stock actualizado en base de datos: ${updatedQuantity}`);
    if (updatedQuantity !== projectedStock) {
        console.error(`❌ ERROR: El stock real (${updatedQuantity}) no coincide con el proyectado (${projectedStock})`);
    } else {
        console.log("✅ El stock se actualizó correctamente en la base de datos.");
    }

    const solSnap = await solicitudRef.get();
    const solData = solSnap.data();
    console.log(`Estado de la solicitud: ${solData.status}`);
    if (solData.status !== "aprobado") {
        console.error(`❌ ERROR: El estado de la solicitud es '${solData.status}', debería ser 'aprobado'`);
    } else {
        console.log("✅ El estado de la solicitud es 'aprobado'.");
    }

    // 5. Limpieza / Reversión (para no alterar datos reales de inventario)
    console.log("\n[Paso 4/4] Limpiando datos de prueba (Reversión)...");
    await db.collection("Insumos").doc(insumoId).update({
        quantity: originalQuantity,
        batches: originalBatches,
        batch: originalBatch,
        expirationDate: originalExpirationDate,
        lastUpdated: FieldValue.serverTimestamp()
    });
    console.log("✅ Stock del insumo revertido a su estado original.");

    await solicitudRef.delete();
    console.log("✅ Solicitud de prueba eliminada.");

    if (histRef) {
        await histRef.delete();
        console.log("✅ Log de Historial eliminado.");
    }

    if (auditRef) {
        await auditRef.delete();
        console.log("✅ Log de Auditoría eliminado.");
    }

    console.log("\n=== PRUEBA FINALIZADA CON ÉXITO Y ENTORNO LIMPIO ===");
    process.exit(0);
}

runTest().catch(console.error);
