// ============================================================================
// Firebase-Konfiguration für hr-sushi + Mitarbeiter-App
// ============================================================================

window.FB_CONFIG = {
  apiKey: "AIzaSyDW2_kat-oMosN4KcHhmHu4_-tPfee1Qvg",
  authDomain: "glsc-nguyenhoang.firebaseapp.com",
  projectId: "glsc-nguyenhoang",
  storageBucket: "glsc-nguyenhoang.firebasestorage.app",
  messagingSenderId: "1010307311736",
  appId: "1:1010307311736:web:1f100d7be0e95ac263e58d"
};

window.FB_VAPID_KEY = "BH8unCm7GN5vT1M4tGCKQ51uQ5vFG8g0UCpDum7HNAG_RMfo8yFgpxDA95N8nBzysOHr5jbdLuN0Xu5";
// ==========================================
// Cấu hình tài khoản Gebietsleiter & Tải dữ liệu vùng
// ==========================================
window.CURRENT_USER_EMAIL = "hoang.nguyen@sushi-circle.de";
window.CURRENT_USER_ROLE = "Gebietsleiter";

function loadUserStoresData() {
    if (typeof db !== 'undefined' && window.CURRENT_USER_EMAIL) {
        db.collection("users").doc(window.CURRENT_USER_EMAIL).get().then(function(doc) {
            if (doc.exists) {
                window.radarStoresData = doc.data().stores || [];
                if (typeof renderRadar === 'function') renderRadar();
            }
        }).catch(function(error) {
            console.error("Lỗi tải dữ liệu vùng:", error);
        });
    }
}

document.addEventListener("DOMContentLoaded", function() {
    loadUserStoresData();
});
