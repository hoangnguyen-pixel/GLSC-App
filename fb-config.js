// ════════════════════════════════════════════════════════════
//  Firebase-Konfiguration für hr-sushi + Mitarbeiter-App
//  EINMAL ausfüllen (Werte aus Firebase Console → Projekteinstellungen).
//  Diese Datei bleibt bei App-Updates unverändert!
// ════════════════════════════════════════════════════════════
window.FB_CONFIG = {
  // Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDW2_kat-oMosN4KcHhmHu4_-tPfee1Qvg",
  authDomain: "glsc-nguyenhoang.firebaseapp.com",
  projectId: "glsc-nguyenhoang",
  storageBucket: "glsc-nguyenhoang.firebasestorage.app",
  messagingSenderId: "1010307311736",
  appId: "1:1010307311736:web:1f100d7be0e95ac263e58d"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
};
window.FB_VAPID_KEY = "BH8unCm7GN5vTlM4tGCkQ51uQ5vFG8g0UCpDuM7HNAG_RMfo8yFgpxDA95N8nBzysOhR5jbDluN0Xu5BJVw3RX0";
