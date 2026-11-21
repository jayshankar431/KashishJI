package com.kashish.world

import android.Manifest
import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.telecom.TelecomManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

data class OverlayButtonSpec(
    val label: String,
    val action: String, // "call_now" | "dismiss" | "call_later" | "open_url" | "open_section"
    val payload: String = ""
)

object CallAndOverlayHelper {
    private const val TAG = "CallAndOverlayHelper"
    const val URGENT_NOTIFICATION_ID = 9001
    const val DEFAULT_CALL_NUMBER = "9817905531"
    private const val PREFS_NAME = "kashish_app_prefs"
    private const val KEY_CACHED_PHONE = "cached_call_phone"

    @Volatile
    private var pendingDirectCallNumber: String? = null

    @Volatile
    private var activeScreenWakeLock: PowerManager.WakeLock? = null

    fun saveCachedPhoneNumber(context: Context, phoneNumber: String?) {
        val cleaned = phoneNumber?.trim() ?: return
        if (cleaned.isNotEmpty()) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_CACHED_PHONE, cleaned)
                .apply()
        }
    }

    fun getCachedPhoneNumber(context: Context): String {
        val saved = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_CACHED_PHONE, "")?.trim() ?: ""
        return saved.ifEmpty { DEFAULT_CALL_NUMBER }
    }

    fun consumePendingDirectCall(context: Context) {
        val pending = pendingDirectCallNumber ?: return
        pendingDirectCallNumber = null
        placeDirectCall(context, pending)
    }

    /**
     * Wakes up the physical screen immediately using WakeLock (ACQUIRE_CAUSES_WAKEUP)
     * so if the phone is locked or sitting with the display off, the screen lights up right away.
     */
    @Suppress("DEPRECATION")
    fun wakeUpScreenImmediately(context: Context, durationMs: Long = 15_000L) {
        try {
            val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
            try {
                if (activeScreenWakeLock?.isHeld == true) {
                    activeScreenWakeLock?.release()
                }
            } catch (_: Exception) {}

            val wl = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                    PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    PowerManager.ON_AFTER_RELEASE,
                "kashish:truecaller_screen_wakeup"
            )
            wl.setReferenceCounted(false)
            wl.acquire(durationMs)
            activeScreenWakeLock = wl
        } catch (e: Exception) {
            Log.w(TAG, "WakeLock screen wakeup note: ${e.message}")
        }
    }

    fun vibrateHeartbeat(context: Context) {
        try {
            val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vm.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            val pattern = longArrayOf(0, 180, 120, 260)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(pattern, -1)
            }
        } catch (_: Exception) {}
    }

    @Volatile
    private var lastDispatchedOverlayDocId: String = ""

    @Volatile
    private var lastDispatchedNotifDocId: String = ""

    /**
     * Unified Truecaller-Style Overlay Trigger:
     * 1. Lights up the screen via WakeLock (PowerManager.ACQUIRE_CAUSES_WAKEUP).
     * 2. Vibrates with a romantic heartbeat (NO phone call ringtone!).
     * 3. If SYSTEM_ALERT_WINDOW ("Display over other apps") is granted, draws the romantic popup card
     *    directly over Instagram, WhatsApp, or the Lock Screen via UrgentOverlayWindowService.
     * 4. Only falls back to UrgentOverlayFallbackActivity if SYSTEM_ALERT_WINDOW is not granted,
     *    preventing double popups.
     */
    @Synchronized
    fun triggerTruecallerOverlay(
        context: Context,
        overlayDocId: String = "",
        title: String,
        message: String,
        imageUrl: String = "",
        theme: String = "velvet-rose",
        fontStyle: String = "romantic-serif",
        soundUrl: String = "",
        buttonItemsJson: String = "",
        buttonsJson: String = "",
        phoneNumber: String = "",
        channelId: String? = null
    ) {
        val appCtx = context.applicationContext
        if (overlayDocId.isNotBlank()) {
            if (lastDispatchedOverlayDocId == overlayDocId) {
                return
            }
            lastDispatchedOverlayDocId = overlayDocId
            FirestoreOverlayBackgroundService.markOverlaySeenLocally(appCtx, overlayDocId)
        }
        if (phoneNumber.isNotBlank()) {
            saveCachedPhoneNumber(appCtx, phoneNumber)
        }

        // 1. Turn the screen ON immediately via WakeLock + gentle heartbeat vibration + optional custom sound
        wakeUpScreenImmediately(appCtx, 18_000L)
        vibrateHeartbeat(appCtx)

        if (soundUrl.isNotBlank() && soundUrl != "silent") {
            SoundCacheManager.playSoundUrlAsync(appCtx, soundUrl, allowDefaultFallback = false)
        }

        SoundCacheManager.ensureDefaultChannels(appCtx)
        val resolvedChannelId = channelId ?: SoundCacheManager.OVERLAY_CHANNEL_ID
        val notificationId = URGENT_NOTIFICATION_ID

        val canDraw = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(appCtx)

        // 2. Launch SYSTEM_ALERT_WINDOW service over other apps (Instagram/WhatsApp/LockScreen)
        if (canDraw) {
            // Ensure no fallback activity is open behind the system overlay window
            UrgentOverlayFallbackActivity.finishActiveInstance()
            try {
                val serviceIntent = Intent(appCtx, UrgentOverlayWindowService::class.java).apply {
                    putExtra("overlayDocId", overlayDocId)
                    putExtra("title", title)
                    putExtra("message", message)
                    putExtra("imageUrl", imageUrl)
                    putExtra("theme", theme)
                    putExtra("popupColor", theme)
                    putExtra("fontStyle", fontStyle)
                    putExtra("phoneNumber", phoneNumber.ifBlank { getCachedPhoneNumber(appCtx) })
                    putExtra("buttonItems", buttonItemsJson)
                    putExtra("buttons", buttonsJson)
                    putExtra("notificationId", notificationId)
                }
                appCtx.startService(serviceIntent)
                return
            } catch (e: Exception) {
                Log.w(TAG, "Failed to start UrgentOverlayWindowService: ${e.message}")
            }
        }

        // 3. Fallback ONLY when SYSTEM_ALERT_WINDOW permission is not granted
        val fallbackIntent = Intent(appCtx, UrgentOverlayFallbackActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
            putExtra("overlayDocId", overlayDocId)
            putExtra("title", title)
            putExtra("message", message)
            putExtra("imageUrl", imageUrl)
            putExtra("theme", theme)
            putExtra("popupColor", theme)
            putExtra("fontStyle", fontStyle)
            putExtra("phoneNumber", phoneNumber.ifBlank { getCachedPhoneNumber(appCtx) })
            putExtra("buttonItems", buttonItemsJson)
            putExtra("buttons", buttonsJson)
            putExtra("notificationId", notificationId)
        }

        try {
            appCtx.startActivity(fallbackIntent)
        } catch (_: Exception) {}

        // Only post a status-bar notification if SYSTEM_ALERT_WINDOW (canDraw) is NOT granted.
        // When canDraw is true, the Truecaller-style popup card is already displayed directly on screen
        // without cluttering the notification shade.
        if (!canDraw) {
            val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

            val fullScreenPendingIntent = PendingIntent.getActivity(
                appCtx,
                9100,
                fallbackIntent,
                pendingFlags
            )

            val largeIcon = loadNotificationAvatarBitmap(appCtx, imageUrl)

            val builder = NotificationCompat.Builder(appCtx, resolvedChannelId)
                .setSmallIcon(R.drawable.ic_stat_heart)
                .setLargeIcon(largeIcon)
                .setSubText("Kashishhh 💖")
                .setColor(0xFFE11D48.toInt())
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_SYSTEM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setSilent(true)
                .setSound(null)
                .setAutoCancel(true)
                .setContentIntent(fullScreenPendingIntent)
                .setFullScreenIntent(fullScreenPendingIntent, true)

            if (largeIcon != null) {
                try {
                    val sender = Person.Builder()
                        .setName(title.ifBlank { "Kashishhh 💖" })
                        .setIcon(IconCompat.createWithBitmap(largeIcon))
                        .build()
                    val msgStyle = NotificationCompat.MessagingStyle(sender)
                        .addMessage(message, System.currentTimeMillis(), sender)
                    builder.setStyle(msgStyle)
                } catch (_: Exception) {}
            }

            val buttons = parseButtonSpecs(buttonItemsJson, buttonsJson, includeFallbackDefaults = true)
            buttons.take(3).forEachIndexed { index, spec ->
                val actionIntent = Intent(appCtx, NotificationActionReceiver::class.java).apply {
                    action = "com.kashish.world.NOTIF_ACTION_$index"
                    putExtra("overlay_doc_id", overlayDocId)
                    putExtra("button_label", spec.label)
                    putExtra("button_action", spec.action)
                    putExtra("button_payload", spec.payload)
                    putExtra("phone_number", phoneNumber)
                    putExtra("notification_id", notificationId)
                }
                val actionPendingIntent = PendingIntent.getBroadcast(
                    appCtx,
                    9200 + index,
                    actionIntent,
                    pendingFlags
                )
                builder.addAction(0, spec.label, actionPendingIntent)
            }

            val nm = appCtx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(notificationId, builder.build())
        }
    }

    /**
     * Loads the circular Kashishhh notification avatar bitmap (or custom imageUrl cropped to a circle),
     * falling back through R.drawable.ic_notification_large -> R.mipmap.ic_launcher_round -> R.mipmap.ic_launcher.
     */
    fun loadNotificationAvatarBitmap(context: Context, imageUrl: String = ""): Bitmap? {
        if (imageUrl.isNotBlank() && (imageUrl.startsWith("http://") || imageUrl.startsWith("https://"))) {
            try {
                val conn = (URL(imageUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 4500
                    readTimeout = 4500
                }
                val downloaded = conn.inputStream.use { BitmapFactory.decodeStream(it) }
                if (downloaded != null) {
                    return cropCircularBitmap(downloaded)
                }
            } catch (_: Exception) {}
        }

        val res = context.resources
        val fallbackIds = intArrayOf(
            R.drawable.ic_notification_large,
            R.mipmap.ic_launcher_round,
            R.mipmap.ic_launcher
        )
        for (resId in fallbackIds) {
            try {
                val bmp = BitmapFactory.decodeResource(res, resId)
                if (bmp != null) return bmp
            } catch (_: Exception) {}
        }
        return null
    }

    private fun cropCircularBitmap(src: Bitmap): Bitmap {
        val size = minOf(src.width, src.height).coerceAtLeast(1)
        val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val rect = Rect(0, 0, size, size)
        val radius = size / 2f
        canvas.drawARGB(0, 0, 0, 0)
        canvas.drawCircle(radius, radius, radius, paint)
        paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
        val left = (src.width - size) / 2
        val top = (src.height - size) / 2
        val srcRect = Rect(left, top, left + size, top + size)
        canvas.drawBitmap(src, srcRect, rect, paint)
        return output
    }

    /**
     * Dispatches a high-priority banner notification with full-color circular Kashishhh icon
     * (via both setLargeIcon and MessagingStyle Person icon so it appears on the left across
     * Android 10–15, Xiaomi HyperOS/MIUI, Samsung OneUI, Oppo/Realme ColorOS, and Vivo)
     * plus optional configurable Action Buttons.
     */
    @Synchronized
    fun showHighPriorityBannerNotification(
        context: Context,
        title: String,
        message: String,
        channelId: String = SoundCacheManager.PRIORITY_ALERT_CHANNEL_ID,
        notifDocId: String = "",
        buttonItemsJson: String = "",
        phoneNumber: String = "",
        imageUrl: String = ""
    ) {
        val appCtx = context.applicationContext
        if (notifDocId.isNotBlank()) {
            if (lastDispatchedNotifDocId == notifDocId) {
                return
            }
            lastDispatchedNotifDocId = notifDocId
            FirestoreOverlayBackgroundService.markNotificationSeenLocally(appCtx, notifDocId)
        }
        vibrateHeartbeat(appCtx)
        SoundCacheManager.ensureDefaultChannels(appCtx)

        val buildAndPost = { largeIcon: Bitmap? ->
            val notificationId = if (notifDocId.isNotBlank()) {
                (notifDocId.hashCode() and 0x7FFFFFFF) % 80000 + 10000
            } else {
                (System.currentTimeMillis() % 80000).toInt() + 10000
            }
            val openAppIntent = Intent(appCtx, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
            val contentIntent = PendingIntent.getActivity(appCtx, notificationId, openAppIntent, pendingFlags)

            val builder = NotificationCompat.Builder(appCtx, channelId)
                .setSmallIcon(R.drawable.ic_stat_heart)
                .setLargeIcon(largeIcon)
                .setSubText("Kashishhh 💖")
                .setColor(0xFFE11D48.toInt())
                .setContentTitle(title.ifBlank { "Message from Jay 💖" })
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_VIBRATE or NotificationCompat.DEFAULT_LIGHTS)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(contentIntent)

            if (largeIcon != null) {
                try {
                    val sender = Person.Builder()
                        .setName(title.ifBlank { "Kashishhh 💖" })
                        .setIcon(IconCompat.createWithBitmap(largeIcon))
                        .build()
                    val msgStyle = NotificationCompat.MessagingStyle(sender)
                        .addMessage(message, System.currentTimeMillis(), sender)
                    builder.setStyle(msgStyle)
                } catch (_: Exception) {}
            }

            // Attach up to 3 custom action buttons if configured in Admin Notification Sender
            val buttons = parseButtonSpecs(buttonItemsJson, null, includeFallbackDefaults = false)
            buttons.take(3).forEachIndexed { index, spec ->
                val actionIntent = Intent(appCtx, NotificationActionReceiver::class.java).apply {
                    action = "com.kashish.world.BANNER_NOTIF_ACTION_${notificationId}_$index"
                    putExtra("notif_doc_id", notifDocId)
                    putExtra("button_label", spec.label)
                    putExtra("button_action", spec.action)
                    putExtra("button_payload", spec.payload)
                    putExtra("phone_number", phoneNumber.ifBlank { getCachedPhoneNumber(appCtx) })
                    putExtra("notification_id", notificationId)
                }
                val actionPendingIntent = PendingIntent.getBroadcast(
                    appCtx,
                    (notificationId % 5000) + 3000 + index,
                    actionIntent,
                    pendingFlags
                )
                builder.addAction(0, spec.label, actionPendingIntent)
            }

            val nm = appCtx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(notificationId, builder.build())
        }

        val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
        if (imageUrl.isNotBlank() && (imageUrl.startsWith("http://") || imageUrl.startsWith("https://"))) {
            Executors.newSingleThreadExecutor().execute {
                val bmp = loadNotificationAvatarBitmap(appCtx, imageUrl)
                mainHandler.post { buildAndPost(bmp) }
            }
        } else {
            val bmp = loadNotificationAvatarBitmap(appCtx, "")
            if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
                buildAndPost(bmp)
            } else {
                mainHandler.post { buildAndPost(bmp) }
            }
        }
    }

    /**
     * Places the call directly without showing the dialer screen when CALL_PHONE permission is granted.
     * Uses Intent.ACTION_CALL first (direct call on all Android OEMs), then TelecomManager.placeCall.
     */
    @SuppressLint("MissingPermission")
    fun placeDirectCall(context: Context, rawPhone: String?) {
        val cleaned = rawPhone?.replace(Regex("[^\\d+]"), "") ?: ""
        val phone = cleaned.ifEmpty { getCachedPhoneNumber(context) }.ifEmpty { DEFAULT_CALL_NUMBER }

        dismissPopupAndNotification(context)

        val uri = Uri.fromParts("tel", phone, null)
        val hasCallPermission = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CALL_PHONE
        ) == PackageManager.PERMISSION_GRANTED

        if (hasCallPermission) {
            try {
                val callIntent = Intent(Intent.ACTION_CALL, uri).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(callIntent)
                return
            } catch (e: Exception) {
                Log.w(TAG, "ACTION_CALL failed, trying TelecomManager.placeCall: ${e.message}")
            }

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
                    if (telecomManager != null) {
                        telecomManager.placeCall(uri, Bundle())
                        return
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "TelecomManager.placeCall failed: ${e.message}")
            }
        } else if (context is android.app.Activity) {
            pendingDirectCallNumber = phone
            androidx.core.app.ActivityCompat.requestPermissions(
                context,
                arrayOf(Manifest.permission.CALL_PHONE),
                1002
            )
            return
        }

        // Last resort fallback only if non-Activity context lacks CALL_PHONE permission
        try {
            val dialIntent = Intent(Intent.ACTION_DIAL, uri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(dialIntent)
        } catch (e: Exception) {
            Log.e(TAG, "ACTION_DIAL fallback failed: ${e.message}")
        }
    }

    /**
     * Removes the system overlay popup, stops sound, and cancels the notification.
     */
    fun dismissPopupAndNotification(context: Context, notificationId: Int = URGENT_NOTIFICATION_ID) {
        try {
            SoundCacheManager.stopActiveSound()
        } catch (_: Exception) {}

        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(notificationId)
            nm.cancel(URGENT_NOTIFICATION_ID)
        } catch (_: Exception) {}

        try {
            context.stopService(Intent(context, UrgentOverlayWindowService::class.java))
        } catch (_: Exception) {}

        try {
            UrgentOverlayFallbackActivity.finishActiveInstance()
        } catch (_: Exception) {}
    }

    fun executeButtonSpec(
        context: Context,
        button: OverlayButtonSpec,
        defaultPhone: String?,
        notificationId: Int = URGENT_NOTIFICATION_ID,
        overlayDocId: String = "",
        notifDocId: String = ""
    ) {
        if (overlayDocId.isNotBlank()) {
            FirestoreOverlayBackgroundService.markOverlayDismissedInFirestore(
                context.applicationContext,
                overlayDocId,
                button.action,
                button.label
            )
        }
        if (notifDocId.isNotBlank()) {
            FirestoreOverlayBackgroundService.markNotificationActionInFirestore(
                context.applicationContext,
                notifDocId,
                button.action,
                button.label
            )
        }

        when (button.action) {
            "call_now" -> {
                val targetPhone = button.payload.ifBlank { defaultPhone ?: "" }
                placeDirectCall(context, targetPhone)
            }
            "open_url" -> {
                dismissPopupAndNotification(context, notificationId)
                val rawUrl = button.payload.trim()
                if (rawUrl.isNotEmpty()) {
                    val fullUrl = if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
                        rawUrl
                    } else {
                        "https://$rawUrl"
                    }
                    try {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse(fullUrl)).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                        )
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to open URL: ${e.message}")
                    }
                }
            }
            "open_section" -> {
                dismissPopupAndNotification(context, notificationId)
                try {
                    val intent = Intent(context, MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        putExtra("open_section", button.payload.trim())
                    }
                    context.startActivity(intent)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to open section: ${e.message}")
                }
            }
            else -> {
                // "dismiss" or "call_later"
                dismissPopupAndNotification(context, notificationId)
            }
        }
    }

    fun parseButtonSpecs(
        buttonItemsJson: String?,
        buttonsJson: String?,
        includeFallbackDefaults: Boolean = true
    ): List<OverlayButtonSpec> {
        val result = mutableListOf<OverlayButtonSpec>()
        if (!buttonItemsJson.isNullOrBlank()) {
            try {
                val arr = JSONArray(buttonItemsJson)
                for (i in 0 until minOf(arr.length(), 3)) {
                    val obj = arr.optJSONObject(i) ?: continue
                    val label = obj.optString("label", "").trim()
                    val action = obj.optString("action", "dismiss").trim()
                    val payload = obj.optString("payload", "").trim()
                    if (label.isNotEmpty()) {
                        result.add(OverlayButtonSpec(label, action, payload))
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to parse buttonItems JSON: ${e.message}")
            }
        }

        if (result.isEmpty() && !buttonsJson.isNullOrBlank()) {
            try {
                val arr = JSONArray(buttonsJson)
                for (i in 0 until minOf(arr.length(), 3)) {
                    val item = arr.opt(i)
                    if (item is org.json.JSONObject) {
                        val label = item.optString("label", "").trim()
                        val action = item.optString("action", "dismiss").trim()
                        val payload = item.optString("payload", "").trim()
                        if (label.isNotEmpty()) {
                            result.add(OverlayButtonSpec(label, action, payload))
                        }
                    } else {
                        val label = arr.optString(i, "").trim()
                        if (label.isNotEmpty()) {
                            val lower = label.lowercase()
                            val action = if (lower.contains("call") && !lower.contains("later")) {
                                "call_now"
                            } else {
                                "dismiss"
                            }
                            result.add(OverlayButtonSpec(label, action, ""))
                        }
                    }
                }
            } catch (_: Exception) {}
        }

        if (result.isEmpty() && includeFallbackDefaults) {
            result.add(OverlayButtonSpec("Call Jay Now 📞", "call_now", ""))
            result.add(OverlayButtonSpec("Keep in My Heart 💖", "dismiss", ""))
        }
        return result
    }

    const val MUSIC_NOTIFICATION_ID = 9401

    @Volatile
    var isMusicSessionActive: Boolean = false

    private var mediaSession: android.media.session.MediaSession? = null
    private var audioFocusRequestObj: Any? = null
    private var cachedAlbumArtUrl: String = ""
    private var cachedAlbumArtBitmap: Bitmap? = null
    private val mediaArtExecutor = Executors.newSingleThreadExecutor()

    fun requestAudioFocus(context: Context) {
        // Chromium WebView's internal AudioFocusDelegate manages Android AudioFocus automatically
        // whenever HTML5 <audio> or YouTube <video> plays. Requesting a separate AudioFocusRequest
        // here would steal AudioFocus away from WebView and pause WebView playback.
    }

    fun abandonAudioFocus(context: Context) {
        try {
            val am = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val req = audioFocusRequestObj as? android.media.AudioFocusRequest
                if (req != null) {
                    am.abandonAudioFocusRequest(req)
                }
            }
        } catch (_: Exception) {}
    }

    @Suppress("DEPRECATION")
    private fun ensureMediaSession(context: Context): android.media.session.MediaSession {
        val existing = mediaSession
        if (existing != null) return existing
        val session = android.media.session.MediaSession(context.applicationContext, "KashishMusicSession")
        try {
            session.setFlags(
                android.media.session.MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or
                    android.media.session.MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
        } catch (_: Exception) {}
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                val attrs = android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
                session.setPlaybackToLocal(attrs)
            } catch (_: Exception) {}
        }
        session.setCallback(object : android.media.session.MediaSession.Callback() {
            override fun onPlay() {
                MainActivity.dispatchMediaAction("play")
            }

            override fun onPause() {
                MainActivity.dispatchMediaAction("pause")
            }

            override fun onSkipToNext() {
                MainActivity.dispatchMediaAction("next")
            }

            override fun onSkipToPrevious() {
                MainActivity.dispatchMediaAction("prev")
            }

            override fun onSeekTo(pos: Long) {
                val sec = (pos / 1000L).coerceAtLeast(0L)
                MainActivity.dispatchMediaAction("seek:$sec")
            }

            override fun onStop() {
                MainActivity.dispatchMediaAction("pause")
            }
        })
        session.isActive = true
        mediaSession = session
        return session
    }

    private fun cropSquareBitmap(src: Bitmap): Bitmap {
        return try {
            // Strip top/bottom 4:3 black letterbox bars present in YouTube hqdefault (480x360) / sddefault (640x480)
            val isFourByThree = src.width > src.height && kotlin.math.abs(src.width * 3 - src.height * 4) <= 12
            val activeHeight = if (isFourByThree) {
                ((src.width * 9) / 16).coerceAtLeast(1)
            } else {
                src.height
            }
            val size = minOf(src.width, activeHeight).coerceAtLeast(1)
            val left = ((src.width - size) / 2).coerceAtLeast(0)
            val top = ((src.height - size) / 2).coerceAtLeast(0)
            val cropped = Bitmap.createBitmap(src, left, top, size, size)
            if (cropped.width != 512 || cropped.height != 512) {
                Bitmap.createScaledBitmap(cropped, 512, 512, true)
            } else {
                cropped
            }
        } catch (_: Exception) {
            src
        }
    }

    private fun downloadBitmapFromUrl(urlStr: String): Bitmap? {
        return try {
            val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                connectTimeout = 4500
                readTimeout = 4500
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "Mozilla/5.0")
            }
            if (conn.responseCode in 200..299) {
                conn.inputStream.use { BitmapFactory.decodeStream(it) }
            } else {
                null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun loadSquareAlbumArtBitmap(context: Context, imageUrl: String): Bitmap? {
        val cleanUrl = imageUrl.trim()
        if (cleanUrl.isNotBlank() && cleanUrl == cachedAlbumArtUrl && cachedAlbumArtBitmap != null) {
            return cachedAlbumArtBitmap
        }

        // 1. Support data:image/...;base64,... directly from WebView canvas square crop
        if (cleanUrl.startsWith("data:image/") && cleanUrl.contains("base64,")) {
            try {
                val base64Part = cleanUrl.substringAfter("base64,")
                val bytes = android.util.Base64.decode(base64Part, android.util.Base64.DEFAULT)
                val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                if (decoded != null && decoded.width > 64) {
                    val square = cropSquareBitmap(decoded)
                    cachedAlbumArtUrl = cleanUrl
                    cachedAlbumArtBitmap = square
                    return square
                }
            } catch (_: Exception) {}
        }

        // 2. Support HTTP/HTTPS URLs with automatic YouTube multi-resolution fallback
        if (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://")) {
            val candidateUrls = mutableListOf<String>()
            candidateUrls.add(cleanUrl)

            val ytMatch = Regex("""ytimg\.com/vi/([a-zA-Z0-9_-]{11})""").find(cleanUrl)
            if (ytMatch != null) {
                val vid = ytMatch.groupValues[1]
                val fallbacks = listOf(
                    "https://i.ytimg.com/vi/$vid/maxresdefault.jpg",
                    "https://i.ytimg.com/vi/$vid/hq720.jpg",
                    "https://i.ytimg.com/vi/$vid/mqdefault.jpg",
                    "https://i.ytimg.com/vi/$vid/hqdefault.jpg"
                )
                for (fb in fallbacks) {
                    if (!candidateUrls.contains(fb)) {
                        candidateUrls.add(fb)
                    }
                }
            }

            for (candidate in candidateUrls) {
                val downloaded = downloadBitmapFromUrl(candidate)
                // Reject YouTube's 120x90 missing-thumbnail placeholder
                if (downloaded != null && downloaded.width > 120 && downloaded.height > 90) {
                    val square = cropSquareBitmap(downloaded)
                    cachedAlbumArtUrl = cleanUrl
                    cachedAlbumArtBitmap = square
                    return square
                }
            }
        }

        val fallback = loadNotificationAvatarBitmap(context, "")
        return if (fallback != null) cropSquareBitmap(fallback) else null
    }

    private var lastMetadataSignature: String = ""
    private var lastNotificationSignature: String = ""

    private fun postMediaSessionAndNotificationOnMain(
        appCtx: Context,
        title: String,
        artist: String,
        isPlaying: Boolean,
        positionSec: Long,
        durationSec: Long,
        artBitmap: Bitmap?
    ) {
        try {
            val session = ensureMediaSession(appCtx)
            session.isActive = true

            val posMs = (positionSec.coerceAtLeast(0L)) * 1000L
            val durMs = if (durationSec > 0L) durationSec * 1000L else 215_000L

            val stateBuilder = android.media.session.PlaybackState.Builder()
                .setActions(
                    android.media.session.PlaybackState.ACTION_PLAY or
                        android.media.session.PlaybackState.ACTION_PAUSE or
                        android.media.session.PlaybackState.ACTION_PLAY_PAUSE or
                        android.media.session.PlaybackState.ACTION_SKIP_TO_NEXT or
                        android.media.session.PlaybackState.ACTION_SKIP_TO_PREVIOUS or
                        android.media.session.PlaybackState.ACTION_SEEK_TO or
                        android.media.session.PlaybackState.ACTION_STOP
                )
                .setState(
                    if (isPlaying) android.media.session.PlaybackState.STATE_PLAYING
                    else android.media.session.PlaybackState.STATE_PAUSED,
                    posMs,
                    if (isPlaying) 1.0f else 0f,
                    android.os.SystemClock.elapsedRealtime()
                )
            session.setPlaybackState(stateBuilder.build())

            val artGenId = artBitmap?.generationId ?: 0
            val metaSig = "$title|$artist|$durMs|$artGenId"
            if (metaSig != lastMetadataSignature) {
                lastMetadataSignature = metaSig
                val metaBuilder = android.media.MediaMetadata.Builder()
                    .putString(android.media.MediaMetadata.METADATA_KEY_TITLE, title.ifBlank { "Melodies for Kashish ♡" })
                    .putString(android.media.MediaMetadata.METADATA_KEY_ARTIST, artist.ifBlank { "Jay's Heart" })
                    .putString(android.media.MediaMetadata.METADATA_KEY_ALBUM, "Kashish's World 💖")
                    .putLong(android.media.MediaMetadata.METADATA_KEY_DURATION, durMs)
                if (artBitmap != null) {
                    metaBuilder.putBitmap(android.media.MediaMetadata.METADATA_KEY_ALBUM_ART, artBitmap)
                    metaBuilder.putBitmap(android.media.MediaMetadata.METADATA_KEY_DISPLAY_ICON, artBitmap)
                }
                session.setMetadata(metaBuilder.build())
            }

            // Avoid redundant 1MB+ Binder IPC Notification rebuilds when only playback position ticked
            val notifSig = "$title|$artist|$isPlaying|$artGenId"
            if (notifSig == lastNotificationSignature) {
                return
            }
            lastNotificationSignature = notifSig

            val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

            val openAppIntent = Intent(appCtx, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            val contentPendingIntent = PendingIntent.getActivity(appCtx, 9410, openAppIntent, pendingFlags)

            fun buildMediaActionIntent(reqCode: Int, mediaAction: String): PendingIntent {
                val i = Intent(appCtx, NotificationActionReceiver::class.java).apply {
                    setPackage(appCtx.packageName)
                    action = "com.kashish.world.MEDIA_ACTION_$mediaAction"
                    putExtra("button_action", mediaAction)
                    putExtra("notification_id", MUSIC_NOTIFICATION_ID)
                }
                return PendingIntent.getBroadcast(appCtx, reqCode, i, pendingFlags)
            }

            val prevPi = buildMediaActionIntent(9411, "media_prev")
            val togglePi = buildMediaActionIntent(9412, if (isPlaying) "media_pause" else "media_play")
            val nextPi = buildMediaActionIntent(9413, "media_next")

            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.app.Notification.Builder(appCtx, SoundCacheManager.MUSIC_CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                android.app.Notification.Builder(appCtx)
            }

            val prevAction = android.app.Notification.Action.Builder(
                android.R.drawable.ic_media_previous,
                "Previous",
                prevPi
            ).build()

            val playPauseAction = android.app.Notification.Action.Builder(
                if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (isPlaying) "Pause" else "Play",
                togglePi
            ).build()

            val nextAction = android.app.Notification.Action.Builder(
                android.R.drawable.ic_media_next,
                "Next",
                nextPi
            ).build()

            val mediaStyle = android.app.Notification.MediaStyle()
                .setMediaSession(session.sessionToken)
                .setShowActionsInCompactView(0, 1, 2)

            builder
                .setSmallIcon(R.drawable.ic_stat_heart)
                .setLargeIcon(artBitmap)
                .setContentTitle(title.ifBlank { "Melodies for Kashish ♡" })
                .setContentText(artist.ifBlank { "Jay's Heart" })
                .setSubText("Kashish's Music ♡")
                .setColor(0xFFE11D48.toInt())
                .setVisibility(android.app.Notification.VISIBILITY_PUBLIC)
                .setCategory(android.app.Notification.CATEGORY_TRANSPORT)
                .setOngoing(isPlaying)
                .setOnlyAlertOnce(true)
                .setContentIntent(contentPendingIntent)
                .addAction(prevAction)
                .addAction(playPauseAction)
                .addAction(nextAction)
                .setStyle(mediaStyle)

            val builtNotification = builder.build()
            FirestoreOverlayBackgroundService.promoteForMusicNotification(appCtx, builtNotification)
            val nm = appCtx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(MUSIC_NOTIFICATION_ID, builtNotification)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update music notification: ${e.message}")
        }
    }

    /**
     * Posts or updates a native Android MediaStyle notification with 1:1 square artwork,
     * lock-screen MediaSession integration, AudioFocus, Foreground Service promotion,
     * and Previous / Play-Pause / Next / Seek controls.
     */
    fun updateMusicNotification(
        context: Context,
        title: String,
        artist: String,
        thumbnailUrl: String,
        isPlaying: Boolean,
        positionSec: Long = 0L,
        durationSec: Long = 0L
    ) {
        val appCtx = context.applicationContext
        isMusicSessionActive = true
        SoundCacheManager.ensureDefaultChannels(appCtx)
        if (isPlaying) {
            requestAudioFocus(appCtx)
            reapplySavedEqualizerIfNeeded(appCtx)
        }

        val cleanThumb = thumbnailUrl.trim()
        val immediateArt = if (cleanThumb.isNotBlank() && cleanThumb == cachedAlbumArtUrl && cachedAlbumArtBitmap != null) {
            cachedAlbumArtBitmap
        } else {
            cachedAlbumArtBitmap ?: loadNotificationAvatarBitmap(appCtx, "")?.let { cropSquareBitmap(it) }
        }

        // Immediately post/update MediaSession + Notification on main thread so transport controls
        // (Previous, Play/Pause, Next, Seekbar) never wait on network artwork download.
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            postMediaSessionAndNotificationOnMain(
                appCtx = appCtx,
                title = title,
                artist = artist,
                isPlaying = isPlaying,
                positionSec = positionSec,
                durationSec = durationSec,
                artBitmap = immediateArt
            )
        }

        // If new remote or base64 artwork is needed, decode/download it asynchronously and refresh the notification art.
        if (cleanThumb.isNotBlank() && cleanThumb != cachedAlbumArtUrl &&
            (cleanThumb.startsWith("http://") || cleanThumb.startsWith("https://") || cleanThumb.startsWith("data:image/"))
        ) {
            mediaArtExecutor.execute {
                val downloadedArt = loadSquareAlbumArtBitmap(appCtx, cleanThumb)
                if (downloadedArt != null && isMusicSessionActive) {
                    android.os.Handler(android.os.Looper.getMainLooper()).post {
                        postMediaSessionAndNotificationOnMain(
                            appCtx = appCtx,
                            title = title,
                            artist = artist,
                            isPlaying = isPlaying,
                            positionSec = positionSec,
                            durationSec = durationSec,
                            artBitmap = downloadedArt
                        )
                    }
                }
            }
        }
    }

    @Volatile
    private var globalEqualizer: android.media.audiofx.Equalizer? = null

    @Volatile
    private var globalBassBoost: android.media.audiofx.BassBoost? = null

    @Volatile
    private var globalLoudnessEnhancer: android.media.audiofx.LoudnessEnhancer? = null

    @Volatile
    private var lastEqBassDb: Int = 0

    @Volatile
    private var lastEqMidDb: Int = 0

    @Volatile
    private var lastEqTrebleDb: Int = 0

    @Volatile
    private var lastEqPreset: String = "flat"

    private fun reapplySavedEqualizerIfNeeded(context: Context) {
        if (lastEqBassDb != 0 || lastEqMidDb != 0 || lastEqTrebleDb != 0 || lastEqPreset != "flat") {
            applyEqualizerSettings(context, lastEqBassDb, lastEqMidDb, lastEqTrebleDb, lastEqPreset)
        }
    }

    /**
     * Applies 3-band EQ (Bass, Mid, Treble in dB: -12..+12) + BassBoost + LoudnessEnhancer
     * to Android's output mix (session 0) so both WebView <audio> and embedded YouTube playback
     * receive audible hardware DSP equalization.
     */
    @Synchronized
    fun applyEqualizerSettings(
        context: Context,
        bassDb: Int,
        midDb: Int,
        trebleDb: Int,
        presetName: String = "custom"
    ) {
        val clampedBass = bassDb.coerceIn(-12, 12)
        val clampedMid = midDb.coerceIn(-12, 12)
        val clampedTreble = trebleDb.coerceIn(-12, 12)
        lastEqBassDb = clampedBass
        lastEqMidDb = clampedMid
        lastEqTrebleDb = clampedTreble
        lastEqPreset = presetName.ifBlank { "custom" }

        val isFlat = clampedBass == 0 && clampedMid == 0 && clampedTreble == 0

        try {
            var eq = globalEqualizer
            if (eq == null) {
                eq = android.media.audiofx.Equalizer(100, 0)
                globalEqualizer = eq
            }
            eq.enabled = !isFlat
            val numBands = eq.numberOfBands.toInt()
            val range = eq.bandLevelRange
            val minMb = if (range != null && range.size >= 2) range[0].toInt() else -1200
            val maxMb = if (range != null && range.size >= 2) range[1].toInt() else 1200

            for (b in 0 until numBands) {
                val bandShort = b.toShort()
                val centerFreqMilliHz = eq.getCenterFreq(bandShort)
                val centerFreqHz = centerFreqMilliHz / 1000
                val targetDb = when {
                    centerFreqHz <= 250 -> clampedBass
                    centerFreqHz >= 2500 -> clampedTreble
                    else -> clampedMid
                }
                val targetMb = (targetDb * 100).coerceIn(minMb, maxMb).toShort()
                eq.setBandLevel(bandShort, targetMb)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Hardware Equalizer note: ${e.message}")
        }

        try {
            var bb = globalBassBoost
            if (bb == null) {
                bb = android.media.audiofx.BassBoost(100, 0)
                globalBassBoost = bb
            }
            if (bb.strengthSupported) {
                if (clampedBass > 0) {
                    bb.enabled = true
                    val strength = ((clampedBass.toFloat() / 12f) * 1000f).toInt().coerceIn(0, 1000).toShort()
                    bb.setStrength(strength)
                } else {
                    bb.setStrength(0)
                    bb.enabled = false
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Hardware BassBoost note: ${e.message}")
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                var le = globalLoudnessEnhancer
                if (le == null) {
                    le = android.media.audiofx.LoudnessEnhancer(0)
                    globalLoudnessEnhancer = le
                }
                val boostMb = ((maxOf(clampedBass, clampedMid, clampedTreble).coerceAtLeast(0)) * 45).coerceIn(0, 600)
                if (boostMb > 0 && !isFlat) {
                    le.setTargetGain(boostMb)
                    le.enabled = true
                } else {
                    le.setTargetGain(0)
                    le.enabled = false
                }
            }
        } catch (_: Exception) {}
    }

    fun dismissMusicNotification(context: Context) {
        isMusicSessionActive = false
        abandonAudioFocus(context)
        FirestoreOverlayBackgroundService.demoteMusicNotification(context)
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(MUSIC_NOTIFICATION_ID)
        } catch (_: Exception) {}
        try {
            mediaSession?.isActive = false
        } catch (_: Exception) {}
    }
}
