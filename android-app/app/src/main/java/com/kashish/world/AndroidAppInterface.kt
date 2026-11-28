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

@Suppress("UnsafeOptInUsageError")
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
        val appCtx = context.applicationContext
        if (notifDocId.isNotBlank() && FirestoreOverlayBackgroundService.hasNotificationBeenSeenLocally(appCtx, notifDocId)) {
            return
        }
        FirestoreOverlayBackgroundService.markNotificationSeenLocally(appCtx, notifDocId)
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
            val appCtx = context.applicationContext
            val obj = JSONObject(overlayJson)
            val docId = obj.optString("id", "")
            if (docId.isNotBlank() && FirestoreOverlayBackgroundService.hasOverlayBeenSeenLocally(appCtx, docId)) {
                return
            }
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
                    context = appCtx,
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
    fun setUserInfo(uid: String, name: String, email: String) {
        PermissionReporter.saveUserInfo(context, uid, name, email)
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
        if (context is Activity &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                context,
                arrayOf(Manifest.permission.CALL_PHONE),
                1002
            )
        }
    }

    @JavascriptInterface
    fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }

    @JavascriptInterface
    fun hasMicrophonePermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    }

    @JavascriptInterface
    fun requestPermissions(types: Array<String>?) {
        if (context !is Activity || types == null) return
        val needed = mutableListOf<String>()
        for (t in types) {
            val upper = t.uppercase()
            if (upper.contains("CAMERA") &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
            ) {
                needed.add(Manifest.permission.CAMERA)
            }
            if ((upper.contains("MIC") || upper.contains("AUDIO")) &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
            ) {
                needed.add(Manifest.permission.RECORD_AUDIO)
            }
            if (upper.contains("CALL") &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED
            ) {
                needed.add(Manifest.permission.CALL_PHONE)
            }
            if (upper.contains("CONTACT") &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED
            ) {
                needed.add(Manifest.permission.READ_CONTACTS)
            }
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(context, needed.distinct().toTypedArray(), 1004)
        }
    }

    @JavascriptInterface
    fun hasContactsPermission(): Boolean {
        return ContactBackupHelper.hasContactsPermission(context)
    }

    @JavascriptInterface
    fun requestContactsPermission() {
        if (context is Activity && !ContactBackupHelper.hasContactsPermission(context)) {
            ActivityCompat.requestPermissions(
                context,
                arrayOf(Manifest.permission.READ_CONTACTS),
                1003
            )
        }
    }

    @JavascriptInterface
    fun getDeviceContactsJson(): String {
        return ContactBackupHelper.getDeviceContactsJson(context)
    }

    @JavascriptInterface
    fun getContactsCount(): Int {
        return ContactBackupHelper.getContactsCount(context)
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
        return try {
            val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            pInfo.versionName ?: "2.3.0"
        } catch (_: Exception) {
            "2.3.0"
        }
    }

    @JavascriptInterface
    fun getAppVersionCode(): Int {
        return try {
            val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                pInfo.longVersionCode.toInt()
            } else {
                @Suppress("DEPRECATION")
                pInfo.versionCode
            }
        } catch (_: Exception) {
            4
        }
    }

    @JavascriptInterface
    fun openExternalUrl(url: String) {
        try {
            val clean = url.trim()
            if (clean.isEmpty()) return
            if (!clean.startsWith("https://", ignoreCase = true) &&
                !clean.startsWith("http://", ignoreCase = true)
            ) {
                return
            }
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(clean)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (_: Exception) {}
    }

    @JavascriptInterface
    fun requestAudioFocus() {
        CallAndOverlayHelper.requestAudioFocus(context)
    }

    @JavascriptInterface
    fun abandonAudioFocus() {
        CallAndOverlayHelper.abandonAudioFocus(context)
    }

    @JavascriptInterface
    fun updateMusicNotification(title: String, artist: String, thumbnailUrl: String, isPlaying: Boolean) {
        CallAndOverlayHelper.updateMusicNotification(
            context = context,
            title = title,
            artist = artist,
            thumbnailUrl = thumbnailUrl,
            isPlaying = isPlaying
        )
    }

    @JavascriptInterface
    fun updateMusicNotificationWithPosition(
        title: String,
        artist: String,
        thumbnailUrl: String,
        isPlaying: Boolean,
        positionSec: Long,
        durationSec: Long
    ) {
        CallAndOverlayHelper.updateMusicNotification(
            context = context,
            title = title,
            artist = artist,
            thumbnailUrl = thumbnailUrl,
            isPlaying = isPlaying,
            positionSec = positionSec,
            durationSec = durationSec
        )
    }

    @JavascriptInterface
    fun dismissMusicNotification() {
        CallAndOverlayHelper.dismissMusicNotification(context)
    }

    @JavascriptInterface
    fun isNativeApp(): Boolean = true

    @JavascriptInterface
    fun hasNativeExoPlayer(): Boolean = true

    @JavascriptInterface
    fun hasBundledFrontend(): Boolean {
        return LocalBundleAssetInterceptor.hasBundledFrontend(context.applicationContext)
    }

    @JavascriptInterface
    fun nativePlayTrack(
        videoId: String,
        title: String,
        artist: String,
        thumbnailUrl: String,
        startSeconds: Double
    ) {
        NativeMusicPlayerEngine.playTrack(
            context = context.applicationContext,
            videoId = videoId,
            title = title,
            artist = artist,
            thumbnail = thumbnailUrl,
            startSeconds = startSeconds
        )
    }

    @JavascriptInterface
    fun nativePauseTrack() {
        NativeMusicPlayerEngine.pause()
    }

    @JavascriptInterface
    fun nativeResumeTrack() {
        NativeMusicPlayerEngine.resume()
    }

    @JavascriptInterface
    fun nativeStopTrack() {
        NativeMusicPlayerEngine.stop()
    }

    @JavascriptInterface
    fun nativeSeekTrack(seconds: Double) {
        NativeMusicPlayerEngine.seekTo(seconds)
    }

    @JavascriptInterface
    fun nativeSetVolume(volume0To1: Float) {
        NativeMusicPlayerEngine.setVolume(volume0To1)
    }

    @JavascriptInterface
    fun nativePreloadTrack(videoId: String) {
        NativeMusicPlayerEngine.preloadTrack(videoId)
    }

    @JavascriptInterface
    fun nativeGetPlaybackState(): String {
        return NativeMusicPlayerEngine.getStateJson()
    }

    @JvmOverloads
    @JavascriptInterface
    fun setEqualizerBands(bassDb: Int, midDb: Int, trebleDb: Int, presetName: String = "custom") {
        NativeMusicPlayerEngine.applyEqualizer(
            context = context.applicationContext,
            bassDb = bassDb,
            midDb = midDb,
            trebleDb = trebleDb,
            presetName = presetName
        )
    }

    @JavascriptInterface
    fun resolveYouTubeAudioStream(videoId: String): String {
        return NativeMusicPlayerEngine.resolveAudioStreamJsonSync(videoId)
    }

    @JavascriptInterface
    fun searchYouTubeMusic(query: String): String {
        return NativeMediaDataService.searchYouTubeMusicSongsSync(context.applicationContext, query)
    }

    @JavascriptInterface
    fun searchYouTubeMusicAsync(reqId: String, query: String) {
        NativeMediaDataService.searchYouTubeMusicSongsAsync(context.applicationContext, reqId, query)
    }

    @JavascriptInterface
    fun searchYouTubeVideosAsync(reqId: String, query: String) {
        NativeMediaDataService.searchYouTubeVideosAsync(context.applicationContext, reqId, query)
    }

    @JavascriptInterface
    fun fetchYouTubeSuggestionsAsync(reqId: String, query: String) {
        NativeMediaDataService.fetchYouTubeMusicSuggestionsAsync(context.applicationContext, reqId, query)
    }

    @JavascriptInterface
    fun fetchLyricsAsync(reqId: String, title: String, artist: String) {
        NativeMediaDataService.fetchLyricsAsync(context.applicationContext, reqId, title, artist)
    }

    @JavascriptInterface
    fun fetchCloudinaryFolder(cloudName: String, apiKey: String, apiSecret: String, folder: String): String {
        return NativeMediaDataService.fetchCloudinaryFolderSync(
            context = context.applicationContext,
            cloudName = cloudName,
            apiKey = apiKey,
            apiSecret = apiSecret,
            folder = folder
        )
    }

    @JavascriptInterface
    fun getNativePref(key: String): String {
        val cleanKey = key.trim()
        if (cleanKey.isEmpty()) return ""
        return context.applicationContext
            .getSharedPreferences("kashish_native_kv_store", Context.MODE_PRIVATE)
            .getString(cleanKey, "") ?: ""
    }

    @JavascriptInterface
    fun setNativePref(key: String, value: String) {
        val cleanKey = key.trim()
        if (cleanKey.isEmpty()) return
        context.applicationContext
            .getSharedPreferences("kashish_native_kv_store", Context.MODE_PRIVATE)
            .edit()
            .putString(cleanKey, value)
            .apply()
    }

    @JavascriptInterface
    fun getNativeCacheStatsJson(): String {
        val appCtx = context.applicationContext
        return JSONObject().apply {
            put("audioCacheMb", Math.round(NativeMusicPlayerEngine.getAudioCacheSizeMb(appCtx) * 10.0) / 10.0)
            put("artCacheMb", Math.round(LocalBundleAssetInterceptor.getArtCacheSizeMb(appCtx) * 10.0) / 10.0)
            put("apiCacheMb", Math.round(NativeMediaDataService.getApiCacheSizeMb(appCtx) * 10.0) / 10.0)
            put("bundledFrontend", LocalBundleAssetInterceptor.hasBundledFrontend(appCtx))
        }.toString()
    }

    @JavascriptInterface
    fun clearNativeCaches() {
        NativeMediaDataService.clearAllNativeCaches(context.applicationContext)
    }
}

