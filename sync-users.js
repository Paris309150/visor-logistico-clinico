const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const auth = getAuth();

async function syncAuthToFirestore() {
    try {
        const listUsersResult = await auth.listUsers(1000);
        const authUsers = listUsersResult.users;
        
        console.log(`Encontrados ${authUsers.length} usuarios en Firebase Authentication.`);
        
        let added = 0;
        
        for (const userRecord of authUsers) {
            const uid = userRecord.uid;
            const email = userRecord.email;
            
            // Check if user exists in Firestore
            const docRef = db.collection('Usuarios').doc(uid);
            const docSnap = await docRef.get();
            
            if (!docSnap.exists) {
                console.log(`Creando perfil en Firestore para: ${email}`);
                // Determine a default role
                let role = 'operador';
                let fullName = email.split('@')[0].replace('.', ' ');
                // Capitalize name
                fullName = fullName.replace(/\b\w/g, l => l.toUpperCase());
                
                await docRef.set({
                    fullName: fullName,
                    email: email,
                    role: role,
                    username: email.split('@')[0],
                    center: 'Sede Central',
                    createdAt: new Date()
                });
                added++;
            } else {
                console.log(`El usuario ${email} ya tiene perfil en Firestore.`);
            }
        }
        
        console.log(`\n¡Sincronización completada! Se crearon ${added} perfiles nuevos en Firestore.`);
    } catch (error) {
        console.error("Error al sincronizar usuarios:", error);
    }
}

syncAuthToFirestore();
