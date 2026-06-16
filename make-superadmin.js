const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const auth = getAuth();

async function makeSuperAdmin() {
  const targetEmail = 'somesar.aera@cormumal.cl'; // Usando el correo del screenshot (cormumal.cl)
  const fallbackEmail = 'somesar.aera@cormumel.cl'; // Por si el usuario lo escribió con 'e'
  
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(targetEmail);
    console.log(`Usuario encontrado con ${targetEmail} (UID: ${userRecord.uid})`);
  } catch (error) {
    try {
        userRecord = await auth.getUserByEmail(fallbackEmail);
        console.log(`Usuario encontrado con ${fallbackEmail} (UID: ${userRecord.uid})`);
    } catch (err2) {
        console.error("No se encontró el usuario en Firebase Auth. Asegúrate de que el correo esté correcto.");
        process.exit(1);
    }
  }

  const uid = userRecord.uid;
  
  try {
    // 1. Actualizar en Firestore (Usuarios)
    await db.collection('Usuarios').doc(uid).set({
      role: 'superadmin'
    }, { merge: true });
    
    console.log(`✅ Base de datos (Usuarios) actualizada a 'superadmin' para ${uid}`);

    // 2. Actualizar Custom Claims
    await auth.setCustomUserClaims(uid, { admin: true, superadmin: true, role: 'superadmin' });
    console.log(`✅ Tokens de Autenticación (Custom Claims) actualizados a 'superadmin' para ${uid}`);

    console.log("\n¡ÉXITO! El usuario ya es Superadmin. Debe cerrar sesión y volver a ingresar en la app para ver los cambios.");
  } catch (e) {
    console.error("Error al actualizar permisos:", e);
  }
}

makeSuperAdmin();
