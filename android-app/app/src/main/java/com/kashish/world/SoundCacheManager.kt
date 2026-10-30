package com.kashish.world

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Downloads, decodes, caches, and plays custom notification & overlay sounds.
 * Supports:
 * 1. Direct HTTP/HTTPS audio URLs (Preset chimes, Cloudinary CDN uploads, etc.)
 * 2. Base64 Data URLs (`data:audio/...;base64,...`) uploaded directly to Firestore
 * 3. Firestore Chunked Audio URLs (`firestore-chunked://chk_...`) for larger custom MP3/song clips
 *
 * Also registers a dedicated high-importance NotificationChannel per sound hash on Android O+.
 * When an overlay popup is dismissed or an action button is tapped, `stopActiveSound()` immediately stops playback.
 */
object SoundCacheManager {
    private const val TAG = "SoundCacheManager"
    private const val FIREBASE_PROJECT_ID = "kashishji"
    const val DEFAULT_CHANNEL_ID = "kashish_high_priority_default"
    const val PRIORITY_ALERT_CHANNEL_ID = "kashish_priority_alerts_v3"
    const val OVERLAY_CHANNEL_ID = "kashish_overlay_popup_silent_v2"
    const val MUSIC_CHANNEL_ID = "kashish_music_playback_v1"
    private const val LEGACY_RINGTONE_CHANNEL_ID = "kashish_urgent_overlay_channel"
    private const val LEGACY_BG_LISTENER_CHANNEL_ID = "kashish_bg_listener_channel"

    private var activePlayer: MediaPlayer? = null
    private val soundIoExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    fun ensureDefaultChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Delete legacy channels (including old permanent background notification channel)
        try {
            nm.cancel(7701)
            nm.deleteNotificationChannel(LEGACY_RINGTONE_CHANNEL_ID)
            nm.deleteNotificationChannel(LEGACY_BG_LISTENER_CHANNEL_ID)
        } catch (_: Exception) {}

        val defaultSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val audioAttr = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        val defaultChannel = NotificationChannel(
            DEFAULT_CHANNEL_ID,
            "Messages from Jay 💖",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "High priority notifications from Jay"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 220, 120, 220)
            setSound(defaultSound, audioAttr)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        }

        val priorityAlertChannel = NotificationChannel(
            PRIORITY_ALERT_CHANNEL_ID,
            "Instant Alerts from Jay 💖",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Instant heads-up notifications and notes from Jay"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 220, 120, 220)
            setSound(defaultSound, audioAttr)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        }

        // Silent high-importance channel for Truecaller-style Overlay Popups (custom sound plays via MediaPlayer)
        val overlayChannel = NotificationChannel(
            OVERLAY_CHANNEL_ID,
            "Love Popups 💖",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Truecaller-style screen popups without phone ringtone"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 180, 120, 260)
            setSound(null, null)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        }

        // Silent media playback channel for background music & lockscreen controls
        val musicChannel = NotificationChannel(
            MUSIC_CHANNEL_ID,
            "Kashish Music Player 🎵",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Background music playback & lock screen controls"
            enableVibration(false)
            setSound(null, null)
            setShowBadge(false)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        }

        nm.createNotificationChannel(defaultChannel)
        nm.createNotificationChannel(priorityAlertChannel)
        nm.createNotificationChannel(overlayChannel)
        nm.createNotificationChannel(musicChannel)
    }

    /**
     * Resolves and caches a sound URL (`https://...`, `data:audio/...;base64,...`, or `firestore-chunked://...`)
     * into `cacheDir/sounds/snd_<hash>.<ext>`.
     */
    fun getOrDownloadSoundFile(context: Context, soundUrl: String?): File? {
        if (soundUrl.isNullOrBlank() || soundUrl == "silent") {
            return null
        }
        return try {
            val dir = File(context.cacheDir, "sounds").apply { mkdirs() }
            val hash = sha256Short(soundUrl)

            // 1. Handle Base64 Data URL (`data:audio/mp3;base64,...`)
            if (soundUrl.startsWith("data:")) {
                val ext = when {
                    soundUrl.contains("audio/wav") -> "wav"
                    soundUrl.contains("audio/ogg") -> "ogg"
                    soundUrl.contains("audio/mp4") || soundUrl.contains("audio/m4a") || soundUrl.contains("audio/aac") -> "m4a"
                    soundUrl.contains("audio/webm") -> "webm"
                    else -> "mp3"
                }
                val targetFile = File(dir, "snd_${hash}.$ext")
                if (targetFile.exists() && targetFile.length() > 128) {
                    return targetFile
                }
                val base64Part = soundUrl.substringAfter("base64,", "")
                if (base64Part.isBlank()) return null
                val bytes = Base64.decode(base64Part, Base64.DEFAULT)
                FileOutputStream(targetFile).use { it.write(bytes) }
                return if (targetFile.exists() && targetFile.length() > 0) targetFile else null
            }

            // 2. Handle Firestore Chunked Audio URL (`firestore-chunked://chk_...`)
            if (soundUrl.startsWith("firestore-chunked://")) {
                val targetFile = File(dir, "snd_${hash}.mp3")
                if (targetFile.exists() && targetFile.length() > 256) {
                    return targetFile
                }
                val chunkGroupId = soundUrl.removePrefix("firestore-chunked://").trim()
                val reassembledDataUrl = fetchFirestoreChunkedDataUrl(context, chunkGroupId)
                if (reassembledDataUrl.isNullOrBlank()) return null
                val base64Part = reassembledDataUrl.substringAfter("base64,", reassembledDataUrl)
                val bytes = Base64.decode(base64Part, Base64.DEFAULT)
                FileOutputStream(targetFile).use { it.write(bytes) }
                return if (targetFile.exists() && targetFile.length() > 0) targetFile else null
            }

            // 3. Handle HTTP / HTTPS Audio URL
            if (!soundUrl.startsWith("http://") && !soundUrl.startsWith("https://")) {
                return null
            }
            val ext = soundUrl.substringAfterLast('.', "mp3").substringBefore('?').take(4).ifEmpty { "mp3" }
            val targetFile = File(dir, "snd_${hash}.$ext")

            if (targetFile.exists() && targetFile.length() > 256) {
                return targetFile
            }

            val conn = (URL(soundUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 10000
                instanceFollowRedirects = true
            }
            conn.inputStream.use { input ->
                FileOutputStream(targetFile).use { output ->
                    input.copyTo(output)
                }
            }
            if (targetFile.exists() && targetFile.length() > 0) targetFile else null
        } catch (e: Exception) {
            Log.w(TAG, "Failed to resolve custom sound: ${e.message}")
            null
        }
    }

    private fun fetchFirestoreChunkedDataUrl(
        context: Context,
        chunkGroupId: String,
        includeAuth: Boolean = true
    ): String? {
        if (chunkGroupId.isBlank()) return null
        var conn: HttpURLConnection? = null
        return try {
            val url = URL(
                "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents:runQuery"
            )
            val token = if (includeAuth) PermissionReporter.getSavedAuthToken(context) else ""
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 8000
                readTimeout = 10000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                if (token.isNotBlank()) {
                    setRequestProperty("Authorization", "Bearer $token")
                }
            }
            val queryJson = JSONObject().apply {
                put("structuredQuery", JSONObject().apply {
                    put("from", JSONArray().put(JSONObject().put("collectionId", "media")))
                    put("where", JSONObject().apply {
                        put("fieldFilter", JSONObject().apply {
                            put("field", JSONObject().put("fieldPath", "chunkGroupId"))
                            put("op", "EQUAL")
                            put("value", JSONObject().put("stringValue", chunkGroupId))
                        })
                    })
                })
            }
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(queryJson.toString())
                writer.flush()
            }
            val code = conn.responseCode
            if ((code == 401 || code == 403) && includeAuth && token.isNotBlank()) {
                conn.disconnect()
                return fetchFirestoreChunkedDataUrl(context, chunkGroupId, includeAuth = false)
            }
            if (code !in 200..299) return null
            val responseStr = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use {
                it.readText()
            }
            val arr = JSONArray(responseStr)
            val chunks = mutableListOf<Pair<Int, String>>()
            for (i in 0 until arr.length()) {
                val doc = arr.optJSONObject(i)?.optJSONObject("document") ?: continue
                val fields = doc.optJSONObject("fields") ?: continue
                val idxStr = fields.optJSONObject("chunkIndex")?.optString("integerValue", "0") ?: "0"
                val idx = idxStr.toIntOrNull() ?: 0
                val data = fields.optJSONObject("chunkData")?.optString("stringValue", "") ?: ""
                if (data.isNotEmpty()) {
                    chunks.add(idx to data)
                }
            }
            if (chunks.isEmpty()) return null
            chunks.sortBy { it.first }
            chunks.joinToString("") { it.second }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to fetch chunked sound: ${e.message}")
            null
        } finally {
            try {
                conn?.disconnect()
            } catch (_: Exception) {}
        }
    }

    /**
     * Asynchronously resolves/downloads `soundUrl` on a background thread and plays it.
     */
    fun playSoundUrlAsync(context: Context, soundUrl: String?, allowDefaultFallback: Boolean = false) {
        if (soundUrl.isNullOrBlank() || soundUrl == "silent") {
            if (allowDefaultFallback) {
                mainHandler.post { playCachedSound(context.applicationContext, null, allowDefaultFallback = true) }
            }
            return
        }
        val appCtx = context.applicationContext
        soundIoExecutor.execute {
            val cached = getOrDownloadSoundFile(appCtx, soundUrl)
            mainHandler.post {
                playCachedSound(appCtx, cached, allowDefaultFallback = allowDefaultFallback)
            }
        }
    }

    /**
     * Returns a verified high-importance NotificationChannel for notifications.
     * Custom audio is played directly via MediaPlayer (`playCachedSound`) so Android SystemUI never fails
     * on private FileProvider URIs.
     */
    fun getChannelForSound(context: Context, soundUrl: String?, cachedFile: File?): String {
        ensureDefaultChannels(context)
        if (soundUrl == "silent" || (cachedFile != null && cachedFile.exists())) {
            // Use silent high-importance channel when custom audio is played via MediaPlayer or silent is requested
            return OVERLAY_CHANNEL_ID
        }
        return PRIORITY_ALERT_CHANNEL_ID
    }

    /**
     * Plays the cached sound file directly via MediaPlayer on the main thread so custom per-notification /
     * per-overlay audio works reliably across all OEMs (Realme/ColorOS, Xiaomi, Oppo, Vivo, Samsung).
     */
    fun playCachedSound(context: Context, cachedFile: File?, allowDefaultFallback: Boolean = true) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            val appCtx = context.applicationContext
            mainHandler.post {
                playCachedSound(appCtx, cachedFile, allowDefaultFallback)
            }
            return
        }
        try {
            stopActiveSound()
            if (cachedFile == null || !cachedFile.exists()) {
                if (!allowDefaultFallback) return
            }
            val player = MediaPlayer()
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            player.setAudioAttributes(attrs)
            if (cachedFile != null && cachedFile.exists()) {
                player.setDataSource(cachedFile.absolutePath)
            } else {
                val fallbackUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                player.setDataSource(context, fallbackUri)
            }
            player.setOnCompletionListener { mp ->
                mp.release()
                if (activePlayer === mp) activePlayer = null
            }
            player.prepare()
            player.start()
            activePlayer = player
        } catch (e: Exception) {
            Log.w(TAG, "Direct sound playback error: ${e.message}")
        }
    }

    fun stopActiveSound() {
        try {
            activePlayer?.let {
                if (it.isPlaying) it.stop()
                it.release()
            }
        } catch (_: Exception) {
        } finally {
            activePlayer = null
        }
    }

    private fun sha256Short(input: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return digest.take(6).joinToString("") { "%02x".format(it) }
    }
}
