package com.jayshankar.kashish.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.jayshankar.kashish.MainActivity

class KashishFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "KashishFCM"
        const val STANDARD_CHANNEL_ID = "kashish_channel"
        const val URGENT_CHANNEL_ID = "kashish_urgent_channel"
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)

        val title = remoteMessage.notification?.title
            ?: remoteMessage.data["title"]
            ?: "Message from Jay 💖"

        val message = remoteMessage.notification?.body
            ?: remoteMessage.data["message"]
            ?: remoteMessage.data["body"]
            ?: return

        val isUrgent = remoteMessage.data["type"] == "urgent" ||
                remoteMessage.data["overlay"] == "true" ||
                remoteMessage.data["target"] == "recipient"

        val overlayId = remoteMessage.data["overlayId"]
            ?: remoteMessage.data["id"]
            ?: ""

        val optionsList = (remoteMessage.data["options"]?.split("\u001F") ?: emptyList())
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        val buttonLabel = remoteMessage.data["buttonLabel"] ?: "I Love You Too! ❤️"

        // Acquire a safe short wake lock to ensure delivery on deep sleep / Doze
        wakeScreenBriefly()

        if (isUrgent) {
            handleUrgentOverlayMessage(title, message, overlayId, ArrayList(optionsList), buttonLabel)
        } else {
            showStandardNotification(title, message)
        }
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.i(TAG, "New FCM device token received")
        saveFcmTokenToFirestore(token)
    }

    private fun getFirestoreDb(): FirebaseFirestore {
        val app = try {
            FirebaseApp.getInstance()
        } catch (_: Exception) {
            FirebaseApp.initializeApp(applicationContext) ?: FirebaseApp.getInstance()
        }
        return FirebaseFirestore.getInstance(app)
    }

    private fun saveFcmTokenToFirestore(token: String) {
        try {
            val db = getFirestoreDb()
                val firebaseAuth = FirebaseAuth.getInstance(FirebaseApp.getInstance())
                fun persistToken(ownerUid: String) {
                    val tokenData = hashMapOf(
                        "token" to token,
                        "ownerUid" to ownerUid,
                        "updatedAt" to com.google.firebase.Timestamp.now(),
                        "platform" to "android"
                    )
                    db.collection("device_tokens").document(token)
                        .set(tokenData)
                        .addOnSuccessListener { Log.d(TAG, "Device token registered") }
                        .addOnFailureListener { error ->
                            Log.w(TAG, "Device token registration failed: ${error.message}")
                        }
                }
                val currentUser = firebaseAuth.currentUser
                if (currentUser != null) {
                    persistToken(currentUser.uid)
                }
        } catch (e: Exception) {
            Log.w(TAG, "Error saving FCM token: ${e.message}")
        }
    }

    private fun wakeScreenBriefly() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
            val wakeLock = powerManager.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                "kashish:fcm_wake_lock"
            )
            wakeLock.acquire(8000L) // 8 seconds
        } catch (e: Exception) {
            Log.w(TAG, "Could not acquire wake lock: ${e.message}")
        }
    }

    private fun showStandardNotification(title: String, message: String) {
        try {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    STANDARD_CHANNEL_ID,
                    "Kashish Messages",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Messages and updates from Jay"
                    enableVibration(true)
                }
                notificationManager.createNotificationChannel(channel)
            }

            val launchIntent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }

            val pendingIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                } else {
                    PendingIntent.FLAG_UPDATE_CURRENT
                }
            )

            val notification = NotificationCompat.Builder(this, STANDARD_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .build()

            notificationManager.notify(System.currentTimeMillis().toInt(), notification)
        } catch (e: Exception) {
            Log.e(TAG, "Error displaying background FCM notification: ${e.message}")
        }
    }

    private fun handleUrgentOverlayMessage(
        title: String,
        message: String,
        overlayId: String,
        options: ArrayList<String>,
        buttonLabel: String
    ) {
        try {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                val audioAttributes = AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .build()

                val channel = NotificationChannel(
                    URGENT_CHANNEL_ID,
                    "Urgent Messages & Overlays",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "High-priority urgent message overlays from Jay"
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 400, 200, 400, 200, 600)
                    setSound(soundUri, audioAttributes)
                    lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
                }
                notificationManager.createNotificationChannel(channel)
            }

            val overlayIntent = Intent(this, com.jayshankar.kashish.ui.UrgentOverlayActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(com.jayshankar.kashish.ui.UrgentOverlayActivity.EXTRA_OVERLAY_ID, overlayId)
                putExtra(com.jayshankar.kashish.ui.UrgentOverlayActivity.EXTRA_MESSAGE, message)
                putStringArrayListExtra(com.jayshankar.kashish.ui.UrgentOverlayActivity.EXTRA_OPTIONS, options)
                putExtra(com.jayshankar.kashish.ui.UrgentOverlayActivity.EXTRA_BUTTON_LABEL, buttonLabel)
            }

            val pendingIntent = PendingIntent.getActivity(
                this,
                overlayId.hashCode(),
                overlayIntent,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                } else {
                    PendingIntent.FLAG_UPDATE_CURRENT
                }
            )

            val builder = NotificationCompat.Builder(this, URGENT_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("Urgent: $title")
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setFullScreenIntent(pendingIntent, true) // Pops heads-up / full-screen overlay
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setOngoing(false)

            notificationManager.notify(777, builder.build())

            // If user granted overlay permission (SYSTEM_ALERT_WINDOW), directly launch the app over other apps!
            val canDrawOverlays = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Settings.canDrawOverlays(this)
            } else {
                true
            }

            if (canDrawOverlays) {
                Log.i(TAG, "Overlay permission is granted. Launching UrgentOverlayActivity directly over other apps!")
                startActivity(overlayIntent)
            } else {
                Log.i(TAG, "Overlay permission not granted; heads-up full-screen notification displayed.")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error displaying urgent overlay: ${e.message}")
        }
    }
}
