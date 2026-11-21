package com.kashish.world

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale

/**
 * Local Offline-First Bundle & Native Album Art Disk Cache Interceptor:
 * 1. Serves bundled app UI assets (`assets/www/*`) directly from the APK in <2ms while preserving
 *    the exact HTTPS origin (`https://kashishji.web.app`) so Firebase Auth, Firestore, IndexedDB,
 *    localStorage, and YouTube IFrame API work identically to live web hosting — with instant startup!
 * 2. Caches YouTube & Google Music cover artwork (`i.ytimg.com`, `lh3.googleusercontent.com`)
 *    into a fast 80MB local disk cache so scrolling Home/Quick Picks/Library is 60/120fps butter-smooth.
 */
object LocalBundleAssetInterceptor {
    private const val ART_CACHE_MAX_BYTES = 80L * 1024L * 1024L // 80 MB album art disk cache

    @Volatile
    private var bundledAssetIndex: Set<String>? = null

    private fun ensureAssetIndex(context: Context): Set<String> {
        bundledAssetIndex?.let { return it }
        val collected = HashSet<String>()
        fun scanDir(prefix: String) {
            val entries = try {
                context.assets.list(prefix)
            } catch (_: Exception) {
                null
            } ?: return
            for (name in entries) {
                val childPath = if (prefix.isEmpty()) name else "$prefix/$name"
                val sub = try {
                    context.assets.list(childPath)
                } catch (_: Exception) {
                    null
                }
                if (sub != null && sub.isNotEmpty()) {
                    scanDir(childPath)
                } else {
                    val relative = childPath.removePrefix("www/")
                    collected.add(relative)
                }
            }
        }
        scanDir("www")
        bundledAssetIndex = collected
        return collected
    }

    fun hasBundledFrontend(context: Context): Boolean {
        return ensureAssetIndex(context).contains("index.html")
    }

    fun intercept(context: Context, request: WebResourceRequest?): WebResourceResponse? {
        if (request == null) return null
        val uri = request.url ?: return null
        val scheme = uri.scheme?.lowercase(Locale.US) ?: return null
        if (scheme != "https" && scheme != "http") return null
        val host = uri.host?.lowercase(Locale.US) ?: return null
        val isGetMethod = request.method?.equals("GET", ignoreCase = true) != false

        // 1. Serve bundled frontend from APK `assets/www/` for instant 0ms launch & offline resilience
        if ((host == "kashishji.web.app" || host == "kashishji.firebaseapp.com") && isGetMethod) {
            val rawPath = (uri.path ?: "/").trimStart('/')
            // Never intercept API or Firebase auth handler paths
            if (rawPath.startsWith("api/") || rawPath.startsWith("__/")) {
                return null
            }

            val index = ensureAssetIndex(context)
            if (index.isNotEmpty()) {
                val targetAsset = when {
                    rawPath.isEmpty() -> "index.html"
                    index.contains(rawPath) -> rawPath
                    !rawPath.contains('.') -> "index.html" // SPA client-side route
                    else -> null
                }

                if (targetAsset != null && index.contains(targetAsset)) {
                    return try {
                        val stream = context.assets.open("www/$targetAsset")
                        val mime = guessMimeType(targetAsset)
                        val headers = mapOf(
                            "Access-Control-Allow-Origin" to "*",
                            "Cache-Control" to if (targetAsset.startsWith("assets/")) {
                                "public, max-age=31536000, immutable"
                            } else {
                                "no-cache"
                            }
                        )
                        WebResourceResponse(mime, if (isTextMime(mime)) "UTF-8" else null, 200, "OK", headers, stream)
                    } catch (_: Exception) {
                        null
                    }
                }
            }
        }

        // 2. Native Disk Cache for Music Cover Art & Thumbnails (instant repeat loads, zero flicker)
        if (isCacheableAlbumArtHost(host, uri) && isGetMethod) {
            return serveOrCacheArtwork(context, uri.toString())
        }

        return null
    }

    private fun isCacheableAlbumArtHost(host: String, uri: Uri): Boolean {
        if (host == "i.ytimg.com" || host == "lh3.googleusercontent.com" || host == "yt3.ggpht.com") {
            val p = (uri.path ?: "").lowercase(Locale.US)
            return p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".webp") ||
                p.endsWith(".png") || host == "lh3.googleusercontent.com"
        }
        return false
    }

    private fun md5(input: String): String {
        val digest = MessageDigest.getInstance("MD5").digest(input.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun serveOrCacheArtwork(context: Context, imageUrl: String): WebResourceResponse? {
        return try {
            val cacheDir = File(context.cacheDir, "kashish_art_cache").apply { mkdirs() }
            val file = File(cacheDir, "${md5(imageUrl)}.img")
            val headers = mapOf(
                "Access-Control-Allow-Origin" to "*",
                "Cache-Control" to "public, max-age=2592000"
            )
            if (file.exists() && file.length() > 100L) {
                file.setLastModified(System.currentTimeMillis())
                return WebResourceResponse("image/jpeg", null, 200, "OK", headers, FileInputStream(file))
            }

            val conn = (URL(imageUrl).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 4500
                readTimeout = 4500
                instanceFollowRedirects = true
            }
            val code = conn.responseCode
            if (code !in 200..299) {
                conn.disconnect()
                return null
            }
            val contentType = conn.contentType?.substringBefore(";")?.trim()?.ifEmpty { "image/jpeg" } ?: "image/jpeg"
            val bytes = conn.inputStream.use { it.readBytes() }
            conn.disconnect()
            if (bytes.size > 100) {
                try {
                    file.writeBytes(bytes)
                    trimArtCacheIfNeeded(cacheDir)
                } catch (_: Exception) {}
                WebResourceResponse(contentType, null, 200, "OK", headers, ByteArrayInputStream(bytes))
            } else {
                null
            }
        } catch (_: Exception) {
            null
        }
    }

    @Volatile
    private var lastArtTrimMs: Long = 0L

    private fun trimArtCacheIfNeeded(cacheDir: File) {
        val now = System.currentTimeMillis()
        if (now - lastArtTrimMs < 60_000L) return
        lastArtTrimMs = now
        try {
            val files = cacheDir.listFiles() ?: return
            var totalSize = files.sumOf { it.length() }
            if (totalSize <= ART_CACHE_MAX_BYTES) return
            files.sortBy { it.lastModified() }
            for (f in files) {
                if (totalSize <= (ART_CACHE_MAX_BYTES * 0.75).toLong()) break
                totalSize -= f.length()
                f.delete()
            }
        } catch (_: Exception) {}
    }

    fun getArtCacheSizeMb(context: Context): Double {
        val dir = File(context.cacheDir, "kashish_art_cache")
        if (!dir.exists()) return 0.0
        var total = 0L
        dir.walkTopDown().forEach { if (it.isFile) total += it.length() }
        return total.toDouble() / (1024.0 * 1024.0)
    }

    private fun guessMimeType(path: String): String {
        val lower = path.lowercase(Locale.US)
        return when {
            lower.endsWith(".html") -> "text/html"
            lower.endsWith(".js") || lower.endsWith(".mjs") -> "application/javascript"
            lower.endsWith(".css") -> "text/css"
            lower.endsWith(".json") || lower.endsWith(".webmanifest") -> "application/json"
            lower.endsWith(".svg") -> "image/svg+xml"
            lower.endsWith(".png") -> "image/png"
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
            lower.endsWith(".webp") -> "image/webp"
            lower.endsWith(".ico") -> "image/x-icon"
            lower.endsWith(".woff2") -> "font/woff2"
            lower.endsWith(".woff") -> "font/woff"
            lower.endsWith(".ttf") -> "font/ttf"
            lower.endsWith(".mp3") -> "audio/mpeg"
            lower.endsWith(".wav") -> "audio/wav"
            lower.endsWith(".mp4") -> "video/mp4"
            else -> "application/octet-stream"
        }
    }

    private fun isTextMime(mime: String): Boolean {
        return mime.startsWith("text/") ||
            mime == "application/javascript" ||
            mime == "application/json" ||
            mime == "image/svg+xml"
    }
}
