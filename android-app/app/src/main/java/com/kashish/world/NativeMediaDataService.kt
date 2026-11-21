package com.kashish.world

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Native Asynchronous Data & Caching Engine for Android APK:
 * - Offloads YouTube Music Songs search, Videos search, Song-only Suggestions, Lyrics (LRCLIB),
 *   and Cloudinary fetches onto a native 4-thread Kotlin pool (ZERO WebView JS thread blocking).
 * - Persists search & lyrics results to device disk cache so repeat searches and lyrics open in <5ms
 *   and continue working even on poor networks or offline.
 */
object NativeMediaDataService {
    private val ioExecutor = Executors.newFixedThreadPool(4)
    private val memoryCache = ConcurrentHashMap<String, Pair<Long, String>>()

    private const val SEARCH_TTL_MS = 15L * 60L * 1000L       // 15 minutes
    private const val SUGGEST_TTL_MS = 20L * 60L * 1000L      // 20 minutes
    private const val LYRICS_TTL_MS = 30L * 24L * 60L * 60L * 1000L // 30 days on disk

    private const val YTM_SONGS_PARAMS = "EgWKAQIIAWoKEAkQBRAKEAMQBA=="
    private const val YTM_VIDEOS_PARAMS = "EgWKAQIQAWoKEAkQChAFEAMQBA=="

    private fun md5(input: String): String {
        val digest = MessageDigest.getInstance("MD5").digest(input.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun getCacheFile(context: Context, namespace: String, key: String): File {
        val dir = File(context.cacheDir, "kashish_api_cache/$namespace").apply { mkdirs() }
        return File(dir, "${md5(key)}.json")
    }

    private fun readDiskOrMemCache(context: Context, namespace: String, key: String, ttlMs: Long): String? {
        val memKey = "$namespace::$key"
        val now = System.currentTimeMillis()
        memoryCache[memKey]?.let { (savedAt, value) ->
            if (now - savedAt < ttlMs && value.isNotEmpty()) {
                return value
            }
        }
        return try {
            val file = getCacheFile(context, namespace, key)
            if (file.exists() && now - file.lastModified() < ttlMs) {
                val text = file.readText(Charsets.UTF_8)
                if (text.isNotEmpty()) {
                    memoryCache[memKey] = Pair(file.lastModified(), text)
                    return text
                }
            }
            null
        } catch (_: Exception) {
            null
        }
    }

    private fun writeDiskAndMemCache(context: Context, namespace: String, key: String, payload: String) {
        if (payload.isEmpty()) return
        val memKey = "$namespace::$key"
        memoryCache[memKey] = Pair(System.currentTimeMillis(), payload)
        try {
            val file = getCacheFile(context, namespace, key)
            file.writeText(payload, Charsets.UTF_8)
        } catch (_: Exception) {}
    }

    fun getApiCacheSizeMb(context: Context): Double {
        val dir = File(context.cacheDir, "kashish_api_cache")
        if (!dir.exists()) return 0.0
        var total = 0L
        dir.walkTopDown().forEach { if (it.isFile) total += it.length() }
        return total.toDouble() / (1024.0 * 1024.0)
    }

    fun clearAllNativeCaches(context: Context) {
        memoryCache.clear()
        listOf("kashish_api_cache", "kashish_art_cache").forEach { name ->
            try {
                File(context.cacheDir, name).deleteRecursively()
            } catch (_: Exception) {}
        }
    }

    private fun sanitizeSongTitle(raw: String): String {
        var clean = raw.trim()
        if (clean.isEmpty()) return "Untitled Song"
        clean = clean
            .replace(
                Regex(
                    "\\s*[(\\[{]\\s*(?:official\\s*(?:music\\s*)?video|full\\s*video(?:\\s*song)?|video\\s*song|lyrical(?:\\s*video)?|lyric\\s*video|official\\s*lyric\\s*video|official\\s*audio|audio\\s*song|full\\s*audio|4k\\s*video|hd\\s*video|8k\\s*video|full\\s*song(?:\\s*with\\s*lyrics)?)\\s*[)\\]}]\\s*",
                    RegexOption.IGNORE_CASE
                ),
                " "
            )
            .replace(
                Regex(
                    "\\s*(?:[-|•:]\\s*)?(?:full\\s*video(?:\\s*song)?|official\\s*(?:music\\s*)?video|video\\s*song|lyrical\\s*video)\\b.*$",
                    RegexOption.IGNORE_CASE
                ),
                ""
            )
            .trim()
        if (clean.contains("|")) {
            val first = clean.substringBefore("|").trim()
            if (first.length >= 2) clean = first
        }
        return clean.replace(Regex("\\s+"), " ").trim().ifEmpty { raw.trim() }
    }

    private fun sanitizeArtist(raw: String): String {
        val clean = raw
            .replace(Regex("\\s*-\\s*Topic$", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\bVEVO$", RegexOption.IGNORE_CASE), "")
            .trim()
        return clean.ifEmpty { "Music Artist" }
    }

    private fun isJunkNonSong(rawTitle: String, durationSec: Int): Boolean {
        val lower = rawTitle.lowercase()
        if (Regex("\\b(official\\s*trailer|movie\\s*trailer|teaser|making\\s*of|behind\\s*the\\s*scenes|dialogue\\s*promo|full\\s*movie|whatsapp\\s*status|status\\s*video|reaction\\s*to|interview|press\\s*conference|#shorts|yt\\s*shorts)\\b")
                .containsMatchIn(lower)
        ) {
            return true
        }
        if (durationSec > 0 && (durationSec < 45 || durationSec > 960)) {
            return true
        }
        return false
    }

    private fun parseDurationSec(durationText: String): Int {
        val parts = durationText.trim().split(":").mapNotNull { it.toIntOrNull() }
        return when (parts.size) {
            2 -> parts[0] * 60 + parts[1]
            3 -> parts[0] * 3600 + parts[1] * 60 + parts[2]
            else -> 0
        }
    }

    fun searchYouTubeMusicSongsSync(context: Context, query: String): String {
        return queryYouTubeMusicInternal(context, query, isVideoMode = false)
    }

    fun searchYouTubeMusicSongsAsync(context: Context, reqId: String, query: String) {
        val appCtx = context.applicationContext
        ioExecutor.execute {
            val result = queryYouTubeMusicInternal(appCtx, query, isVideoMode = false)
            MainActivity.resolveNativeAsyncCallback(reqId, result)
        }
    }

    fun searchYouTubeVideosAsync(context: Context, reqId: String, query: String) {
        val appCtx = context.applicationContext
        ioExecutor.execute {
            val result = queryYouTubeMusicInternal(appCtx, query, isVideoMode = true)
            MainActivity.resolveNativeAsyncCallback(reqId, result)
        }
    }

    private fun queryYouTubeMusicInternal(context: Context, query: String, isVideoMode: Boolean): String {
        val cleanQuery = query.trim()
        if (cleanQuery.isEmpty()) return "[]"
        val ns = if (isVideoMode) "ytm_videos" else "ytm_songs"
        val cacheKey = cleanQuery.lowercase()

        readDiskOrMemCache(context, ns, cacheKey, SEARCH_TTL_MS)?.let { return it }

        var conn: HttpURLConnection? = null
        return try {
            val url = URL("https://music.youtube.com/youtubei/v1/search?prettyPrint=false")
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 7000
                readTimeout = 7000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Origin", "https://music.youtube.com")
                setRequestProperty("Referer", "https://music.youtube.com/")
                setRequestProperty(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
                )
            }
            val payload = JSONObject().apply {
                put(
                    "context",
                    JSONObject().put(
                        "client",
                        JSONObject().apply {
                            put("clientName", "WEB_REMIX")
                            put("clientVersion", "1.20250120.01.00")
                            put("hl", "en")
                            put("gl", "IN")
                        }
                    )
                )
                put("query", cleanQuery)
                put("params", if (isVideoMode) YTM_VIDEOS_PARAMS else YTM_SONGS_PARAMS)
            }
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(payload.toString())
                writer.flush()
            }
            if (conn.responseCode !in 200..299) return "[]"
            val raw = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { it.readText() }
            val root = JSONObject(raw)
            val results = JSONArray()
            val seenIds = HashSet<String>()

            fun extractShelfItems(node: Any?) {
                when (node) {
                    is JSONObject -> {
                        val renderer = node.optJSONObject("musicResponsiveListItemRenderer")
                        if (renderer != null) {
                            var videoId = renderer.optJSONObject("playlistItemData")?.optString("videoId", "") ?: ""
                            if (videoId.isEmpty()) {
                                videoId = renderer
                                    .optJSONObject("overlay")
                                    ?.optJSONObject("musicItemThumbnailOverlayRenderer")
                                    ?.optJSONObject("content")
                                    ?.optJSONObject("musicPlayButtonRenderer")
                                    ?.optJSONObject("playNavigationEndpoint")
                                    ?.optJSONObject("watchEndpoint")
                                    ?.optString("videoId", "") ?: ""
                            }
                            if (videoId.length == 11 && !seenIds.contains(videoId)) {
                                val flexCols = renderer.optJSONArray("flexColumns")
                                var rawTitle = ""
                                val metaParts = mutableListOf<String>()
                                if (flexCols != null) {
                                    for (c in 0 until flexCols.length()) {
                                        val runs = flexCols.optJSONObject(c)
                                            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")
                                            ?.optJSONObject("text")
                                            ?.optJSONArray("runs") ?: continue
                                        val joined = StringBuilder()
                                        for (r in 0 until runs.length()) {
                                            joined.append(runs.optJSONObject(r)?.optString("text", "") ?: "")
                                        }
                                        val text = joined.toString().trim()
                                        if (text.isNotEmpty()) {
                                            if (c == 0) rawTitle = text else metaParts.add(text)
                                        }
                                    }
                                }
                                if (rawTitle.isNotEmpty()) {
                                    val metaJoined = metaParts.joinToString(" • ")
                                    val tokens = metaJoined.split("•").map { it.trim() }.filter { it.isNotEmpty() }
                                    var artist = if (isVideoMode) "YouTube Video" else "Music Artist"
                                    var duration = ""
                                    var viewsText = ""
                                    for (tok in tokens) {
                                        if (tok.matches(Regex("^\\d{1,2}:\\d{2}(:\\d{2})?$"))) {
                                            duration = tok
                                        } else if (tok.contains("views", ignoreCase = true)) {
                                            viewsText = tok
                                        } else if (
                                            !tok.equals("Song", ignoreCase = true) &&
                                            !tok.equals("Video", ignoreCase = true) &&
                                            !tok.contains("plays", ignoreCase = true) &&
                                            (artist == "Music Artist" || artist == "YouTube Video")
                                        ) {
                                            artist = tok
                                        }
                                    }
                                    val durationSec = parseDurationSec(duration)
                                    if (!isVideoMode && isJunkNonSong(rawTitle, durationSec)) {
                                        return
                                    }
                                    val finalTitle = if (isVideoMode) rawTitle else sanitizeSongTitle(rawTitle)
                                    val finalArtist = if (isVideoMode) sanitizeArtist(artist) else sanitizeArtist(artist)

                                    val thumbs = renderer.optJSONObject("thumbnail")
                                        ?.optJSONObject("musicThumbnailRenderer")
                                        ?.optJSONObject("thumbnail")
                                        ?.optJSONArray("thumbnails")
                                    var thumbUrl = if (isVideoMode) {
                                        "https://i.ytimg.com/vi/$videoId/mqdefault.jpg"
                                    } else {
                                        "https://i.ytimg.com/vi/$videoId/hqdefault.jpg"
                                    }
                                    if (!isVideoMode && thumbs != null && thumbs.length() > 0) {
                                        val lastThumb = thumbs.optJSONObject(thumbs.length() - 1)?.optString("url", "") ?: ""
                                        if (lastThumb.contains("googleusercontent.com") || lastThumb.contains("ggpht.com")) {
                                            thumbUrl = lastThumb.replace(Regex("=w\\d+-h\\d+.*$"), "=w512-h512-l90-rj")
                                        }
                                    }
                                    seenIds.add(videoId)
                                    results.put(
                                        JSONObject().apply {
                                            put("id", videoId)
                                            put("videoId", videoId)
                                            put("title", finalTitle)
                                            put("artist", finalArtist)
                                            put("thumbnail", thumbUrl)
                                            put("durationText", duration)
                                            put("durationSeconds", durationSec)
                                            if (viewsText.isNotEmpty()) put("viewsText", viewsText)
                                            put("mediaType", if (isVideoMode) "video" else "song")
                                            put("catalogSource", if (isVideoMode) "youtube_video" else "youtube_music")
                                        }
                                    )
                                }
                            }
                        } else {
                            val keys = node.keys()
                            while (keys.hasNext() && results.length() < 30) {
                                extractShelfItems(node.opt(keys.next()))
                            }
                        }
                    }
                    is JSONArray -> {
                        for (i in 0 until node.length()) {
                            if (results.length() >= 30) break
                            extractShelfItems(node.opt(i))
                        }
                    }
                }
            }

            extractShelfItems(root)
            val jsonOut = results.toString()
            if (results.length() > 0) {
                writeDiskAndMemCache(context, ns, cacheKey, jsonOut)
            }
            jsonOut
        } catch (_: Exception) {
            "[]"
        } finally {
            try { conn?.disconnect() } catch (_: Exception) {}
        }
    }

    fun fetchYouTubeMusicSuggestionsAsync(context: Context, reqId: String, query: String) {
        val appCtx = context.applicationContext
        ioExecutor.execute {
            val cleanQuery = query.trim()
            if (cleanQuery.isEmpty()) {
                MainActivity.resolveNativeAsyncCallback(reqId, "[]")
                return@execute
            }
            val cacheKey = cleanQuery.lowercase()
            readDiskOrMemCache(appCtx, "ytm_suggest", cacheKey, SUGGEST_TTL_MS)?.let { cached ->
                MainActivity.resolveNativeAsyncCallback(reqId, cached)
                return@execute
            }

            var conn: HttpURLConnection? = null
            val out = try {
                val url = URL("https://music.youtube.com/youtubei/v1/music/get_search_suggestions?prettyPrint=false")
                conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 4500
                    readTimeout = 4500
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Origin", "https://music.youtube.com")
                    setRequestProperty("Referer", "https://music.youtube.com/")
                    setRequestProperty(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
                    )
                }
                val payload = JSONObject().apply {
                    put(
                        "context",
                        JSONObject().put(
                            "client",
                            JSONObject().apply {
                                put("clientName", "WEB_REMIX")
                                put("clientVersion", "1.20250120.01.00")
                                put("hl", "en")
                                put("gl", "IN")
                            }
                        )
                    )
                    put("input", cleanQuery)
                }
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                    writer.write(payload.toString())
                    writer.flush()
                }
                if (conn.responseCode !in 200..299) {
                    "[]"
                } else {
                    val raw = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { it.readText() }
                    val root = JSONObject(raw)
                    val list = JSONArray()
                    val seen = HashSet<String>()

                    fun walk(node: Any?) {
                        when (node) {
                            is JSONObject -> {
                                val suggRenderer = node.optJSONObject("searchSuggestionRenderer")
                                if (suggRenderer != null) {
                                    val text = suggRenderer.optJSONObject("navigationEndpoint")
                                        ?.optJSONObject("searchEndpoint")
                                        ?.optString("query", "")
                                        ?.trim() ?: ""
                                    if (text.isNotEmpty() && !seen.contains(text.lowercase())) {
                                        seen.add(text.lowercase())
                                        list.put(text)
                                    }
                                } else {
                                    val keys = node.keys()
                                    while (keys.hasNext() && list.length() < 8) {
                                        walk(node.opt(keys.next()))
                                    }
                                }
                            }
                            is JSONArray -> {
                                for (i in 0 until node.length()) {
                                    if (list.length() >= 8) break
                                    walk(node.opt(i))
                                }
                            }
                        }
                    }

                    walk(root)
                    val jsonStr = list.toString()
                    if (list.length() > 0) {
                        writeDiskAndMemCache(appCtx, "ytm_suggest", cacheKey, jsonStr)
                    }
                    jsonStr
                }
            } catch (_: Exception) {
                "[]"
            } finally {
                try { conn?.disconnect() } catch (_: Exception) {}
            }
            MainActivity.resolveNativeAsyncCallback(reqId, out)
        }
    }

    fun fetchLyricsAsync(context: Context, reqId: String, title: String, artist: String) {
        val appCtx = context.applicationContext
        ioExecutor.execute {
            val cleanTitle = sanitizeSongTitle(title)
            val primaryArtist = artist.split(",", "&").firstOrNull()?.trim() ?: ""
            val cacheKey = "${cleanTitle.lowercase()}::${primaryArtist.lowercase()}"

            readDiskOrMemCache(appCtx, "lyrics_lrc", cacheKey, LYRICS_TTL_MS)?.let { cached ->
                MainActivity.resolveNativeAsyncCallback(reqId, cached)
                return@execute
            }

            fun queryLrclib(urlStr: String): JSONObject? {
                var conn: HttpURLConnection? = null
                return try {
                    conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                        requestMethod = "GET"
                        connectTimeout = 5000
                        readTimeout = 5000
                        setRequestProperty("User-Agent", "KashishWorldApp/3.2 (Android)")
                    }
                    if (conn.responseCode !in 200..299) return null
                    val raw = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { it.readText() }
                    val arr = JSONArray(raw)
                    for (i in 0 until arr.length()) {
                        val item = arr.optJSONObject(i) ?: continue
                        val synced = item.optString("syncedLyrics", "").trim()
                        val plain = item.optString("plainLyrics", "").trim()
                        if (synced.isNotEmpty() || plain.isNotEmpty()) {
                            return JSONObject().apply {
                                put("syncedLyrics", synced)
                                put("plainLyrics", plain)
                            }
                        }
                    }
                    null
                } catch (_: Exception) {
                    null
                } finally {
                    try { conn?.disconnect() } catch (_: Exception) {}
                }
            }

            val encodedTitle = URLEncoder.encode(cleanTitle, "UTF-8")
            val encodedArtist = URLEncoder.encode(primaryArtist, "UTF-8")
            val hit = queryLrclib("https://lrclib.net/api/search?track_name=$encodedTitle&artist_name=$encodedArtist")
                ?: queryLrclib("https://lrclib.net/api/search?q=${URLEncoder.encode("$cleanTitle $primaryArtist".trim(), "UTF-8")}")

            val out = hit?.toString() ?: "{}"
            if (hit != null) {
                writeDiskAndMemCache(appCtx, "lyrics_lrc", cacheKey, out)
            }
            MainActivity.resolveNativeAsyncCallback(reqId, out)
        }
    }

    fun fetchCloudinaryFolderSync(
        context: Context,
        cloudName: String,
        apiKey: String,
        apiSecret: String,
        folder: String
    ): String {
        val cleanCloud = cloudName.trim()
        val cleanKey = apiKey.trim()
        val cleanSecret = apiSecret.trim()
        val cleanFolder = folder.trim().trim('/').ifEmpty { "memories_of_kashish" }
        if (cleanCloud.isEmpty() || cleanKey.isEmpty() || cleanSecret.isEmpty()) return "{}"

        val cacheKey = "$cleanCloud::$cleanFolder"
        readDiskOrMemCache(context, "cloudinary", cacheKey, 10L * 60L * 1000L)?.let { return it }

        var conn: HttpURLConnection? = null
        return try {
            val authToken = Base64.encodeToString(
                "$cleanKey:$cleanSecret".toByteArray(Charsets.UTF_8),
                Base64.NO_WRAP
            )
            val url = URL("https://api.cloudinary.com/v1_1/$cleanCloud/resources/search")
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 8000
                readTimeout = 8000
                doOutput = true
                setRequestProperty("Authorization", "Basic $authToken")
                setRequestProperty("Content-Type", "application/json")
            }
            val payload = JSONObject().apply {
                put(
                    "expression",
                    "folder=\"$cleanFolder\" OR folder=\"$cleanFolder/*\" OR asset_folder=\"$cleanFolder\" OR asset_folder=\"$cleanFolder/*\" OR public_id:$cleanFolder/* OR tags=\"$cleanFolder\""
                )
                put("max_results", 100)
            }
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(payload.toString())
                writer.flush()
            }
            if (conn.responseCode in 200..299) {
                val raw = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { it.readText() }
                writeDiskAndMemCache(context, "cloudinary", cacheKey, raw)
                raw
            } else {
                "{}"
            }
        } catch (_: Exception) {
            "{}"
        } finally {
            try { conn?.disconnect() } catch (_: Exception) {}
        }
    }
}
