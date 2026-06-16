const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const serviceAccount = require('./serviceAccountKey.json');

let app;
try {
  app = initializeApp({
    credential: cert(serviceAccount)
  });
} catch (e) {
  // Ignore if already initialized
}

async function run() {
  try {
    const user = await getAuth().getUserByEmail('catherine.oviedo@cormumel.cl');
    await getAuth().updateUser(user.uid, { password: 'Cormu2335*' });
    console.log('Successfully updated user', user.uid);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
