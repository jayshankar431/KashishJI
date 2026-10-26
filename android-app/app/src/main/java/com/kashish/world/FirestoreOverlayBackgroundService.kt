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
            scheduleSilentHeartbeatAlarm(appCtx)
            try {
                val intent = Intent(appCtx, FirestoreOverlayBackgroundService::class.java)
                appCtx.startService(intent)
            } catch (e: Exception) {
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

        fun hasOverlayBeenSeenLocally(context: Context, docId: String): Boolean {
            if (docId.isBlank()) return false
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getStringSet(KEY_SEEN_OVERLAYS, emptySet())?.contains(docId) == true
        }

        fun markOverlaySeenLocally(context: Context, docId: String) {
            if (docId.isBlank()) return
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val existing = prefs.getStringSet(KEY_SEEN_OVERLAYS, emptySet())?.toMutableSet() ?: mutableSetOf()
            existing.add(docId)
            prefs.edit().putStringSet(KEY_SEEN_OVERLAYS, existing).commit()
        }

        fun hasNotificationBeenSeenLocally(context: Context, docId: String): Boolean {
            if (docId.isBlank()) return false
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getStringSet(KEY_SEEN_NOTIFS, emptySet())?.contains(docId) == true
        }

        fun markNotificationSeenLocally(context: Context, docId: String) {
            if (docId.isBlank()) return
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val existing = prefs.getStringSet(KEY_SEEN_NOTIFS, emptySet())?.toMutableSet() ?: mutableSetOf()
            existing.add(docId)
            prefs.edit().putStringSet(KEY_SEEN_NOTIFS, existing).commit()
        }

        private fun executeFirestorePatch(
            context: Context,
            urlStr: String,
            bodyJson: String,
            includeAuth: Boolean = false
        ) {
            var conn: HttpURLConnection? = null
            try {
                val token = if (includeAuth) PermissionReporter.getSavedAuthToken(context) else ""
                conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                    requestMethod = "PATCH"
                    connectTimeout = 7000
                    readTimeout = 7000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    if (token.isNotBlank()) {
                        setRequestProperty("Authorization", "Bearer $token")
                    }
                }
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use {
                    it.write(bodyJson)
                    it.flush()
                }
                val code = conn.responseCode
                if ((code == 401 || code == 403) && includeAuth && token.isNotBlank()) {
                    conn.disconnect()
                    executeFirestorePatch(context, urlStr, bodyJson, includeAuth = false)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Firestore PATCH note: ${e.message}")
            } finally {
                try {
                    conn?.disconnect()
                } catch (_: Exception) {}
            }
        }

        private fun fetchSingleDocumentFields(
            context: Context,
            collectionName: String,
            docId: String
        ): JSONObject? {
            var conn: HttpURLConnection? = null
            try {
                val urlStr = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/$collectionName/$docId"
                conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 5000
                    readTimeout = 5000
                }
                if (conn.responseCode in 200..299) {
                    val responseStr = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use {
                        it.readText()
                    }
                    return JSONObject(responseStr).optJSONObject("fields")
                }
            } catch (_: Exception) {
            } finally {
                try {
                    conn?.disconnect()
                } catch (_: Exception) {}
            }
            return null
        }

        private fun mergeUserEntryIntoClickedAction(
            context: Context,
            existingClickedAction: String,
            label: String,
            action: String
        ): String {
            if (action == "replaced_by_new_overlay") {
                return "replaced_by_new_overlay"
            }
            val rawUser = PermissionReporter.getSavedUserName(context)
                .replace("]", "")
                .replace("\n", "")
                .replace("\r", "")
                .trim()
                .ifBlank { "Kashish" }
            val cleanLabel = (if (action == "closed_x") "Closed Popup (✕)" else label.ifBlank { action })
                .replace("\n", " ")
                .replace("\r", " ")
                .trim()
            val cleanAction = action.replace("\n", "").replace("\r", "").trim().ifBlank { "dismiss" }
            val now = System.currentTimeMillis()
            val newEntry = "[USER:$rawUser]$cleanLabel:::$cleanAction@@@$now"

            val trimmedExisting = existingClickedAction.trim()
            if (trimmedExisting.isBlank() || trimmedExisting == "replaced_by_new_overlay") {
                return newEntry
            }

            val prefixLower = "[user:${rawUser.lowercase()}]"
            val keptLines = trimmedExisting
                .split("\n")
                .map { it.trim() }
                .filter {
                    it.isNotEmpty() &&
                        it != "replaced_by_new_overlay" &&
                        !it.lowercase().startsWith(prefixLower)
                }
                .toMutableList()
            keptLines.add(newEntry)
            return keptLines.joinToString("\n")
        }

        private fun hasCurrentUserRespondedInClickedAction(context: Context, rawClickedAction: String): Boolean {
            if (rawClickedAction.isBlank() || rawClickedAction == "replaced_by_new_overlay") return false
            val userNameLower = PermissionReporter.getSavedUserName(context).trim().lowercase()
            if (userNameLower.isBlank()) return false
            val prefixLower = "[user:$userNameLower]"
            return rawClickedAction
                .split("\n")
                .any { it.trim().lowercase().startsWith(prefixLower) }
        }

        private fun isDocumentTargetedToThisUser(appCtx: Context, fields: JSONObject): Boolean {
            val rawTarget = optStringField(fields, "targetUser", "ALL").trim()
            if (rawTarget.isBlank() || rawTarget.equals("ALL", ignoreCase = true)) {
                return true
            }
            val targetLower = rawTarget.lowercase()
            val targetNameLower = optStringField(fields, "targetUserName", "").trim().lowercase()
            val targetEmailLower = optStringField(fields, "targetUserEmail", "").trim().lowercase()

            val myUid = PermissionReporter.getSavedUserUid(appCtx).lowercase()
            val myEmail = PermissionReporter.getSavedUserEmail(appCtx).lowercase()
            val myEmailPrefix = myEmail.substringBefore("@")
            val myName = PermissionReporter.getSavedUserName(appCtx).lowercase()

            if (myUid.isNotBlank() && targetLower == myUid) return true
            if (myEmail.isNotBlank() && (targetLower == myEmail || (targetEmailLower.isNotBlank() && targetEmailLower == myEmail))) {
                return true
            }
            if (myEmailPrefix.isNotBlank() && (targetLower == myEmailPrefix || (targetNameLower.isNotBlank() && targetNameLower == myEmailPrefix))) {
                return true
            }
            if (myName.isNotBlank() && (
                    targetLower == myName ||
                    (targetNameLower.isNotBlank() && targetNameLower == myName) ||
                    myName.contains(targetLower) ||
                    targetLower.contains(myName)
                )
            ) {
                return true
            }
            return false
        }

        fun markOverlayDismissedInFirestore(
            context: Context,
            docId: String,
            clickedAction: String = "dismiss",
            clickedLabel: String = ""
        ) {
            if (docId.isBlank()) return
            markOverlaySeenLocally(context, docId)
            Executors.newSingleThreadExecutor().execute {
                val existingFields = fetchSingleDocumentFields(context, "overlays", docId)
                val existingClicked = if (existingFields != null) optStringField(existingFields, "clickedAction", "") else ""
                val rawTarget = if (existingFields != null) optStringField(existingFields, "targetUser", "ALL").trim() else "ALL"
                val isTargetedSingle = rawTarget.isNotBlank() && !rawTarget.equals("ALL", ignoreCase = true)

                val mergedAction = mergeUserEntryIntoClickedAction(
                    context = context,
                    existingClickedAction = existingClicked,
                    label = clickedLabel,
                    action = clickedAction
                )
                val shouldMarkDismissed = isTargetedSingle || clickedAction == "replaced_by_new_overlay"

                val urlStr = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/overlays/$docId" +
                    "?updateMask.fieldPaths=dismissed&updateMask.fieldPaths=clickedAction&updateMask.fieldPaths=seenAt"
                val body = JSONObject().apply {
                    put("fields", JSONObject().apply {
                        put("dismissed", JSONObject().put("booleanValue", shouldMarkDismissed))
                        put("clickedAction", JSONObject().put("stringValue", mergedAction))
                        put("seenAt", JSONObject().put("integerValue", System.currentTimeMillis().toString()))
                    })
                }
                executeFirestorePatch(context, urlStr, body.toString())
            }
        }

        fun markNotificationActionInFirestore(
            context: Context,
            docId: String,
            clickedAction: String,
            clickedLabel: String = ""
        ) {
            if (docId.isBlank()) return
            markNotificationSeenLocally(context, docId)
            Executors.newSingleThreadExecutor().execute {
                val existingFields = fetchSingleDocumentFields(context, "notifications", docId)
                val existingClicked = if (existingFields != null) optStringField(existingFields, "clickedAction", "") else ""
                val mergedAction = mergeUserEntryIntoClickedAction(
                    context = context,
                    existingClickedAction = existingClicked,
                    label = clickedLabel,
                    action = clickedAction
                )

                val urlStr = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/notifications/$docId" +
                    "?updateMask.fieldPaths=seen&updateMask.fieldPaths=clickedAction&updateMask.fieldPaths=seenAt"
                val body = JSONObject().apply {
                    put("fields", JSONObject().apply {
                        put("seen", JSONObject().put("booleanValue", true))
                        put("clickedAction", JSONObject().put("stringValue", mergedAction))
                        put("seenAt", JSONObject().put("integerValue", System.currentTimeMillis().toString()))
                    })
                }
                executeFirestorePatch(context, urlStr, body.toString())
            }
        }

        private fun checkLatestOverlaysFromFirestore(appCtx: Context) {
            // Never trigger overlays on the Admin's own phone
            if (PermissionReporter.getSavedUserEmail(appCtx).equals("jayshankar431@gmail.com", ignoreCase = true)) {
                return
            }

            val docs = fetchCollectionDocuments(appCtx, "overlays", pageSize = 8)
            if (docs.isEmpty()) return

            val prefs = appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val seenIds = prefs.getStringSet(KEY_SEEN_OVERLAYS, emptySet())?.toMutableSet() ?: mutableSetOf()
            val now = System.currentTimeMillis()

            for (i in docs.indices) {
                val docObj = docs[i]
                val fullName = docObj.optString("name", "")
                val docId = fullName.substringAfterLast('/')
                if (docId.isBlank() || seenIds.contains(docId)) continue

                val fields = docObj.optJSONObject("fields") ?: continue
                val dismissed = optBooleanField(fields, "dismissed", false)
                val clickedAction = optStringField(fields, "clickedAction", "")
                if (dismissed || clickedAction == "replaced_by_new_overlay") {
                    seenIds.add(docId)
                    continue
                }

                if (!isDocumentTargetedToThisUser(appCtx, fields)) {
                    continue
                }

                if (hasCurrentUserRespondedInClickedAction(appCtx, clickedAction)) {
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

                // Mark any older pending overlays in the list as seen locally on this phone so only the newest pops up
                for (j in (i + 1) until docs.size) {
                    val olderObj = docs[j]
                    val olderId = olderObj.optString("name", "").substringAfterLast('/')
                    if (olderId.isNotBlank()) {
                        seenIds.add(olderId)
                    }
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
            // Never trigger notifications on the Admin's own phone
            if (PermissionReporter.getSavedUserEmail(appCtx).equals("jayshankar431@gmail.com", ignoreCase = true)) {
                return
            }

            val docs = fetchCollectionDocuments(appCtx, "notifications", pageSize = 8)
            if (docs.isEmpty()) return

            val prefs = appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val seenIds = prefs.getStringSet(KEY_SEEN_NOTIFS, emptySet())?.toMutableSet() ?: mutableSetOf()
            val now = System.currentTimeMillis()

            for (docObj in docs) {
                val fullName = docObj.optString("name", "")
                val docId = fullName.substringAfterLast('/')
                if (docId.isBlank() || seenIds.contains(docId)) continue

                val fields = docObj.optJSONObject("fields") ?: continue
                if (!isDocumentTargetedToThisUser(appCtx, fields)) {
                    continue
                }

                val clickedAction = optStringField(fields, "clickedAction", "")
                if (hasCurrentUserRespondedInClickedAction(appCtx, clickedAction)) {
                    seenIds.add(docId)
                    continue
                }

                val rawTarget = optStringField(fields, "targetUser", "ALL").trim()
                val isTargetedSingle = rawTarget.isNotBlank() && !rawTarget.equals("ALL", ignoreCase = true)
                val seen = optBooleanField(fields, "seen", false)
                if (isTargetedSingle && seen && clickedAction.isNotBlank()) {
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
                val imageUrl = optStringField(fields, "imageUrl", "")
                val buttonsJson = extractButtonsJsonArray(fields)

                val cachedSound = SoundCacheManager.getOrDownloadSoundFile(appCtx, soundUrl)
                val channelId = SoundCacheManager.getChannelForSound(appCtx, soundUrl, cachedSound)

                mainHandler.post {
                    if (soundUrl != "silent") {
                        SoundCacheManager.playCachedSound(appCtx, cachedSound, allowDefaultFallback = true)
                    }
                    CallAndOverlayHelper.showHighPriorityBannerNotification(
                        context = appCtx,
                        title = title,
                        message = message,
                        channelId = channelId,
                        notifDocId = docId,
                        buttonItemsJson = buttonsJson,
                        phoneNumber = CallAndOverlayHelper.getCachedPhoneNumber(appCtx),
                        imageUrl = imageUrl
                    )
                }

                markNotificationSeenInFirestore(appCtx, docId)
                break
            }
        }

        private fun markNotificationSeenInFirestore(appCtx: Context, docId: String) {
            val urlStr = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/notifications/$docId" +
                "?updateMask.fieldPaths=seen&updateMask.fieldPaths=seenAt"
            val body = JSONObject().apply {
                put("fields", JSONObject().apply {
                    put("seen", JSONObject().put("booleanValue", true))
                    put("seenAt", JSONObject().put("integerValue", System.currentTimeMillis().toString()))
                })
            }
            executeFirestorePatch(appCtx, urlStr, body.toString())
        }

        private fun fetchCollectionDocuments(
            appCtx: Context,
            collectionName: String,
            pageSize: Int,
            includeAuth: Boolean = true
        ): List<JSONObject> {
            val result = mutableListOf<JSONObject>()
            var conn: HttpURLConnection? = null
            try {
                val url = URL(
                    "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents:runQuery"
                )
                val token = if (includeAuth) PermissionReporter.getSavedAuthToken(appCtx) else ""
                conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 7000
                    readTimeout = 7000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
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

                val code = conn.responseCode
                if ((code == 401 || code == 403) && includeAuth && token.isNotBlank()) {
                    conn.disconnect()
                    return fetchCollectionDocuments(appCtx, collectionName, pageSize, includeAuth = false)
                }

                if (code in 200..299) {
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
        scheduleSilentHeartbeatAlarm(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        clearLegacyPermanentNotification(applicationContext)
        ensureWatcherRunning(applicationContext)
        scheduleSilentHeartbeatAlarm(applicationContext)
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        // Keep watching silently even if user swipes the app away from Recents
        ensureWatcherRunning(applicationContext)
        scheduleSilentHeartbeatAlarm(applicationContext)
    }

    override fun onDestroy() {
        scheduleSilentHeartbeatAlarm(applicationContext)
        super.onDestroy()
    }
}
