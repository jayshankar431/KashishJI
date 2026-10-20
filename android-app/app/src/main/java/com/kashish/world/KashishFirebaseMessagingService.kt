package com.kashish.world

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives FCM HTTP v1 high-priority DATA messages even when the app is closed.
 * Downloads/caches custom sounds and shows either a SYSTEM_ALERT_WINDOW overlay over other apps
 * or a high-priority notification with USE_FULL_SCREEN_INTENT and action buttons.
 */
class KashishFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "KashishFCMService"
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "Refreshed FCM token received")
        PermissionReporter.saveFcmToken(applicationContext, token)
        PermissionReporter.reportStatusAsync(applicationContext, fcmTokenOverride = token)
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        val data = remoteMessage.data
        if (data.isEmpty() && remoteMessage.notification == null) return

        // Acquire short wake lock so sound download + overlay launch complete reliably
        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
        val wakeLock = pm?.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
            "kashish:fcm_wakelock"
        )
        wakeLock?.acquire(10_000L)

        try {
            val type = data["type"] ?: "notification"
            val title = data["title"]
                ?: remoteMessage.notification?.title
                ?: if (type == "overlay") "Urgent Message from Jay 💖" else "Message from Jay 💖"
            val message = data["message"]
                ?: remoteMessage.notification?.body
                ?: "Tap to open Kashish's World"
            val soundUrl = data["sound"] ?: ""
            val imageUrl = data["imageUrl"] ?: ""
            val popupColor = data["popupColor"] ?: "rose"
            val phoneNumber = data["phoneNumber"] ?: ""
            val buttonItemsJson = data["buttonItems"] ?: ""
            val buttonsJson = data["buttons"] ?: ""

            if (phoneNumber.isNotBlank()) {
                CallAndOverlayHelper.saveCachedPhoneNumber(applicationContext, phoneNumber)
            }

            // Download & cache custom sound (if provided) and play it
            val cachedSoundFile = SoundCacheManager.getOrDownloadSoundFile(applicationContext, soundUrl)
            val channelId = if (type == "overlay" && soundUrl.isBlank()) {
                SoundCacheManager.ensureDefaultChannels(applicationContext)
                SoundCacheManager.OVERLAY_CHANNEL_ID
            } else {
                SoundCacheManager.getChannelForSound(applicationContext, soundUrl, cachedSoundFile)
            }

            SoundCacheManager.playCachedSound(applicationContext, cachedSoundFile)

            if (type == "overlay") {
                handleUrgentOverlayMessage(
                    title = title,
                    message = message,
                    imageUrl = imageUrl,
                    popupColor = popupColor,
                    phoneNumber = phoneNumber,
                    buttonItemsJson = buttonItemsJson,
                    buttonsJson = buttonsJson,
                    channelId = channelId
                )
            } else {
                showHighPriorityNotification(
                    title = title,
                    message = message,
                    channelId = channelId
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error handling FCM data message: ${e.message}", e)
        } finally {
            try {
                if (wakeLock?.isHeld == true) wakeLock.release()
            } catch (_: Exception) {}
        }
    }

    private fun handleUrgentOverlayMessage(
        title: String,
        message: String,
        imageUrl: String,
        popupColor: String,
        phoneNumber: String,
        buttonItemsJson: String,
        buttonsJson: String,
        channelId: String
    ) {
        val notificationId = CallAndOverlayHelper.URGENT_NOTIFICATION_ID
        val canDraw = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)

        // 1. If SYSTEM_ALERT_WINDOW permission is granted, launch the system overlay service over other apps
        if (canDraw) {
            try {
                val serviceIntent = Intent(this, UrgentOverlayWindowService::class.java).apply {
                    putExtra("title", title)
                    putExtra("message", message)
                    putExtra("imageUrl", imageUrl)
                    putExtra("popupColor", popupColor)
                    putExtra("phoneNumber", phoneNumber)
                    putExtra("buttonItems", buttonItemsJson)
                    putExtra("buttons", buttonsJson)
                    putExtra("notificationId", notificationId)
                }
                startService(serviceIntent)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to start UrgentOverlayWindowService: ${e.message}")
            }
        }

        // 2. Always build a high-priority notification with USE_FULL_SCREEN_INTENT fallback + action buttons
        val fallbackIntent = Intent(this, UrgentOverlayFallbackActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("title", title)
            putExtra("message", message)
            putExtra("imageUrl", imageUrl)
            putExtra("popupColor", popupColor)
            putExtra("phoneNumber", phoneNumber)
            putExtra("buttonItems", buttonItemsJson)
            putExtra("buttons", buttonsJson)
            putExtra("notificationId", notificationId)
        }

        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

        val fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            9100,
            fallbackIntent,
            pendingFlags
        )

        val builder = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOngoing(!canDraw)
            .setContentIntent(fullScreenPendingIntent)

        // Attach full-screen intent when overlay permission is missing (or screen is locked)
        builder.setFullScreenIntent(fullScreenPendingIntent, true)

        // Add the 1 to 3 action buttons ("Call Right Now", "Call Later", etc.)
        val buttons = CallAndOverlayHelper.parseButtonSpecs(buttonItemsJson, buttonsJson)
        buttons.take(3).forEachIndexed { index, spec ->
            val actionIntent = Intent(this, NotificationActionReceiver::class.java).apply {
                action = "com.kashish.world.NOTIF_ACTION_$index"
                putExtra("button_label", spec.label)
                putExtra("button_action", spec.action)
                putExtra("button_payload", spec.payload)
                putExtra("phone_number", phoneNumber)
                putExtra("notification_id", notificationId)
            }
            val actionPendingIntent = PendingIntent.getBroadcast(
                this,
                9200 + index,
                actionIntent,
                pendingFlags
            )
            builder.addAction(0, spec.label, actionPendingIntent)
        }

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(notificationId, builder.build())
    }

    private fun showHighPriorityNotification(
        title: String,
        message: String,
        channelId: String
    ) {
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        val contentIntent = PendingIntent.getActivity(this, 8100, openAppIntent, pendingFlags)

        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify((System.currentTimeMillis() % 100000).toInt(), notification)
    }
}
