package com.kashish.world

import android.Manifest
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
    val callPhone: Boolean,
    val batteryUnrestricted: Boolean,
    val autostartConfigured: Boolean,
    val deviceModel: String
)

object PermissionReporter {
    private const val TAG = "PermissionReporter"
    private const val PREFS_NAME = "kashish_app_prefs"
    private const val KEY_AUTOSTART_OPENED = "autostart_settings_opened"
    private const val KEY_SETUP_COMPLETED = "first_launch_setup_completed"
    private const val KEY_FCM_TOKEN = "cached_fcm_token"
    private const val KEY_BASE_URL = "cached_web_base_url"
    const val DEFAULT_WEB_URL = "https://kashishhji.web.app"

    private val executor = Executors.newSingleThreadExecutor()

    fun isFirstLaunchSetupCompleted(context: Context): Boolean {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_SETUP_COMPLETED, false)
    }

    fun markFirstLaunchSetupCompleted(context: Context) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_SETUP_COMPLETED, true)
            .apply()
    }

    fun isAutostartConfigured(context: Context): Boolean {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_AUTOSTART_OPENED, false)
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

    fun getWebBaseUrl(context: Context): String {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_BASE_URL, DEFAULT_WEB_URL) ?: DEFAULT_WEB_URL
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

        val callPhoneGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CALL_PHONE
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
            callPhone = callPhoneGranted,
            batteryUnrestricted = batteryUnrestricted,
            autostartConfigured = autostart,
            deviceModel = model
        )
    }

    fun toJson(context: Context): JSONObject {
        val snap = collectSnapshot(context)
        return JSONObject().apply {
            put("notifications", snap.notifications)
            put("overlay", snap.overlay)
            put("callPhone", snap.callPhone)
            put("batteryUnrestricted", snap.batteryUnrestricted)
            put("autostartConfigured", snap.autostartConfigured)
            put("deviceModel", snap.deviceModel)
            val fcm = getSavedFcmToken(context)
            if (fcm.isNotBlank()) {
                put("fcmToken", fcm)
            }
        }
    }

    /**
     * Fetches the current FCM token (if not cached) and posts the permission & token snapshot
     * to /api/device/status so the Admin Panel Activity tab updates in Firestore.
     */
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
                sendStatusOverHttp(appContext, resolvedToken)
            }
        } catch (_: Exception) {
            sendStatusOverHttp(appContext, fcmTokenOverride ?: getSavedFcmToken(appContext))
        }
    }

    private fun sendStatusOverHttp(context: Context, token: String) {
        executor.execute {
            try {
                val payload = toJson(context).apply {
                    if (token.isNotBlank()) put("fcmToken", token)
                }
                val baseUrl = getWebBaseUrl(context).trimEnd('/')
                val endpoint = URL("$baseUrl/api/device/status")
                val conn = (endpoint.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 8000
                    readTimeout = 8000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                    writer.write(payload.toString())
                    writer.flush()
                }
                val code = conn.responseCode
                Log.d(TAG, "Reported permission & FCM status to server (HTTP $code)")
                conn.disconnect()
            } catch (e: Exception) {
                Log.w(TAG, "Device status sync note: ${e.message}")
            }
        }
    }
}
