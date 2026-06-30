const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

// Your specific service account key
const serviceAccount = require("./freepos-69379-firebase-adminsdk-fbsvc-aa3ed3f5a9.json");

// Initialize using the destructured 'cert' function
initializeApp({
  credential: cert(serviceAccount)
});

// Your specific UID
const YOUR_UID = "8VvTUsh0CfOstvTza2fikKpyfj93";

// Set the claim using the destructured 'getAuth' function
getAuth().setCustomUserClaims(YOUR_UID, { admin: true })
  .then(() => {
    console.log(`Success! Admin claim granted to UID: ${YOUR_UID}`);
    process.exit();
  })
  .catch((error) => {
    console.error("Error setting custom claim:", error);
    process.exit(1);
