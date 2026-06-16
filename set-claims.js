const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const auth = getAuth();

async function migrateCustomClaims() {
  console.log("=== INICIANDO ASIGNACIÓN DE CUSTOM CLAIMS (Coste 0) ===");
  
  try {
    const usuariosRef = db.collection('Usuarios');
    const snapshot = await usuariosRef.get();
    
    if (snapshot.empty) {
      console.log('No se encontraron usuarios en la base de datos.');
      return;
    }

    let adminCount = 0;
    let superAdminCount = 0;
    let supervisorCount = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const uid = doc.id;
      const roleStr = (data.role || '').toLowerCase().trim();

      try {
        let claimsToSet = {};

        if (['admin', 'global', 'administrador'].includes(roleStr)) {
          claimsToSet = { admin: true, role: 'admin' };
          adminCount++;
        } else if (roleStr === 'superadmin') {
          claimsToSet = { admin: true, superadmin: true, role: 'superadmin' };
          superAdminCount++;
        } else if (roleStr === 'supervisor' || roleStr === 'auditor') {
          claimsToSet = { supervisor: true, role: 'supervisor' };
          supervisorCount++;
        } else {
          claimsToSet = { role: 'user' }; // Rol por defecto
        }

        // Asignar los claims a Firebase Auth
        await auth.setCustomUserClaims(uid, claimsToSet);
        console.log(`✅ Claims asignados a [${uid}] - ${data.name || data.email} -> Rol: ${claimsToSet.role}`);
        
      } catch (authErr) {
        console.error(`⚠️ Error al asignar claims a UID: ${uid}. Motivo: ${authErr.message}`);
      }
    }

    console.log(`\n=== MIGRACIÓN FINALIZADA ===`);
    console.log(`Admins configurados: ${adminCount}`);
    console.log(`SuperAdmins configurados: ${superAdminCount}`);
    console.log(`Supervisores configurados: ${supervisorCount}`);
    console.log(`\nIMPORTANTE: Los usuarios deberán CERRAR SESIÓN e INICIAR SESIÓN nuevamente para que los nuevos tokens con coste 0 hagan efecto.`);

  } catch (error) {
    console.error("Error general ejecutando la migración:", error);
  }
}

migrateCustomClaims();
