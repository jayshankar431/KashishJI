package com.kashish.world

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
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
 * Truecaller-Style Firebase Background Service:
 * Runs continuously in the background (even when Kashish is using Instagram, WhatsApp,
 * or when the phone screen is locked/off) and watches the Firestore `overlays` and `notifications`
 * collections in real time.
 *
 * As soon as Admin sends a new popup in the `overlays` collection:
 * 1. Acquires a Screen-On WakeLock (PowerManager.ACQUIRE_CAUSES_WAKEUP) to light up the screen.
 * 2. Displays the romantic popup card over any app using SYSTEM_ALERT_WINDOW ("Display over other apps").
 * 3. Triggers USE_FULL_SCREEN_INTENT so lock-screen wakeup works on all Android versions.
 */
class FirestoreOverlayBackgroundService : Service() {

    companion object {
        private const val TAG = "FirestoreBgService"
        private const val BG_CHANNEL_ID = "kashish_bg_listener_channel"
        private const val BG_NOTIFICATION_ID = 7701
        private const val PREFS_NAME = "kashish_bg_seen_prefs"
        private const val KEY_SEEN_OVERLAYS = "seen_overlay_ids"
        private const val KEY_SEEN_NOTIFS = "seen_notif_ids"
        private const val FIREBASE_PROJECT_ID = "kashishji"

        @Volatile
        var isRunning: Boolean = false
            private set

        fun startServiceSafely(context: Context) {
            try {
                val appCtx = context.applicationContext
                val intent = Intent(appCtx, FirestoreOverlayBackgroundService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    appCtx.startForegroundService(intent)
                } else {
                    appCtx.startService(intent)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not start FirestoreOverlayBackgroundService: ${e.message}")
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
    }

    private var scheduler: ScheduledExecutorService? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        startInForeground()
        startFirestoreWatcherLoop()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        isRunning = true
        startInForeground()
        if (scheduler == null || scheduler?.isShutdown == true) {
            startFirestoreWatcherLoop()
        }
        return START_STICKY
    }

    private fun startInForeground() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                val channel = NotificationChannel(
                    BG_CHANNEL_ID,
                    "Kashish Live Connection 💖",
                    NotificationManager.IMPORTANCE_MIN
                ).apply {
                    description = "Keeps Jay's instant Truecaller-style love popups active in background"
                    setShowBadge(false)
                    lockscreenVisibility = Notification.VISIBILITY_SECRET
                }
                nm.createNotificationChannel(channel)
            }

            val openIntent = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
            val pendingIntent = PendingIntent.getActivity(this, 7702, openIntent, pendingFlags)

            val notification = NotificationCompat.Builder(this, BG_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("Kashish's World Connected 💖")
                .setContentText("Listening for Jay's special notes & popups")
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setOngoing(true)
                .setSilent(true)
                .setContentIntent(pendingIntent)
                .build()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    BG_NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } else {
                startForeground(BG_NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Foreground start note: ${e.message}")
        }
    }

    private fun startFirestoreWatcherLoop() {
        scheduler?.shutdownNow()
        val exec = Executors.newSingleThreadScheduledExecutor()
        scheduler = exec
        exec.scheduleWithFixedDelay(
            {
                try {
                    checkLatestOverlaysFromFirestore()
                    checkLatestNotificationsFromFirestore()
                } catch (e: Exception) {
                    Log.w(TAG, "Poll cycle note: ${e.message}")
                }
            },
            1L,
            4L,
            TimeUnit.SECONDS
        )
    }

    private fun checkLatestOverlaysFromFirestore() {
        val docs = fetchCollectionDocuments("overlays", pageSize = 8)
        if (docs.isEmpty()) return

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
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

            // Wait until scheduledFor time if scheduled in the future
            if (scheduledFor > now) continue

            // Only display overlays created within the last 24 hours
            if (createdAt > 0L && (now - createdAt) > 86_400_000L) {
                seenIds.add(docId)
                continue
            }

            // Mark seen immediately so we don't duplicate
            seenIds.add(docId)
            prefs.edit().putStringSet(KEY_SEEN_OVERLAYS, seenIds).apply()

            val title = optStringField(fields, "title", "A Special Note For Kashish 💖")
            val message = optStringField(fields, "message", "Thinking of you right now!")
            val imageUrl = optStringField(fields, "imageUrl", "")
            val theme = optStringField(fields, "theme", "velvet-rose")
            val fontStyle = optStringField(fields, "fontStyle", "romantic-serif")
            val buttonsJson = extractButtonsJsonArray(fields)

            mainHandler.post {
                CallAndOverlayHelper.triggerTruecallerOverlay(
                    context = applicationContext,
                    overlayDocId = docId,
                    title = title,
                    message = message,
                    imageUrl = imageUrl,
                    theme = theme,
                    fontStyle = fontStyle,
                    buttonItemsJson = buttonsJson,
                    phoneNumber = CallAndOverlayHelper.getCachedPhoneNumber(applicationContext)
                )
            }
            break
        }
    }

    private fun checkLatestNotificationsFromFirestore() {
        val docs = fetchCollectionDocuments("notifications", pageSize = 6)
        if (docs.isEmpty()) return

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
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

            val cachedSound = SoundCacheManager.getOrDownloadSoundFile(applicationContext, soundUrl)
            val channelId = SoundCacheManager.getChannelForSound(applicationContext, soundUrl, cachedSound)
            SoundCacheManager.playCachedSound(applicationContext, cachedSound)

            CallAndOverlayHelper.showHighPriorityBannerNotification(
                context = applicationContext,
                title = title,
                message = message,
                channelId = channelId
            )

            // Mark seen in Firestore
            markNotificationSeenInFirestore(docId)
            break
        }
    }

    private fun markNotificationSeenInFirestore(docId: String) {
        try {
            val urlStr = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/notifications/$docId" +
                "?updateMask.fieldPaths=seen&updateMask.fieldPaths=seenAt"
            val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                requestMethod = "PATCH"
                connectTimeout = 6000
                readTimeout = 6000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                val token = PermissionReporter.getSavedAuthToken(applicationContext)
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

    private fun fetchCollectionDocuments(collectionName: String, pageSize: Int): List<JSONObject> {
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
                val token = PermissionReporter.getSavedAuthToken(applicationContext)
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

    override fun onDestroy() {
        isRunning = false
        scheduler?.shutdownNow()
        scheduler = null
        super.onDestroy()
    }
}
