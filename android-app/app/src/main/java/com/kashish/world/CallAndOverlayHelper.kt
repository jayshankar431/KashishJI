package com.kashish.world

import android.Manifest
import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
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
import androidx.core.content.ContextCompat
import org.json.JSONArray

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

    /**
     * Unified Truecaller-Style Overlay Trigger:
     * 1. Lights up the screen via WakeLock (PowerManager.ACQUIRE_CAUSES_WAKEUP).
     * 2. Vibrates with a romantic heartbeat (NO phone call ringtone!).
     * 3. If SYSTEM_ALERT_WINDOW ("Display over other apps") is granted, draws the romantic popup card
     *    directly over Instagram, WhatsApp, or the Lock Screen via UrgentOverlayWindowService.
     * 4. Also dispatches a silent USE_FULL_SCREEN_INTENT notification so lockscreen wake-up works
     *    reliably across Android 10–14 without playing the incoming call ringtone.
     */
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
        val pm = appCtx.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val km = appCtx.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        val isScreenOffOrLocked = (pm?.isInteractive == false) || (km?.isKeyguardLocked == true)

        // 2. Launch SYSTEM_ALERT_WINDOW service over other apps (Instagram/WhatsApp/LockScreen)
        if (canDraw) {
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
            } catch (e: Exception) {
                Log.w(TAG, "Failed to start UrgentOverlayWindowService: ${e.message}")
            }
        }

        // 3. Build USE_FULL_SCREEN_INTENT activity + silent high-priority notification for lock-screen wake-up
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

        // If screen is off/locked or overlay permission is missing, also launch full-screen activity directly when allowed
        if (!canDraw || isScreenOffOrLocked) {
            try {
                appCtx.startActivity(fallbackIntent)
            } catch (_: Exception) {}
        }

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

            val largeIcon = try {
                BitmapFactory.decodeResource(appCtx.resources, R.drawable.ic_notification_large)
            } catch (_: Exception) {
                null
            }

            val builder = NotificationCompat.Builder(appCtx, resolvedChannelId)
                .setSmallIcon(R.drawable.ic_stat_heart)
                .setLargeIcon(largeIcon)
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
     * Dispatches a high-priority banner notification with optional configurable Action Buttons
     * ("Call Me Now", "Open Gallery", "Open Link", "Dismiss").
     */
    fun showHighPriorityBannerNotification(
        context: Context,
        title: String,
        message: String,
        channelId: String = SoundCacheManager.DEFAULT_CHANNEL_ID,
        notifDocId: String = "",
        buttonItemsJson: String = "",
        phoneNumber: String = ""
    ) {
        val appCtx = context.applicationContext
        wakeUpScreenImmediately(appCtx, 8_000L)
        SoundCacheManager.ensureDefaultChannels(appCtx)

        val notificationId = (System.currentTimeMillis() % 80000).toInt() + 10000
        val openAppIntent = Intent(appCtx, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        val contentIntent = PendingIntent.getActivity(appCtx, 8100, openAppIntent, pendingFlags)

        val largeIcon = try {
            BitmapFactory.decodeResource(appCtx.resources, R.drawable.ic_notification_large)
        } catch (_: Exception) {
            null
        }

        val builder = NotificationCompat.Builder(appCtx, channelId)
            .setSmallIcon(R.drawable.ic_stat_heart)
            .setLargeIcon(largeIcon)
            .setColor(0xFFE11D48.toInt())
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)

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
                button.action
            )
        }
        if (notifDocId.isNotBlank()) {
            FirestoreOverlayBackgroundService.markNotificationActionInFirestore(
                context.applicationContext,
                notifDocId,
                button.action
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
}
