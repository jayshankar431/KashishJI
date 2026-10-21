package com.kashish.world

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

class AndroidAppInterface(private val context: Context) {

    @JavascriptInterface
    fun showToast(message: String) {
        if (context is Activity) {
            context.runOnUiThread {
                Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
            }
        } else {
            Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun vibrate(durationMs: Long) {
        val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vibratorManager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(durationMs)
        }
    }

    @JavascriptInterface
    fun shareText(title: String, text: String) {
        val sendIntent = Intent().apply {
            action = Intent.ACTION_SEND
            putExtra(Intent.EXTRA_TITLE, title)
            putExtra(Intent.EXTRA_TEXT, text)
            type = "text/plain"
        }
        val shareIntent = Intent.createChooser(sendIntent, title).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(shareIntent)
    }

    @JavascriptInterface
    fun showNotification(title: String, message: String) {
        CallAndOverlayHelper.showHighPriorityBannerNotification(
            context = context,
            title = title,
            message = message
        )
    }

    @JavascriptInterface
    fun showNotificationWithButtons(title: String, message: String, buttonsJson: String, notifDocId: String) {
        CallAndOverlayHelper.showHighPriorityBannerNotification(
            context = context,
            title = title,
            message = message,
            notifDocId = notifDocId,
            buttonItemsJson = buttonsJson,
            phoneNumber = CallAndOverlayHelper.getCachedPhoneNumber(context)
        )
    }

    /**
     * Triggers a Truecaller-style SYSTEM_ALERT_WINDOW + USE_FULL_SCREEN_INTENT + WakeLock
     * romantic popup card directly over any app or locked screen.
     */
    @JavascriptInterface
    fun showSystemOverlay(overlayJson: String) {
        try {
            val obj = JSONObject(overlayJson)
            val docId = obj.optString("id", "")
            val title = obj.optString("title", "A Special Note For Kashish 💖")
            val message = obj.optString("message", "Thinking of you right now!")
            val imageUrl = obj.optString("imageUrl", "")
            val theme = obj.optString("theme", "velvet-rose")
            val fontStyle = obj.optString("fontStyle", "romantic-serif")
            val soundUrl = obj.optString("soundUrl", "")
            val phoneNumber = obj.optString("phoneNumber", CallAndOverlayHelper.getCachedPhoneNumber(context))
            val buttonsArr = obj.optJSONArray("buttons")?.toString() ?: ""

            val runPopup = Runnable {
                CallAndOverlayHelper.triggerTruecallerOverlay(
                    context = context.applicationContext,
                    overlayDocId = docId,
                    title = title,
                    message = message,
                    imageUrl = imageUrl,
                    theme = theme,
                    fontStyle = fontStyle,
                    soundUrl = soundUrl,
                    buttonItemsJson = buttonsArr,
                    phoneNumber = phoneNumber
                )
            }
            if (context is Activity) {
                context.runOnUiThread(runPopup)
            } else {
                runPopup.run()
            }
        } catch (_: Exception) {}
    }

    @JavascriptInterface
    fun setAuthToken(token: String) {
        PermissionReporter.saveAuthToken(context, token)
        PermissionReporter.reportStatusAsync(context)
        FirestoreOverlayBackgroundService.startServiceSafely(context)
    }

    @JavascriptInterface
    fun getPermissionStatusJson(): String {
        return try {
            PermissionReporter.toJson(context).toString()
        } catch (_: Exception) {
            "{}"
        }
    }

    @JavascriptInterface
    fun canDrawOverlays(): Boolean {
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
        PermissionReporter.reportStatusAsync(context)
        return granted
    }

    @JavascriptInterface
    fun requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${context.packageName}")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }
    }

    @JavascriptInterface
    fun isBatteryOptimizationIgnored(): Boolean {
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            pm.isIgnoringBatteryOptimizations(context.packageName)
        } else {
            true
        }
        PermissionReporter.reportStatusAsync(context)
        return granted
    }

    @JavascriptInterface
    fun requestIgnoreBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(context.packageName)) {
                val intent = Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:${context.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            }
        }
    }

    @JavascriptInterface
    fun hasCallPhonePermission(): Boolean {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CALL_PHONE
        ) == PackageManager.PERMISSION_GRANTED
        PermissionReporter.reportStatusAsync(context)
        return granted
    }

    @JavascriptInterface
    fun requestCallPhonePermission() {
        if (context is Activity) {
            ActivityCompat.requestPermissions(
                context,
                arrayOf(Manifest.permission.CALL_PHONE),
                1002
            )
        }
    }

    @JavascriptInterface
    fun makePhoneCall(phoneNumber: String?) {
        CallAndOverlayHelper.saveCachedPhoneNumber(context, phoneNumber)
        CallAndOverlayHelper.placeDirectCall(context, phoneNumber)
    }

    @JavascriptInterface
    fun bringAppToFront() {
        val intent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        context.startActivity(intent)
    }

    @JavascriptInterface
    fun openPermissionSetup() {
        val intent = Intent(context, PermissionSetupActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    @JavascriptInterface
    fun getAppVersion(): String {
        return "2.2.0"
    }
}
