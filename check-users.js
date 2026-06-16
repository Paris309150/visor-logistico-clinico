const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function check() {
    const snap = await db.collection('Usuarios').get();
    console.log(`Hay ${snap.size} usuarios en la colección.`);
    snap.forEach(doc => {
        console.log(doc.id, "=>", doc.data());
    });
}
check();
