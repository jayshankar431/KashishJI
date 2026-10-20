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
 * First-launch Permission Setup Screen with buttons that open:
 * 1. Notifications
 * 2. Display over other apps (SYSTEM_ALERT_WINDOW)
 * 3. Call phone (CALL_PHONE for direct calling without dialer)
 * 4. Battery "No restriction" (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
 * 5. Autostart (Realme/ColorOS, Oppo, Xiaomi, Vivo intents, with safe fallback to App Details settings)
 * Shows a green tick (✅) when granted and reports permission status to Firestore.
 */
class PermissionSetupActivity : AppCompatActivity() {

    private lateinit var rowsContainer: LinearLayout

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
        buildLayout()
    }

    override fun onResume() {
        super.onResume()
        refreshUiAndReport()
    }

    private fun buildLayout() {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#12071A"))
            isFillViewport = true
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(36), dp(20), dp(32))
        }

        val headerBadge = TextView(this).apply {
            text = "💖 KASHISH'S WORLD SETUP"
            setTextColor(Color.parseColor("#FB7185"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
        }
        root.addView(headerBadge)

        val title = TextView(this).apply {
            text = "One-Time Permission Setup"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, dp(6), 0, dp(6))
        }
        root.addView(title)

        val subtitle = TextView(this).apply {
            text = "Enable these 5 permissions so Jay's instant love alerts, popups, and direct 1-tap calls work even when the phone is locked."
            setTextColor(Color.parseColor("#D8B4E2"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
            setPadding(0, 0, 0, dp(20))
        }
        root.addView(subtitle)

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

        val continueBtnBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(18).toFloat()
            setColor(Color.parseColor("#E11D48"))
        }

        val continueBtn = Button(this).apply {
            text = "Continue to Kashish's World 💖"
            isAllCaps = false
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            typeface = Typeface.DEFAULT_BOLD
            background = continueBtnBg
            setPadding(dp(20), dp(14), dp(20), dp(14))
            setOnClickListener {
                PermissionReporter.markFirstLaunchSetupCompleted(this@PermissionSetupActivity)
                PermissionReporter.reportStatusAsync(this@PermissionSetupActivity)
                finish()
            }
        }

        root.addView(
            continueBtn,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(20) }
        )

        scroll.addView(root)
        setContentView(scroll)
    }

    private fun refreshUiAndReport() {
        val snap = PermissionReporter.collectSnapshot(this)
        rowsContainer.removeAllViews()

        // 1. Notifications
        rowsContainer.addView(
            createPermissionCard(
                title = "1. Notifications",
                subtitle = "Receive high-priority messages & custom sounds from Jay",
                granted = snap.notifications,
                buttonLabel = if (snap.notifications) "Granted ✅" else "Allow Notifications",
                onClick = { openNotificationPermission() }
            )
        )

        // 2. Display over other apps
        rowsContainer.addView(
            createPermissionCard(
                title = "2. Display Over Other Apps",
                subtitle = "Show urgent popups over other apps even when closed",
                granted = snap.overlay,
                buttonLabel = if (snap.overlay) "Granted ✅" else "Enable Overlay",
                onClick = { openOverlayPermissionSettings() }
            )
        )

        // 3. Call Phone
        rowsContainer.addView(
            createPermissionCard(
                title = "3. Direct Phone Call",
                subtitle = "'Call Right Now' places the call directly without dialer",
                granted = snap.callPhone,
                buttonLabel = if (snap.callPhone) "Granted ✅" else "Allow Call Phone",
                onClick = { openCallPhonePermission() }
            )
        )

        // 4. Battery "No restriction"
        rowsContainer.addView(
            createPermissionCard(
                title = "4. Battery 'No Restriction'",
                subtitle = "Prevent Realme/Android from killing background alerts",
                granted = snap.batteryUnrestricted,
                buttonLabel = if (snap.batteryUnrestricted) "Granted ✅" else "Set Unrestricted",
                onClick = { openBatteryUnrestrictedSettings() }
            )
        )

        // 5. Autostart (Realme/ColorOS, Oppo, Xiaomi, Vivo + safe fallback)
        rowsContainer.addView(
            createPermissionCard(
                title = "5. Autostart / Background Launch",
                subtitle = "Realme/ColorOS, Oppo, Xiaomi, Vivo autostart setting",
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
            cornerRadius = dp(20).toFloat()
            setColor(cardBgColor)
            setStroke(dp(1), borderColor)
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = cardBg
            setPadding(dp(16), dp(16), dp(16), dp(16))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
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
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15.5f)
            typeface = Typeface.DEFAULT_BOLD
        }
        val subView = TextView(this).apply {
            text = subtitle
            setTextColor(Color.parseColor("#C4B5FD"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
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
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
            typeface = Typeface.DEFAULT_BOLD
            background = btnBg
            setPadding(dp(14), dp(8), dp(14), dp(8))
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

    /**
     * Tries Realme/ColorOS, Oppo, Xiaomi, and Vivo autostart manager intents in order,
     * with a safe fallback to the system App Details page.
     */
    private fun openOemAutostartSettings() {
        PermissionReporter.markAutostartConfigured(this)

        val oemIntents = listOf(
            // Realme / ColorOS / Oppo
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
            // Xiaomi / MIUI / HyperOS
            Intent().setComponent(
                ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"
                )
            ),
            // Vivo / iQOO / FuntouchOS
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

        // Safe fallback to the app settings page
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
