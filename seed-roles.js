const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function seedRoles() {
    const roles = {
        admin: {
            canManageUsers: true,
            canManageInsumos: true,
            canManageBodegas: true,
            canTransferStock: true,
            canViewReports: true,
            canManageOC: true
        },
        auditor: {
            canManageUsers: false,
            canManageInsumos: false,
            canManageBodegas: false,
            canTransferStock: false,
            canViewReports: true,
            canManageOC: false
        },
        operador: {
            canManageUsers: false,
            canManageInsumos: false,
            canManageBodegas: false,
            canTransferStock: true,
            canViewReports: false,
            canManageOC: false
        }
    };

    for (const [roleName, permissions] of Object.entries(roles)) {
        await db.collection('Roles').doc(roleName).set(permissions);
        console.log(`Rol ${roleName} creado.`);
    }
    console.log("Roles inicializados.");
}

seedRoles();
