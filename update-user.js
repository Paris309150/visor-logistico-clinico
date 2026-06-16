const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function fix() {
    const uid = '21vjYVGTuxPQThrs27ivFVjaZVA3';
    await db.collection('Usuarios').doc(uid).set({
        fullName: 'Somesar Aera',
        username: 'somesar',
        email: 'somesar.aera@cormumal.cl'
    }, { merge: true });
    console.log("Usuario arreglado.");
}
fix();
