/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-b1bafff1'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "pwa-maskable-512x512.png",
    "revision": "2a728c79aadfaaecf1cc3a6efa7fa73b"
  }, {
    "url": "pwa-maskable-192x192.png",
    "revision": "12c1143bc68ad200376aff0fa1ec9d07"
  }, {
    "url": "pwa-512x512.png",
    "revision": "b321f2b08d973f16b868d8a090f92a16"
  }, {
    "url": "pwa-192x192.png",
    "revision": "6d8e66853a3823ee94b7508b15d18577"
  }, {
    "url": "index.html",
    "revision": "0994bf93d232021d1004c57773aafc4b"
  }, {
    "url": "favicon.png",
    "revision": "0529f9ca10aeed57eac7779d106b0774"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "a5ac084f8c7c9e438f2f43ba5031935c"
  }, {
    "url": "app-icon.png",
    "revision": "9138fc4ac57c260908ac2b60b82840cf"
  }, {
    "url": "assets/workbox-window.prod.es5-Bd17z0YL.js",
    "revision": null
  }, {
    "url": "assets/index-oYX65thw.js",
    "revision": null
  }, {
    "url": "assets/index-B-nDoi13.css",
    "revision": null
  }, {
    "url": "assets/golden_gaze_logo.svg",
    "revision": null
  }, {
    "url": "assets/aistudio/image_c52b838d.png",
    "revision": null
  }, {
    "url": "assets/aistudio/image_c4662aef.png",
    "revision": null
  }, {
    "url": "assets/aistudio/image_b8f8187e.png",
    "revision": null
  }, {
    "url": "assets/aistudio/image_ae76b209.png",
    "revision": null
  }, {
    "url": "assets/aistudio/image_9f6afb74.png",
    "revision": null
  }, {
    "url": "assets/aistudio/Dreamy_Daisy-Adorned_Pink_Portrait_7f3c82b2.png",
    "revision": null
  }, {
    "url": "pwa-192x192.png",
    "revision": "6d8e66853a3823ee94b7508b15d18577"
  }, {
    "url": "pwa-512x512.png",
    "revision": "b321f2b08d973f16b868d8a090f92a16"
  }, {
    "url": "pwa-maskable-192x192.png",
    "revision": "12c1143bc68ad200376aff0fa1ec9d07"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "2a728c79aadfaaecf1cc3a6efa7fa73b"
  }, {
    "url": "manifest.webmanifest",
    "revision": "7ac93b2fd61d7a52e37bb38955135dcc"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));
  workbox.registerRoute(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 20,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/res\.cloudinary\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "cloudinary-media-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 60,
      maxAgeSeconds: 2592000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/(?:www\.youtube\.com\/(?:iframe_api|s\/player\/.*)|s\.ytimg\.com\/.*)/i, new workbox.StaleWhileRevalidate({
    "cacheName": "youtube-player-script-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 15,
      maxAgeSeconds: 604800
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/(?:(?:i|i9)\.ytimg\.com|(?:yt3|lh3)\.googleusercontent\.com)\/.*/i, new workbox.CacheFirst({
    "cacheName": "youtube-thumbnails-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 150,
      maxAgeSeconds: 2592000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
