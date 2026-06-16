const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const serviceAccount = require('./serviceAccountKey.json');

const app = initializeApp({
  credential: cert(serviceAccount)
});

getAuth(app).listUsers(10)
  .then((listUsersResult) => {
    listUsersResult.users.forEach((userRecord) => {
      console.log('user', userRecord.toJSON());
    });
    process.exit(0);
  })
  .catch((error) => {
    console.log('Error listing users:', error);
    process.exit(1);
  });
