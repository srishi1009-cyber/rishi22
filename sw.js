// ============================================================
// RISHI20 - SERVICE WORKER
// Clean PWA / GitHub Pages Version
// ============================================================

const CACHE_NAME = "rishi20-v1";

const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json"
];

// ============================================================
// INSTALL
// ============================================================

self.addEventListener("install", (event) => {

    console.log("[Rishi20 SW] Installing...");

    event.waitUntil(

        caches.open(CACHE_NAME)
            .then((cache) => {

                console.log("[Rishi20 SW] Caching app shell");

                return cache.addAll(APP_SHELL);

            })
            .then(() => {

                return self.skipWaiting();

            })

    );

});

// ============================================================
// ACTIVATE
// ============================================================

self.addEventListener("activate", (event) => {

    console.log("[Rishi20 SW] Activating...");

    event.waitUntil(

        caches.keys()
            .then((cacheNames) => {

                return Promise.all(

                    cacheNames.map((cacheName) => {

                        if (cacheName !== CACHE_NAME) {

                            console.log(
                                "[Rishi20 SW] Deleting old cache:",
                                cacheName
                            );

                            return caches.delete(cacheName);

                        }

                        return Promise.resolve();

                    })

                );

            })
            .then(() => {

                return self.clients.claim();

            })

    );

});

// ============================================================
// FETCH
// ============================================================

self.addEventListener("fetch", (event) => {

    const request = event.request;

    // Only GET requests
    if (request.method !== "GET") {
        return;
    }

    // --------------------------------------------------------
    // IMPORTANT:
    // Never intercept audio/video/range requests.
    // This prevents music playback problems.
    // --------------------------------------------------------

    if (
        request.destination === "audio" ||
        request.destination === "video" ||
        request.headers.has("range")
    ) {
        return;
    }

    const url = new URL(request.url);

    // Only handle our own GitHub Pages origin
    if (url.origin !== self.location.origin) {
        return;
    }

    // --------------------------------------------------------
    // PAGE NAVIGATION
    // --------------------------------------------------------

    if (
        request.mode === "navigate" ||
        request.destination === "document"
    ) {

        event.respondWith(

            fetch(request)

                .then((response) => {

                    if (
                        response &&
                        response.status === 200
                    ) {

                        const copy = response.clone();

                        caches.open(CACHE_NAME)
                            .then((cache) => {

                                cache.put(request, copy);

                            });

                    }

                    return response;

                })

                .catch(() => {

                    return caches.match(request)
                        .then((cached) => {

                            return (
                                cached ||
                                caches.match("./index.html")
                            );

                        });

                })

        );

        return;
    }

    // --------------------------------------------------------
    // JAVASCRIPT / CSS / MANIFEST
    // --------------------------------------------------------

    if (
        request.destination === "script" ||
        request.destination === "style" ||
        request.destination === "manifest"
    ) {

        event.respondWith(

            fetch(request)

                .then((response) => {

                    if (
                        response &&
                        response.status === 200
                    ) {

                        const copy = response.clone();

                        caches.open(CACHE_NAME)
                            .then((cache) => {

                                cache.put(request, copy);

                            });

                    }

                    return response;

                })

                .catch(() => {

                    return caches.match(request);

                })

        );

        return;
    }

    // --------------------------------------------------------
    // OTHER SAME-ORIGIN FILES
    // --------------------------------------------------------

    event.respondWith(

        caches.match(request)

            .then((cachedResponse) => {

                if (cachedResponse) {
                    return cachedResponse;
                }

                return fetch(request)

                    .then((response) => {

                        if (
                            response &&
                            response.status === 200 &&
                            response.type === "basic"
                        ) {

                            const copy = response.clone();

                            caches.open(CACHE_NAME)
                                .then((cache) => {

                                    cache.put(request, copy);

                                });

                        }

                        return response;

                    });

            })

    );

});

// ============================================================
// MESSAGE HANDLER
// ============================================================

self.addEventListener("message", (event) => {

    if (
        event.data &&
        event.data.type === "SKIP_WAITING"
    ) {

        self.skipWaiting();

    }

});