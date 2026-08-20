const CACHE = 'huevos-v6'
const STATIC_FILES = ['/', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png']
const DYNAMIC_FILES = ['/index.html', '/styles.css', '/app.js', '/manifest.json']

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(STATIC_FILES.concat(DYNAMIC_FILES)) }))
  self.skipWaiting()
})

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE }).map(function (k) { return caches.delete(k) }))
  }))
  self.clients.claim()
})

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return
  var url = new URL(e.request.url)
  var isDynamic = DYNAMIC_FILES.some(function (f) { return url.pathname === f })
  if (isDynamic) {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var clone = res.clone()
        caches.open(CACHE).then(function (c) { c.put(e.request, clone) })
        return res
      }).catch(function () { return caches.match(e.request) })
    )
  } else {
    e.respondWith(
      caches.match(e.request).then(function (r) {
        return r || fetch(e.request).then(function (res) {
          var clone = res.clone()
          caches.open(CACHE).then(function (c) { c.put(e.request, clone) })
          return res
        })
      })
    )
  }
})
