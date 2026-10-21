package com.kashish.world

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.webkit.JavascriptInterface
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Native bridge for Kashish's World Android wrapper.
 */
class AndroidAppInterface(private val activity: Activity) {

    private val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vibratorManager = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        vibratorManager.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        activity.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }

    @JavascriptInterface
    fun vibrate(milliseconds: Long) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(milliseconds, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(milliseconds)
        }
    }

    @JavascriptInterface
    fun showToast(message: String) {
        // Bottom toast popups disabled
    }

    @JavascriptInterface
    fun logActivity(description: String) {
        android.util.Log.d("KashishApp", "Activity: $description")
    }

    @JavascriptInterface
    fun setAuthToken(token: String?) {
        if (!token.isNullOrBlank()) {
            PermissionReporter.saveAuthToken(activity.applicationContext, token)
            FirestoreOverlayBackgroundService.startServiceSafely(activity.applicationContext)
            PermissionReporter.reportStatusAsync(activity.applicationContext)
        }
    }

    @JavascriptInterface
    fun showSystemOverlay(overlayJson: String?) {
        if (overlayJson.isNullOrBlank()) return
        activity.runOnUiThread {
            try {
                val obj = JSONObject(overlayJson)
                val docId = obj.optString("id", "")
                val title = obj.optString("title", "Thinking of You 💖")
                val message = obj.optString("message", "")
                val imageUrl = obj.optString("imageUrl", "")
                val theme = obj.optString("theme", "velvet-rose")
                val fontStyle = obj.optString("fontStyle", "romantic-serif")
                val buttonsArr = obj.optJSONArray("buttons")?.toString() ?: ""
                val phone = obj.optString("phoneNumber", "")

                CallAndOverlayHelper.triggerTruecallerOverlay(
                    context = activity.applicationContext,
                    overlayDocId = docId,
                    title = title,
                    message = message,
                    imageUrl = imageUrl,
                    theme = theme,
                    fontStyle = fontStyle,
                    buttonItemsJson = buttonsArr,
                    phoneNumber = phone
                )
            } catch (_: Exception) {}
        }
    }

    @JavascriptInterface
    fun makePhoneCall(phoneNumber: String?) {
        activity.runOnUiThread {
            CallAndOverlayHelper.placeDirectCall(activity, phoneNumber)
        }
    }

    @JavascriptInterface
    fun canDrawOverlays(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(activity)
        } else {
            true
        }
    }

    @JavascriptInterface
    fun requestOverlayPermission() {
        activity.runOnUiThread {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try {
                    val intent = Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:${activity.packageName}")
                    )
                    activity.startActivity(intent)
                } catch (_: Exception) {}
            }
        }
    }

    @JavascriptInterface
    fun openOverlayPermission() {
        requestOverlayPermission()
    }

    @JavascriptInterface
    fun openPermissionSetup() {
        activity.runOnUiThread {
            activity.startActivity(Intent(activity, PermissionSetupActivity::class.java))
        }
    }

    @JavascriptInterface
    fun getPermissionStatusJson(): String {
        return PermissionReporter.toJson(activity).toString()
    }

    @JavascriptInterface
    fun bringAppToFront() {
        activity.runOnUiThread {
            try {
                CallAndOverlayHelper.wakeUpScreenImmediately(activity, 12_000L)
                val intent = Intent(activity, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                }
                activity.startActivity(intent)
            } catch (_: Exception) {}
        }
    }

    @JavascriptInterface
    fun showNotification(title: String, body: String) {
        CallAndOverlayHelper.showHighPriorityBannerNotification(activity, title, body)
    }

    @JavascriptInterface
    fun requestPermissions(types: Array<String>) {
        val permissionsToRequest = mutableListOf<String>()

        for (type in types) {
            when (type.uppercase()) {
                "CAMERA" -> permissionsToRequest.add(Manifest.permission.CAMERA)
                "MICROPHONE", "AUDIO" -> permissionsToRequest.add(Manifest.permission.RECORD_AUDIO)
                "CALL_PHONE", "PHONE" -> permissionsToRequest.add(Manifest.permission.CALL_PHONE)
                "NOTIFICATIONS" -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
                    }
                }
            }
        }

        if (permissionsToRequest.isNotEmpty()) {
            val neededPermissions = permissionsToRequest.filter {
                ContextCompat.checkSelfPermission(activity, it) != PackageManager.PERMISSION_GRANTED
            }
            if (neededPermissions.isNotEmpty()) {
                ActivityCompat.requestPermissions(activity, neededPermissions.toTypedArray(), 1001)
            }
        }
    }

    @JavascriptInterface
    fun getAppVersion(): String {
        return try {
            val pInfo = activity.packageManager.getPackageInfo(activity.packageName, 0)
            pInfo.versionName ?: "2.0.0"
        } catch (_: Exception) {
            "2.0.0"
        }
    }

    @JavascriptInterface
    fun isNativeApp(): Boolean = true
}
