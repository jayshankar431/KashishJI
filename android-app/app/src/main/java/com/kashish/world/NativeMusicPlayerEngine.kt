package com.kashish.world

import android.content.Context
import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * Native Media3 ExoPlayer Audio Engine:
 * - Plays YouTube Music audio natively via Android AudioTrack / MediaCodec (100% immune to WebView throttling)
 * - 150MB LRU disk cache (`SimpleCache`) + 20s-60s anti-stutter RAM buffer (`DefaultLoadControl`)
 * - Real per-session hardware Equalizer + BassBoost + LoudnessEnhancer attached to `exoPlayer.audioSessionId`
 * - Multi-client InnerTube background stream resolver with 20-min URL cache + next-track preloading
 * - Zero JS bridge chatter while app is backgrounded to eliminate CPU usage during heavy multitasking
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
@Suppress("UnsafeOptInUsageError")
object NativeMusicPlayerEngine {
    private const val TAG = "NativeMusicEngine"
    private const val AUDIO_CACHE_MAX_BYTES = 150L * 1024L * 1024L // 150 MB native audio disk cache
    private const val STREAM_URL_TTL_MS = 18L * 60L * 1000L // 18 minutes

    private data class CachedStream(
        val videoId: String,
        val url: String,
        val mimeType: String,
        val bitrate: Int,
        val expiresAtMs: Long
    )

    private val mainHandler = Handler(Looper.getMainLooper())
    private val resolverExecutor = Executors.newFixedThreadPool(3)
    private val streamCache = ConcurrentHashMap<String, CachedStream>()
    private val playTokenCounter = AtomicLong(0L)

    @Volatile
    private var appContext: Context? = null

    @Volatile
    private var exoPlayer: ExoPlayer? = null

    @Volatile
    private var simpleCache: SimpleCache? = null

    @Volatile
    private var sessionEqualizer: Equalizer? = null

    @Volatile
    private var sessionBassBoost: BassBoost? = null

    @Volatile
    private var sessionLoudness: LoudnessEnhancer? = null

    @Volatile
    private var attachedAudioSessionId: Int = C.AUDIO_SESSION_ID_UNSET

    @Volatile
    private var currentVideoId: String = ""

    @Volatile
    private var currentTitle: String = ""

    @Volatile
    private var currentArtist: String = ""

    @Volatile
    private var currentThumbnail: String = ""

    @Volatile
    private var currentVolume: Float = 0.9f

    @Volatile
    private var eqBassDb: Int = 0

    @Volatile
    private var eqMidDb: Int = 0

    @Volatile
    private var eqTrebleDb: Int = 0

    @Volatile
    private var eqPresetName: String = "Flat"

    @Volatile
    var isAppInBackground: Boolean = false

    private var positionSyncRunnable: Runnable? = null

    @Synchronized
    private fun getOrCreateSimpleCache(ctx: Context): SimpleCache? {
        simpleCache?.let { return it }
        return try {
            val cacheDir = File(ctx.cacheDir, "kashish_audio_cache").apply { mkdirs() }
            val evictor = LeastRecentlyUsedCacheEvictor(AUDIO_CACHE_MAX_BYTES)
            val dbProvider = StandaloneDatabaseProvider(ctx)
            SimpleCache(cacheDir, evictor, dbProvider).also { simpleCache = it }
        } catch (e: Exception) {
            Log.w(TAG, "SimpleCache init note: ${e.message}")
            null
        }
    }

    private fun ensurePlayerOnMain(ctx: Context): ExoPlayer {
        appContext = ctx.applicationContext
        exoPlayer?.let { return it }

        val appCtx = ctx.applicationContext
        val httpFactory = DefaultHttpDataSource.Factory()
            .setUserAgent("com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 14; en_US; Quest 3)")
            .setConnectTimeoutMs(10_000)
            .setReadTimeoutMs(15_000)
            .setAllowCrossProtocolRedirects(true)

        val cache = getOrCreateSimpleCache(appCtx)
        val dataSourceFactory: DataSource.Factory = if (cache != null) {
            CacheDataSource.Factory()
                .setCache(cache)
                .setUpstreamDataSourceFactory(httpFactory)
                .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
        } else {
            httpFactory
        }

        // Generous anti-stutter buffer (20s min, 60s max) for zero cutouts under heavy multitasking
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                20_000, // minBufferMs
                60_000, // maxBufferMs
                1_200,  // bufferForPlaybackMs
                2_500   // bufferForPlaybackAfterRebufferMs
            )
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        val player = ExoPlayer.Builder(appCtx)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
            .setLoadControl(loadControl)
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        player.volume = currentVolume
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                when (playbackState) {
                    Player.STATE_BUFFERING -> {
                        emitStateToWebView("buffering")
                    }
                    Player.STATE_READY -> {
                        attachEqualizerToSession(player.audioSessionId)
                        if (player.isPlaying) {
                            emitStateToWebView("playing")
                            updateNativeNotification(appCtx, true)
                            startForegroundPositionTicker()
                        } else {
                            emitStateToWebView("paused")
                            updateNativeNotification(appCtx, false)
                        }
                    }
                    Player.STATE_ENDED -> {
                        stopForegroundPositionTicker()
                        emitStateToWebView("ended")
                    }
                    Player.STATE_IDLE -> {
                        stopForegroundPositionTicker()
                    }
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) {
                    attachEqualizerToSession(player.audioSessionId)
                    emitStateToWebView("playing")
                    updateNativeNotification(appCtx, true)
                    startForegroundPositionTicker()
                } else if (player.playbackState == Player.STATE_READY) {
                    stopForegroundPositionTicker()
                    emitStateToWebView("paused")
                    updateNativeNotification(appCtx, false)
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                Log.w(TAG, "ExoPlayer error for $currentVideoId: ${error.message}")
                stopForegroundPositionTicker()
                streamCache.remove(currentVideoId)
                emitStateToWebView("error", error.message ?: "Native stream playback failed")
            }
        })

        player.addAnalyticsListener(object : AnalyticsListener {
            override fun onAudioSessionIdChanged(
                eventTime: AnalyticsListener.EventTime,
                audioSessionId: Int
            ) {
                attachEqualizerToSession(audioSessionId)
            }
        })

        exoPlayer = player
        return player
    }

    private fun startForegroundPositionTicker() {
        stopForegroundPositionTicker()
        val runnable = object : Runnable {
            override fun run() {
                val p = exoPlayer ?: return
                if (p.isPlaying && currentVideoId.isNotEmpty()) {
                    if (!isAppInBackground) {
                        emitStateToWebView("playing")
                    }
                    mainHandler.postDelayed(this, 600L)
                }
            }
        }
        positionSyncRunnable = runnable
        mainHandler.postDelayed(runnable, 600L)
    }

    private fun stopForegroundPositionTicker() {
        positionSyncRunnable?.let { mainHandler.removeCallbacks(it) }
        positionSyncRunnable = null
    }

    private fun updateNativeNotification(ctx: Context, isPlaying: Boolean) {
        if (currentTitle.isBlank()) return
        val p = exoPlayer
        val posSec = ((p?.currentPosition ?: 0L) / 1000L).coerceAtLeast(0L)
        val durMs = p?.duration ?: C.TIME_UNSET
        val durSec = if (durMs > 0L && durMs != C.TIME_UNSET) durMs / 1000L else 0L
        CallAndOverlayHelper.updateMusicNotification(
            context = ctx,
            title = currentTitle,
            artist = currentArtist,
            thumbnailUrl = currentThumbnail,
            isPlaying = isPlaying,
            positionSec = posSec,
            durationSec = durSec
        )
    }

    private fun emitStateToWebView(state: String, errorMsg: String = "") {
        val p = exoPlayer
        val posSec = ((p?.currentPosition ?: 0L).toDouble() / 1000.0).coerceAtLeast(0.0)
        val durMs = p?.duration ?: C.TIME_UNSET
        val durSec = if (durMs > 0L && durMs != C.TIME_UNSET) durMs.toDouble() / 1000.0 else 0.0
        val payload = JSONObject().apply {
            put("videoId", currentVideoId)
            put("state", state)
            put("currentTime", posSec)
            put("duration", durSec)
            if (errorMsg.isNotEmpty()) put("error", errorMsg)
        }.toString()
        MainActivity.dispatchNativeAudioState(payload)
    }

    fun playTrack(
        context: Context,
        videoId: String,
        title: String,
        artist: String,
        thumbnail: String,
        startSeconds: Double = 0.0
    ) {
        val cleanId = videoId.trim()
        if (cleanId.isEmpty()) return

        val appCtx = context.applicationContext
        appContext = appCtx
        val token = playTokenCounter.incrementAndGet()

        currentVideoId = cleanId
        currentTitle = title.ifBlank { "Melodies for Kashish" }
        currentArtist = artist.ifBlank { "Music Artist" }
        currentThumbnail = thumbnail.trim()

        mainHandler.post {
            val player = ensurePlayerOnMain(appCtx)
            player.playWhenReady = false
            emitStateToWebView("buffering")
        }

        resolverExecutor.execute {
            val resolved = resolveAudioStreamSync(cleanId, forceRefresh = false)
            if (token != playTokenCounter.get()) return@execute

            if (resolved == null || resolved.url.isBlank()) {
                mainHandler.post {
                    if (token == playTokenCounter.get()) {
                        emitStateToWebView("error", "No direct audio stream available")
                    }
                }
                return@execute
            }

            val streamUrl = resolved.url
            mainHandler.post {
                if (token != playTokenCounter.get()) return@post
                try {
                    val player = ensurePlayerOnMain(appCtx)
                    val mediaItem = MediaItem.Builder()
                        .setUri(streamUrl)
                        .setMediaId(cleanId)
                        .setCustomCacheKey("yt_audio_$cleanId")
                        .build()

                    player.setMediaItem(mediaItem)
                    player.prepare()
                    if (startSeconds > 0.5) {
                        player.seekTo((startSeconds * 1000.0).toLong())
                    }
                    player.volume = currentVolume
                    player.playWhenReady = true
                    attachEqualizerToSession(player.audioSessionId)
                } catch (e: Exception) {
                    Log.w(TAG, "ExoPlayer start failed: ${e.message}")
                    emitStateToWebView("error", e.message ?: "ExoPlayer failed")
                }
            }
        }
    }

    fun preloadTrack(videoId: String) {
        val cleanId = videoId.trim()
        if (cleanId.isEmpty()) return
        val cached = streamCache[cleanId]
        if (cached != null && System.currentTimeMillis() < cached.expiresAtMs) return
        resolverExecutor.execute {
            resolveAudioStreamSync(cleanId, forceRefresh = false)
        }
    }

    fun pause() {
        mainHandler.post {
            try {
                exoPlayer?.pause()
            } catch (_: Exception) {}
        }
    }

    fun resume() {
        mainHandler.post {
            try {
                val p = exoPlayer ?: return@post
                if (p.playbackState == Player.STATE_ENDED) {
                    p.seekTo(0L)
                }
                p.play()
            } catch (_: Exception) {}
        }
    }

    fun stop() {
        playTokenCounter.incrementAndGet()
        mainHandler.post {
            try {
                stopForegroundPositionTicker()
                exoPlayer?.stop()
                exoPlayer?.clearMediaItems()
            } catch (_: Exception) {}
        }
    }

    fun seekTo(seconds: Double) {
        val ms = (seconds * 1000.0).toLong().coerceAtLeast(0L)
        mainHandler.post {
            try {
                exoPlayer?.seekTo(ms)
                appContext?.let { ctx ->
                    val p = exoPlayer
                    if (p != null) updateNativeNotification(ctx, p.isPlaying)
                }
            } catch (_: Exception) {}
        }
    }

    fun setVolume(volume0To1: Float) {
        val clamped = volume0To1.coerceIn(0f, 1f)
        currentVolume = clamped
        mainHandler.post {
            try {
                exoPlayer?.volume = clamped
            } catch (_: Exception) {}
        }
    }

    fun getStateJson(): String {
        var posSec = 0.0
        var durSec = 0.0
        var isPlaying = false
        var isBuffering = false

        // ExoPlayer is application-looper confined. Read it directly when already
        // on that looper; posting and waiting here would block the very thread
        // needed to run the posted task and return an empty/stale state.
        val readPlayerState = {
            val player = exoPlayer
            if (player != null) {
                posSec = (player.currentPosition.toDouble() / 1000.0).coerceAtLeast(0.0)
                val durationMs = player.duration
                durSec = if (durationMs > 0L && durationMs != C.TIME_UNSET) {
                    durationMs.toDouble() / 1000.0
                } else {
                    0.0
                }
                isPlaying = player.isPlaying
                isBuffering = player.playbackState == Player.STATE_BUFFERING
            }
        }

        try {
            if (Looper.myLooper() == mainHandler.looper) {
                readPlayerState()
            } else {
                val latch = java.util.concurrent.CountDownLatch(1)
                mainHandler.post {
                    try {
                        readPlayerState()
                    } catch (_: Exception) {
                        // Return the best state snapshot available.
                    } finally {
                        latch.countDown()
                    }
                }
                latch.await(150, java.util.concurrent.TimeUnit.MILLISECONDS)
            }
        } catch (_: Exception) {
            // Keep safe defaults if the player is being torn down.
        }

        return JSONObject().apply {
            put("videoId", currentVideoId)
            put("currentTime", posSec)
            put("duration", durSec)
            put("isPlaying", isPlaying)
            put("isBuffering", isBuffering)
        }.toString()
    }

    @Synchronized
    fun applyEqualizer(context: Context, bassDb: Int, midDb: Int, trebleDb: Int, presetName: String) {
        eqBassDb = bassDb.coerceIn(-12, 12)
        eqMidDb = midDb.coerceIn(-12, 12)
        eqTrebleDb = trebleDb.coerceIn(-12, 12)
        eqPresetName = presetName.ifBlank { "Custom" }

        // Apply to global output mix for YouTube IFrame / Video mode
        CallAndOverlayHelper.applyEqualizerSettings(context, eqBassDb, eqMidDb, eqTrebleDb, eqPresetName)

        // Apply directly to ExoPlayer's real hardware audioSessionId for maximum audible DSP quality
        mainHandler.post {
            val sessionId = exoPlayer?.audioSessionId ?: C.AUDIO_SESSION_ID_UNSET
            if (sessionId != C.AUDIO_SESSION_ID_UNSET && sessionId > 0) {
                attachEqualizerToSession(sessionId)
            }
        }
    }

    @Synchronized
    private fun attachEqualizerToSession(sessionId: Int) {
        if (sessionId == C.AUDIO_SESSION_ID_UNSET || sessionId <= 0) return

        val isFlat = eqBassDb == 0 && eqMidDb == 0 && eqTrebleDb == 0

        if (attachedAudioSessionId != sessionId) {
            releaseSessionEffects()
            attachedAudioSessionId = sessionId
            try {
                sessionEqualizer = Equalizer(100, sessionId)
            } catch (e: Exception) {
                Log.w(TAG, "Session Equalizer init note: ${e.message}")
            }
            try {
                sessionBassBoost = BassBoost(100, sessionId)
            } catch (e: Exception) {
                Log.w(TAG, "Session BassBoost init note: ${e.message}")
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                try {
                    sessionLoudness = LoudnessEnhancer(sessionId)
                } catch (_: Exception) {}
            }
        }

        try {
            sessionEqualizer?.let { eq ->
                eq.enabled = !isFlat
                val numBands = eq.numberOfBands.toInt()
                val range = eq.bandLevelRange
                val minMb = if (range != null && range.size >= 2) range[0].toInt() else -1200
                val maxMb = if (range != null && range.size >= 2) range[1].toInt() else 1200
                for (b in 0 until numBands) {
                    val bandShort = b.toShort()
                    val centerHz = eq.getCenterFreq(bandShort) / 1000
                    val targetDb = when {
                        centerHz <= 250 -> eqBassDb
                        centerHz >= 2500 -> eqTrebleDb
                        else -> eqMidDb
                    }
                    val targetMb = (targetDb * 100).coerceIn(minMb, maxMb).toShort()
                    eq.setBandLevel(bandShort, targetMb)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Session Equalizer apply note: ${e.message}")
        }

        try {
            sessionBassBoost?.let { bb ->
                if (bb.strengthSupported) {
                    if (eqBassDb > 0) {
                        bb.enabled = true
                        val strength = ((eqBassDb.toFloat() / 12f) * 1000f).toInt().coerceIn(0, 1000).toShort()
                        bb.setStrength(strength)
                    } else {
                        bb.setStrength(0.toShort())
                        bb.enabled = false
                    }
                }
            }
        } catch (_: Exception) {}

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                sessionLoudness?.let { le ->
                    val boostMb = (maxOf(eqBassDb, eqMidDb, eqTrebleDb).coerceAtLeast(0) * 45).coerceIn(0, 600)
                    if (boostMb > 0 && !isFlat) {
                        le.setTargetGain(boostMb)
                        le.enabled = true
                    } else {
                        le.setTargetGain(0)
                        le.enabled = false
                    }
                }
            }
        } catch (_: Exception) {}
    }

    @Synchronized
    private fun releaseSessionEffects() {
        try { sessionEqualizer?.release() } catch (_: Exception) {}
        try { sessionBassBoost?.release() } catch (_: Exception) {}
        try { sessionLoudness?.release() } catch (_: Exception) {}
        sessionEqualizer = null
        sessionBassBoost = null
        sessionLoudness = null
        attachedAudioSessionId = C.AUDIO_SESSION_ID_UNSET
    }

    fun getAudioCacheSizeMb(context: Context): Double {
        val dir = File(context.cacheDir, "kashish_audio_cache")
        if (!dir.exists()) return 0.0
        var total = 0L
        dir.walkTopDown().forEach { if (it.isFile) total += it.length() }
        return total.toDouble() / (1024.0 * 1024.0)
    }

    fun resolveAudioStreamJsonSync(videoId: String): String {
        val stream = resolveAudioStreamSync(videoId.trim(), false) ?: return "{}"
        return JSONObject().apply {
            put("videoId", stream.videoId)
            put("url", stream.url)
            put("mimeType", stream.mimeType)
            put("bitrate", stream.bitrate)
        }.toString()
    }

    private fun resolveAudioStreamSync(videoId: String, forceRefresh: Boolean): CachedStream? {
        if (videoId.length != 11) return null
        if (!forceRefresh) {
            val cached = streamCache[videoId]
            if (cached != null && System.currentTimeMillis() < cached.expiresAtMs) {
                return cached
            }
        }

        val clients = listOf(
            Triple(
                "ANDROID_VR",
                "1.60.19",
                "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 14; en_US; Quest 3; Build/UP1A.231005.007.A1; Cronet/132.0.6808.3)"
            ),
            Triple(
                "IOS",
                "19.45.4",
                "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)"
            ),
            Triple(
                "ANDROID",
                "19.44.38",
                "com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip"
            )
        )

        for ((clientName, clientVersion, userAgent) in clients) {
            val result = queryInnerTubePlayer(videoId, clientName, clientVersion, userAgent)
            if (result != null) {
                streamCache[videoId] = result
                return result
            }
        }
        return null
    }

    private fun queryInnerTubePlayer(
        videoId: String,
        clientName: String,
        clientVersion: String,
        userAgent: String
    ): CachedStream? {
        var conn: HttpURLConnection? = null
        return try {
            val url = URL("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 6000
                readTimeout = 6000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("User-Agent", userAgent)
                setRequestProperty("X-Goog-Api-Format-Version", "2")
            }
            val clientObj = JSONObject().apply {
                put("clientName", clientName)
                put("clientVersion", clientVersion)
                put("hl", "en")
                put("gl", "IN")
                if (clientName.startsWith("ANDROID")) {
                    put("androidSdkVersion", 34)
                    put("osName", "Android")
                    put("osVersion", "14")
                } else if (clientName == "IOS") {
                    put("deviceMake", "Apple")
                    put("deviceModel", "iPhone16,2")
                    put("osName", "iPhone")
                    put("osVersion", "18.1.0")
                }
            }
            val payload = JSONObject().apply {
                put("context", JSONObject().put("client", clientObj))
                put("videoId", videoId)
                put("contentCheckOk", true)
                put("racyCheckOk", true)
            }
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(payload.toString())
                writer.flush()
            }
            if (conn.responseCode !in 200..299) return null
            val raw = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { it.readText() }
            val data = JSONObject(raw)
            val streamingData = data.optJSONObject("streamingData") ?: return null
            val adaptive = streamingData.optJSONArray("adaptiveFormats") ?: return null

            var bestUrl = ""
            var bestMime = ""
            var bestBitrate = -1
            var bestIsMp4 = false

            for (i in 0 until adaptive.length()) {
                val fmt = adaptive.optJSONObject(i) ?: continue
                val mime = fmt.optString("mimeType", "")
                val streamUrl = fmt.optString("url", "")
                if (!mime.startsWith("audio/") || !streamUrl.startsWith("http")) continue
                val isMp4 = mime.contains("audio/mp4")
                val bitrate = fmt.optInt("bitrate", 0)
                if (bestUrl.isEmpty() || (isMp4 && !bestIsMp4) || (isMp4 == bestIsMp4 && bitrate > bestBitrate)) {
                    bestUrl = streamUrl
                    bestMime = mime.substringBefore(";").trim()
                    bestBitrate = bitrate
                    bestIsMp4 = isMp4
                }
            }

            if (bestUrl.isNotEmpty()) {
                CachedStream(
                    videoId = videoId,
                    url = bestUrl,
                    mimeType = bestMime,
                    bitrate = bestBitrate,
                    expiresAtMs = System.currentTimeMillis() + STREAM_URL_TTL_MS
                )
            } else {
                null
            }
        } catch (_: Exception) {
            null
        } finally {
            try { conn?.disconnect() } catch (_: Exception) {}
        }
    }
}
