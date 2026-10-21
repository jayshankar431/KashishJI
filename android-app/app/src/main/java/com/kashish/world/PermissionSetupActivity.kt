package com.kashish.world

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * First-launch Permission Setup Screen with 1-tap buttons for:
 * 1. Display Over Other Apps (SYSTEM_ALERT_WINDOW - Truecaller style popup over Instagram/WhatsApp)
 * 2. Full-Screen Lockscreen Wakeup (USE_FULL_SCREEN_INTENT + WakeLock - turns screen ON when locked)
 * 3. Notifications (POST_NOTIFICATIONS)
 * 4. Direct Phone Call (CALL_PHONE)
 * 5. Battery "No Restriction" (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
 * 6. Autostart / Background Launch (Realme/ColorOS, Oppo, Xiaomi, Vivo)
 */
class PermissionSetupActivity : AppCompatActivity() {

    private lateinit var rowsContainer: LinearLayout
    private lateinit var continueBtn: Button
    private lateinit var continueBtnBg: GradientDrawable
    private lateinit var progressStatusView: TextView

    private val notificationPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        refreshUiAndReport()
    }

    private val callPhonePermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        refreshUiAndReport()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SoundCacheManager.ensureDefaultChannels(this)
        FirestoreOverlayBackgroundService.startServiceSafely(this)
        buildLayout()
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
            // Prevent bypassing the permission gate with the hardware Back button; minimize app to Home instead
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
            text = "💖 KASHISHHH · REQUIRED PERMISSIONS"
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
            text = "Please allow all 6 permissions below so Truecaller-style love popups, lock-screen wakeup, notifications, and 1-tap calls work smoothly. The Continue button will unlock automatically once all 6 are allowed."
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
            setPadding(0, 0, 0, dp(14))
        }
        root.addView(progressStatusView)

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

        // Test Truecaller Overlay Button
        val testBtnBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(16).toFloat()
            setColor(Color.parseColor("#2A133D"))
            setStroke(dp(1), Color.parseColor("#F472B6"))
        }
        val testBtn = Button(this).apply {
            text = "✨ Preview Truecaller Love Popup Now"
            isAllCaps = false
            setTextColor(Color.parseColor("#FCE7F3"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.DEFAULT_BOLD
            background = testBtnBg
            setPadding(dp(16), dp(12), dp(16), dp(12))
            setOnClickListener {
                CallAndOverlayHelper.triggerTruecallerOverlay(
                    context = this@PermissionSetupActivity,
                    title = "Thinking of You, Kashish 💖",
                    message = "Truecaller-style SYSTEM_ALERT_WINDOW + WakeLock popup is active and ready!",
                    theme = "velvet-rose",
                    fontStyle = "romantic-serif"
                )
            }
        }
        root.addView(
            testBtn,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(10) }
        )

        continueBtnBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(18).toFloat()
            setColor(Color.parseColor("#3B234A"))
        }

        continueBtn = Button(this).apply {
            text = "🔒 Allow All 6 Permissions to Continue"
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
                        "Please allow all 6 permissions above first 💖",
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

        val checks = listOf(
            snap.overlay,
            snap.fullScreenIntent,
            snap.notifications,
            snap.callPhone,
            snap.batteryUnrestricted,
            snap.autostartConfigured
        )
        val grantedCount = checks.count { it }
        val totalCount = checks.size
        val allGranted = snap.allRequiredGranted

        if (allGranted) {
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

        // 1. Display over other apps (SYSTEM_ALERT_WINDOW)
        rowsContainer.addView(
            createPermissionCard(
                title = "1. Display Over Other Apps (Truecaller Popup)",
                subtitle = "SYSTEM_ALERT_WINDOW · Shows popup card over Instagram, WhatsApp & Lock Screen",
                granted = snap.overlay,
                buttonLabel = if (snap.overlay) "Allowed ✅" else "Allow On Top",
                onClick = { openOverlayPermissionSettings() }
            )
        )

        // 2. Full-Screen Lockscreen Wakeup (USE_FULL_SCREEN_INTENT + WakeLock)
        rowsContainer.addView(
            createPermissionCard(
                title = "2. Lock-Screen Light-Up (WakeLock + Full Screen)",
                subtitle = "USE_FULL_SCREEN_INTENT · Automatically turns screen ON when phone is locked",
                granted = snap.fullScreenIntent,
                buttonLabel = if (snap.fullScreenIntent) "Active ✅" else "Enable Wakeup",
                onClick = { openFullScreenIntentSettings() }
            )
        )

        // 3. Notifications
        rowsContainer.addView(
            createPermissionCard(
                title = "3. High-Priority Notifications",
                subtitle = "Receive instant messages & custom sounds from Jay",
                granted = snap.notifications,
                buttonLabel = if (snap.notifications) "Granted ✅" else "Allow Alerts",
                onClick = { openNotificationPermission() }
            )
        )

        // 4. Call Phone
        rowsContainer.addView(
            createPermissionCard(
                title = "4. Direct 1-Tap Phone Call",
                subtitle = "'Call Right Now' places the call directly without opening dialer",
                granted = snap.callPhone,
                buttonLabel = if (snap.callPhone) "Granted ✅" else "Allow Call",
                onClick = { openCallPhonePermission() }
            )
        )

        // 5. Battery "No restriction"
        rowsContainer.addView(
            createPermissionCard(
                title = "5. Battery 'No Restriction' (24/7 Background Service)",
                subtitle = "Keeps Firebase Overlay Background Service running when app is closed",
                granted = snap.batteryUnrestricted,
                buttonLabel = if (snap.batteryUnrestricted) "Unrestricted ✅" else "Allow Background",
                onClick = { openBatteryUnrestrictedSettings() }
            )
        )

        // 6. Autostart (Realme/ColorOS, Oppo, Xiaomi, Vivo + safe fallback)
        rowsContainer.addView(
            createPermissionCard(
                title = "6. Autostart / Background Launch",
                subtitle = "Realme/ColorOS, Oppo, Xiaomi, Vivo background popup permission",
                granted = snap.autostartConfigured,
                buttonLabel = if (snap.autostartConfigured) "Configured ✅" else "Open Autostart",
                onClick = { openOemAutostartSettings() }
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

    private fun openNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            try {
                val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                }
                startActivity(intent)
            } catch (_: Exception) {
                openAppDetailsFallback()
            }
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

    private fun openCallPhonePermission() {
        callPhonePermLauncher.launch(Manifest.permission.CALL_PHONE)
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

    private fun openOemAutostartSettings() {
        PermissionReporter.markAutostartConfigured(this)

        val oemIntents = listOf(
            Intent().setComponent(
                ComponentName(
                    "com.coloros.safecenter",
                    "com.coloros.safecenter.permission.startup.StartupAppListActivity"
                )
            ),
            Intent().setComponent(
                ComponentName(
                    "com.coloros.safecenter",
                    "com.coloros.safecenter.startupapp.StartupAppListActivity"
                )
            ),
            Intent().setComponent(
                ComponentName(
                    "com.oplus.safecenter",
                    "com.oplus.safecenter.permission.startup.StartupAppListActivity"
                )
            ),
            Intent().setComponent(
                ComponentName(
                    "com.oppo.safe",
                    "com.oppo.safe.permission.startup.StartupAppListActivity"
                )
            ),
            Intent().setComponent(
                ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"
                )
            ),
            Intent().setComponent(
                ComponentName(
                    "com.iqoo.secure",
                    "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"
                )
            ),
            Intent().setComponent(
                ComponentName(
                    "com.vivo.permissionmanager",
                    "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"
                )
            ),
            Intent().setComponent(
                ComponentName(
                    "com.iqoo.secure",
                    "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"
                )
            )
        )

        for (candidate in oemIntents) {
            try {
                candidate.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (packageManager.resolveActivity(candidate, 0) != null) {
                    startActivity(candidate)
                    refreshUiAndReport()
                    return
                }
            } catch (_: Exception) {}
        }

        openAppDetailsFallback()
        refreshUiAndReport()
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
