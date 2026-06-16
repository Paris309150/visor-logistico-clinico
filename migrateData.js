const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const fs = require("fs");

// INSTRUCCIONES:
// 1. Ve a la consola de Firebase -> Configuración del proyecto -> Cuentas de servicio.
// 2. Genera una nueva clave privada y guárdala como "serviceAccountKey.json" en esta misma carpeta.
// 3. Instala el SDK de Admin: npm install firebase-admin
// 4. Ejecuta el script: node migrateData.js

const serviceAccountPath = "./serviceAccountKey.json";

if (!fs.existsSync(serviceAccountPath)) {
    console.error("ERROR CRÍTICO: No se encontró el archivo serviceAccountKey.json");
    console.log("Por favor, descarga tu clave de cuenta de servicio de Firebase y colócala en esta carpeta.");
    process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

async function runMigration() {
    console.log("=== INICIANDO MIGRACIÓN DE ESQUEMA DE INSUMOS ===");
    
    const insumosRef = db.collection('Insumos');
    const snapshot = await insumosRef.get();
    
    if (snapshot.empty) {
        console.log("No se encontraron documentos en la colección Insumos.");
        return;
    }
    
    console.log(`Analizando ${snapshot.size} documentos...`);
    
    let updatedCount = 0;
    const batchArray = [];
    let currentBatch = db.batch();
    let currentBatchSize = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        let needsUpdate = false;
        
        // Estructura estandarizada en Inglés (Enterprise Standard)
        const standardizedData = { ...data };

        // 1. Mapear claves en español a inglés si no existen en inglés
        if (data.cantidad !== undefined && data.quantity === undefined) { standardizedData.quantity = Number(data.cantidad); needsUpdate = true; }
        if (data.vencimiento !== undefined && data.expirationDate === undefined) { standardizedData.expirationDate = data.vencimiento; needsUpdate = true; }
        if (data.fechaVencimiento !== undefined && data.expirationDate === undefined) { standardizedData.expirationDate = data.fechaVencimiento; needsUpdate = true; }
        if (data.costo_unitario !== undefined && data.unitPrice === undefined) { standardizedData.unitPrice = Number(data.costo_unitario); needsUpdate = true; }
        if (data.precio !== undefined && data.unitPrice === undefined) { standardizedData.unitPrice = Number(data.precio); needsUpdate = true; }
        if (data.lote !== undefined && data.batch === undefined) { standardizedData.batch = data.lote; needsUpdate = true; }
        if (data.categoria !== undefined && data.category === undefined) { standardizedData.category = data.categoria; needsUpdate = true; }
        if (data.codigo !== undefined && data.code === undefined) { standardizedData.code = data.codigo; needsUpdate = true; }
        if (data.stock_minimo !== undefined && data.criticalLimit === undefined) { standardizedData.criticalLimit = Number(data.stock_minimo); needsUpdate = true; }
        if (data.ubicacion !== undefined && data.location === undefined) { standardizedData.location = data.ubicacion; needsUpdate = true; }
        if (data.descripcion !== undefined && data.name === undefined) { standardizedData.name = data.descripcion; needsUpdate = true; }
        if (data.nombre !== undefined && data.name === undefined) { standardizedData.name = data.nombre; needsUpdate = true; }

        // 2. Eliminar las claves sucias en español/redundantes
        const keysToDelete = [
            'cantidad', 'vencimiento', 'fechaVencimiento', 'costo_unitario', 'precio', 
            'lote', 'categoria', 'codigo', 'stock_minimo', 'ubicacion', 'descripcion', 'nombre'
        ];

        keysToDelete.forEach(key => {
            if (standardizedData[key] !== undefined) {
                standardizedData[key] = FieldValue.delete();
                needsUpdate = true;
            }
        });

        if (needsUpdate) {
            currentBatch.update(doc.ref, standardizedData);
            currentBatchSize++;
            updatedCount++;

            // Los Batches de Firestore tienen un límite de 500 operaciones
            if (currentBatchSize === 400) {
                batchArray.push(currentBatch);
                currentBatch = db.batch();
                currentBatchSize = 0;
            }
        }
    });

    if (currentBatchSize > 0) {
        batchArray.push(currentBatch);
    }

    if (updatedCount === 0) {
        console.log("Todos los documentos ya se encuentran estandarizados. ¡Migración exitosa sin cambios!");
        return;
    }

    console.log(`Aplicando saneamiento a ${updatedCount} documentos divididos en ${batchArray.length} lotes...`);
    
    for (let i = 0; i < batchArray.length; i++) {
        await batchArray[i].commit();
        console.log(`Lote ${i + 1}/${batchArray.length} completado.`);
    }

    console.log("=== MIGRACIÓN DE ESQUEMA COMPLETADA CON ÉXITO ===");
}

runMigration().catch(console.error);
