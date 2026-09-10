// ==========================================
// Service Worker cho GLSC Assistant PWA
// Version: v2 (Đổi version này mỗi khi cập nhật code để xóa cache cũ)
// ==========================================

const CACHE_NAME = 'glsc-cache-v2';
const ASSETS_TO_CACHE = [
  './',
  './dashboard.html',
  './index.html',
  './style.css',
  './fb-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 1. Cài đặt Service Worker và lưu Cache tài nguyên
self.addEventListener('install', function(event) {
  self.skipWaiting(); // Bắt buộc kích hoạt ngay lập tức
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[Service Worker] Caching app shell');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 2. Kích hoạt và dọn dẹp các bản Cache phiên bản cũ
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keyList) {
      return Promise.all(keyList.map(function(key) {
        if (key !== CACHE_NAME) {
          console.log('[Service Worker] Removing old cache:', key);
          return caches.delete(key);
        }
      }));
    }).then(function() {
      return self.clients.claim(); // Quản lý toàn bộ client ngay lập tức
    })
  );
});

// 3. Bắt các yêu cầu mạng (Fetch Event)
self.addEventListener('fetch', function(event) {
  var requestUrl = new URL(event.request.url);

  // CHUYỂN HƯỚNG TỰ ĐỘNG: Nếu truy cập trang gốc hoặc index.html -> Trả về dashboard.html
  if (requestUrl.pathname.endsWith('/GLSC-App/') || requestUrl.pathname.endsWith('/index.html')) {
    event.respondWith(Response.redirect('dashboard.html', 302));
    return;
  }

  // Xử lý nạp dữ liệu từ Cache (Network First with Cache Fallback)
  event.respondWith(
    fetch(event.request)
      .then(function(response) {
        // Nếu tải online thành công, cập nhật bản sao vào Cache
        if (response && response.status === 200 && response.type === 'basic') {
          var responseToCache = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(function() {
        // Nếu mất mạng (Offline), lấy dữ liệu từ Cache đã lưu trước đó
        return caches.match(event.request);
      })
  );
});
