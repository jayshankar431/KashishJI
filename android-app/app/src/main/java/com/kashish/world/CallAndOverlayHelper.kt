package com.kashish.world

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.telecom.TelecomManager
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONArray

data class OverlayButtonSpec(
    val label: String,
    val action: String, // "call_now" | "call_later" | "open_url" | "open_section"
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
        notificationId: Int = URGENT_NOTIFICATION_ID
    ) {
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
                // "call_later" or dismiss
                dismissPopupAndNotification(context, notificationId)
            }
        }
    }

    fun parseButtonSpecs(buttonItemsJson: String?, buttonsJson: String?): List<OverlayButtonSpec> {
        val result = mutableListOf<OverlayButtonSpec>()
        if (!buttonItemsJson.isNullOrBlank()) {
            try {
                val arr = JSONArray(buttonItemsJson)
                for (i in 0 until minOf(arr.length(), 3)) {
                    val obj = arr.optJSONObject(i) ?: continue
                    val label = obj.optString("label", "").trim()
                    val action = obj.optString("action", "call_later").trim()
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
                    val label = arr.optString(i, "").trim()
                    if (label.isNotEmpty()) {
                        val lower = label.lowercase()
                        val action = if (lower.contains("call") && !lower.contains("later")) {
                            "call_now"
                        } else {
                            "call_later"
                        }
                        result.add(OverlayButtonSpec(label, action, ""))
                    }
                }
            } catch (_: Exception) {}
        }

        if (result.isEmpty()) {
            result.add(OverlayButtonSpec("Call Right Now 📞", "call_now", ""))
            result.add(OverlayButtonSpec("Call Later ⏳", "call_later", ""))
        }
        return result
    }
}
