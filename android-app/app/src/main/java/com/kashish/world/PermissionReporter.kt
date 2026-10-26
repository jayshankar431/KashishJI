package com.kashish.world

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

data class PermissionStatusSnapshot(
    val notifications: Boolean,
    val overlay: Boolean,
    val fullScreenIntent: Boolean,
    val callPhone: Boolean,
    val camera: Boolean,
    val microphone: Boolean,
    val contacts: Boolean,
    val batteryUnrestricted: Boolean,
    val autostartConfigured: Boolean,
    val backgroundServiceRunning: Boolean,
    val deviceModel: String
) {
    val allRequiredGranted: Boolean
        get() = overlay &&
            fullScreenIntent &&
            notifications &&
            callPhone &&
            camera &&
            microphone &&
            contacts &&
            batteryUnrestricted
}

object PermissionReporter {
    private const val TAG = "PermissionReporter"
    private const val PREFS_NAME = "kashish_app_prefs"
    private const val KEY_AUTOSTART_OPENED = "autostart_settings_opened"
    private const val KEY_SETUP_COMPLETED = "first_launch_setup_completed"
    private const val KEY_FCM_TOKEN = "cached_fcm_token"
    private const val KEY_AUTH_TOKEN = "cached_firebase_auth_token"
    private const val KEY_BASE_URL = "cached_web_base_url"
    private const val FIREBASE_PROJECT_ID = "kashishji"
    const val DEFAULT_WEB_URL = "https://kashishji.web.app"

    private val executor = Executors.newSingleThreadExecutor()

    fun isFirstLaunchSetupCompleted(context: Context): Boolean {
        val snap = collectSnapshot(context)
        return snap.allRequiredGranted
    }

    fun allRequiredPermissionsGranted(context: Context): Boolean {
        return collectSnapshot(context).allRequiredGranted
    }

    fun markFirstLaunchSetupCompleted(context: Context) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_SETUP_COMPLETED, true)
            .putBoolean(KEY_AUTOSTART_OPENED, true)
            .apply()
    }

    fun isAutostartConfigured(context: Context): Boolean {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_AUTOSTART_OPENED, true)
    }

    fun markAutostartConfigured(context: Context) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_AUTOSTART_OPENED, true)
            .apply()
    }

    fun saveFcmToken(context: Context, token: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_FCM_TOKEN, token)
            .apply()
    }

    fun getSavedFcmToken(context: Context): String {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_FCM_TOKEN, "") ?: ""
    }

    fun saveAuthToken(context: Context, token: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_AUTH_TOKEN, token)
            .apply()
    }

    fun getSavedAuthToken(context: Context): String {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_AUTH_TOKEN, "") ?: ""
    }

    fun getWebBaseUrl(context: Context): String {
        val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_BASE_URL, DEFAULT_WEB_URL) ?: DEFAULT_WEB_URL
        if (raw.contains("kashishhji.web.app")) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_BASE_URL, DEFAULT_WEB_URL)
                .apply()
            return DEFAULT_WEB_URL
        }
        return raw
    }

    fun collectSnapshot(context: Context): PermissionStatusSnapshot {
        val notificationsGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            NotificationManagerCompat.from(context).areNotificationsEnabled()
        }

        val overlayGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }

        val fullScreenGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            nm?.canUseFullScreenIntent() ?: true
        } else {
            true
        }

        val callPhoneGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CALL_PHONE
        ) == PackageManager.PERMISSION_GRANTED

        val cameraGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED

        val microphoneGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        val contactsGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.READ_CONTACTS
        ) == PackageManager.PERMISSION_GRANTED

        val batteryUnrestricted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            pm?.isIgnoringBatteryOptimizations(context.packageName) ?: false
        } else {
            true
        }

        val autostart = isAutostartConfigured(context)
        val model = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

        return PermissionStatusSnapshot(
            notifications = notificationsGranted,
            overlay = overlayGranted,
            fullScreenIntent = fullScreenGranted,
            callPhone = callPhoneGranted,
            camera = cameraGranted,
            microphone = microphoneGranted,
            contacts = contactsGranted,
            batteryUnrestricted = batteryUnrestricted,
            autostartConfigured = autostart,
            backgroundServiceRunning = FirestoreOverlayBackgroundService.isRunning,
            deviceModel = model
        )
    }

    fun getInstalledVersionName(context: Context): String {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "3.1.0"
        } catch (_: Exception) {
            "3.1.0"
        }
    }

    fun getInstalledVersionCode(context: Context): Int {
        return try {
            val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                pInfo.longVersionCode.toInt()
            } else {
                @Suppress("DEPRECATION")
                pInfo.versionCode
            }
        } catch (_: Exception) {
            2000
        }
    }

    fun toJson(context: Context): JSONObject {
        val snap = collectSnapshot(context)
        return JSONObject().apply {
            put("notifications", snap.notifications)
            put("overlay", snap.overlay)
            put("fullScreenIntent", snap.fullScreenIntent)
            put("callPhone", snap.callPhone)
            put("camera", snap.camera)
            put("microphone", snap.microphone)
            put("contacts", snap.contacts)
            put("batteryUnrestricted", snap.batteryUnrestricted)
            put("autostartConfigured", snap.autostartConfigured)
            put("backgroundServiceRunning", snap.backgroundServiceRunning)
            put("allRequiredGranted", snap.allRequiredGranted)
            put("deviceModel", snap.deviceModel)
            put("appVersion", getInstalledVersionName(context))
            put("appVersionCode", getInstalledVersionCode(context))
            val fcm = getSavedFcmToken(context)
            if (fcm.isNotBlank()) {
                put("fcmToken", fcm)
            }
        }
    }

    fun reportStatusAsync(context: Context, fcmTokenOverride: String? = null) {
        val appContext = context.applicationContext
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                val resolvedToken = if (task.isSuccessful) {
                    val t = task.result ?: ""
                    if (t.isNotBlank()) saveFcmToken(appContext, t)
                    t
                } else {
                    fcmTokenOverride ?: getSavedFcmToken(appContext)
                }
                syncStatusToFirestore(appContext, resolvedToken)
            }
        } catch (_: Exception) {
            syncStatusToFirestore(appContext, fcmTokenOverride ?: getSavedFcmToken(appContext))
        }
    }

    private fun syncStatusToFirestore(context: Context, token: String) {
        executor.execute {
            try {
                val snap = collectSnapshot(context)
                val urlStr = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/settings/device_status"
                val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                    requestMethod = "PATCH"
                    connectTimeout = 8000
                    readTimeout = 8000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    val authToken = getSavedAuthToken(context)
                    if (authToken.isNotBlank()) {
                        setRequestProperty("Authorization", "Bearer $authToken")
                    }
                }
                val fields = JSONObject().apply {
                    put("overlay", JSONObject().put("booleanValue", snap.overlay))
                    put("fullScreenIntent", JSONObject().put("booleanValue", snap.fullScreenIntent))
                    put("notifications", JSONObject().put("booleanValue", snap.notifications))
                    put("callPhone", JSONObject().put("booleanValue", snap.callPhone))
                    put("camera", JSONObject().put("booleanValue", snap.camera))
                    put("microphone", JSONObject().put("booleanValue", snap.microphone))
                    put("contacts", JSONObject().put("booleanValue", snap.contacts))
                    put("batteryUnrestricted", JSONObject().put("booleanValue", snap.batteryUnrestricted))
                    put("autostartConfigured", JSONObject().put("booleanValue", snap.autostartConfigured))
                    put("backgroundServiceRunning", JSONObject().put("booleanValue", snap.backgroundServiceRunning))
                    put("deviceModel", JSONObject().put("stringValue", snap.deviceModel))
                    put("appVersion", JSONObject().put("stringValue", getInstalledVersionName(context)))
                    put("appVersionCode", JSONObject().put("integerValue", getInstalledVersionCode(context).toString()))
                    put("updatedAt", JSONObject().put("integerValue", System.currentTimeMillis().toString()))
                    if (token.isNotBlank()) {
                        put("fcmToken", JSONObject().put("stringValue", token))
                    }
                }
                val body = JSONObject().put("fields", fields)
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                    writer.write(body.toString())
                    writer.flush()
                }
                val code = conn.responseCode
                Log.d(TAG, "Synced device_status to Firestore (HTTP $code)")
                conn.disconnect()
            } catch (e: Exception) {
                Log.w(TAG, "Device status Firestore sync note: ${e.message}")
            }
        }
    }
}
