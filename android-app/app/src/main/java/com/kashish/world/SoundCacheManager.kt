package com.kashish.world

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Downloads, caches, and plays custom notification sounds per notification.
 * Also registers a dedicated high-importance NotificationChannel per sound hash on Android O+.
 * Note: The Overlay Popup channel is explicitly configured WITHOUT any phone ringtone
 * so Truecaller-style popups wake the screen silently with a gentle heartbeat vibration.
 */
object SoundCacheManager {
    private const val TAG = "SoundCacheManager"
    const val DEFAULT_CHANNEL_ID = "kashish_high_priority_default"
    const val OVERLAY_CHANNEL_ID = "kashish_overlay_popup_silent_v2"
    private const val LEGACY_RINGTONE_CHANNEL_ID = "kashish_urgent_overlay_channel"

    private var activePlayer: MediaPlayer? = null

    fun ensureDefaultChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Delete legacy channel that previously had TYPE_RINGTONE attached
        try {
            nm.deleteNotificationChannel(LEGACY_RINGTONE_CHANNEL_ID)
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

        // Silent high-importance channel for Truecaller-style Overlay Popups (never plays phone ringtone!)
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

        nm.createNotificationChannel(defaultChannel)
        nm.createNotificationChannel(overlayChannel)
    }

    /**
     * Downloads a remote sound URL into cacheDir/sounds if not already cached.
     */
    fun getOrDownloadSoundFile(context: Context, soundUrl: String?): File? {
        if (soundUrl.isNullOrBlank() || (!soundUrl.startsWith("http://") && !soundUrl.startsWith("https://"))) {
            return null
        }
        return try {
            val dir = File(context.cacheDir, "sounds").apply { mkdirs() }
            val hash = sha256Short(soundUrl)
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
            Log.w(TAG, "Failed to download custom sound: ${e.message}")
            null
        }
    }

    /**
     * Returns or creates a high-importance NotificationChannel for a specific cached sound file.
     */
    fun getChannelForSound(context: Context, soundUrl: String?, cachedFile: File?): String {
        ensureDefaultChannels(context)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || soundUrl.isNullOrBlank() || cachedFile == null) {
            return DEFAULT_CHANNEL_ID
        }
        return try {
            val hash = sha256Short(soundUrl)
            val channelId = "kashish_snd_$hash"
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(channelId) != null) {
                return channelId
            }

            val soundUri: Uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.provider",
                cachedFile
            )
            val audioAttr = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

            val ch = NotificationChannel(
                channelId,
                "Jay Custom Alert ($hash)",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Custom notification tone from Jay"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 220, 120, 220)
                setSound(soundUri, audioAttr)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }
            nm.createNotificationChannel(ch)
            channelId
        } catch (e: Exception) {
            Log.w(TAG, "Channel creation fallback: ${e.message}")
            DEFAULT_CHANNEL_ID
        }
    }

    /**
     * Plays the cached sound file directly via MediaPlayer so custom per-notification audio
     * works reliably across all OEMs (Realme/ColorOS, Xiaomi, Oppo, Vivo) even when channel sounds are restricted.
     */
    fun playCachedSound(context: Context, cachedFile: File?) {
        try {
            stopActiveSound()
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
