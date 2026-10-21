package com.kashish.world

import android.content.Context
import android.os.PowerManager
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives FCM HTTP v1 high-priority DATA messages even when the app is closed.
 * Delegates overlay rendering and screen wake-up to CallAndOverlayHelper.triggerTruecallerOverlay.
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

        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
        val wakeLock = pm?.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "kashish:fcm_wakelock"
        )
        wakeLock?.acquire(10_000L)

        try {
            val type = data["type"] ?: "notification"
            val docId = data["id"] ?: data["overlayDocId"] ?: ""
            val title = data["title"]
                ?: remoteMessage.notification?.title
                ?: if (type == "overlay") "Thinking of You 💖" else "Message from Jay 💖"
            val message = data["message"]
                ?: remoteMessage.notification?.body
                ?: "Tap to open Kashishhh 💖"
            val soundUrl = data["sound"] ?: data["soundUrl"] ?: ""
            val imageUrl = data["imageUrl"] ?: ""
            val theme = data["theme"] ?: data["popupColor"] ?: "velvet-rose"
            val fontStyle = data["fontStyle"] ?: "romantic-serif"
            val phoneNumber = data["phoneNumber"] ?: ""
            val buttonItemsJson = data["buttonItems"] ?: ""
            val buttonsJson = data["buttons"] ?: ""

            if (phoneNumber.isNotBlank()) {
                CallAndOverlayHelper.saveCachedPhoneNumber(applicationContext, phoneNumber)
            }

            val cachedSoundFile = SoundCacheManager.getOrDownloadSoundFile(applicationContext, soundUrl)
            val channelId = if (type == "overlay" && soundUrl.isBlank()) {
                SoundCacheManager.ensureDefaultChannels(applicationContext)
                SoundCacheManager.OVERLAY_CHANNEL_ID
            } else {
                SoundCacheManager.getChannelForSound(applicationContext, soundUrl, cachedSoundFile)
            }

            if (type == "overlay") {
                CallAndOverlayHelper.triggerTruecallerOverlay(
                    context = applicationContext,
                    overlayDocId = docId,
                    title = title,
                    message = message,
                    imageUrl = imageUrl,
                    theme = theme,
                    fontStyle = fontStyle,
                    soundUrl = soundUrl,
                    buttonItemsJson = buttonItemsJson,
                    buttonsJson = buttonsJson,
                    phoneNumber = phoneNumber,
                    channelId = channelId
                )
            } else {
                SoundCacheManager.playCachedSound(applicationContext, cachedSoundFile)
                CallAndOverlayHelper.showHighPriorityBannerNotification(
                    context = applicationContext,
                    title = title,
                    message = message,
                    channelId = channelId,
                    notifDocId = docId,
                    buttonItemsJson = buttonItemsJson.ifBlank { buttonsJson },
                    phoneNumber = phoneNumber,
                    imageUrl = imageUrl
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
}
