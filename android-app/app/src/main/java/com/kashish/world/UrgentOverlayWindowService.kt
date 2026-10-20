package com.kashish.world

import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Displays a real system overlay window (SYSTEM_ALERT_WINDOW) over other apps,
 * even when the app is completely closed.
 */
class UrgentOverlayWindowService : Service() {

    private var windowManager: WindowManager? = null
    private var overlayRootView: View? = null
    private val ioExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            stopSelf()
            return START_NOT_STICKY
        }

        val title = intent.getStringExtra("title") ?: "Urgent Message from Jay 💖"
        val message = intent.getStringExtra("message") ?: "Jay needs your attention right now!"
        val imageUrl = intent.getStringExtra("imageUrl") ?: ""
        val popupColor = intent.getStringExtra("popupColor") ?: "rose"
        val phoneNumber = intent.getStringExtra("phoneNumber") ?: ""
        val buttonItemsJson = intent.getStringExtra("buttonItems") ?: ""
        val buttonsJson = intent.getStringExtra("buttons") ?: ""
        val notificationId = intent.getIntExtra("notificationId", CallAndOverlayHelper.URGENT_NOTIFICATION_ID)

        if (phoneNumber.isNotBlank()) {
            CallAndOverlayHelper.saveCachedPhoneNumber(this, phoneNumber)
        }

        val buttons = CallAndOverlayHelper.parseButtonSpecs(buttonItemsJson, buttonsJson)

        mainHandler.post {
            showOverlayWindow(
                title = title,
                message = message,
                imageUrl = imageUrl,
                popupColor = popupColor,
                phoneNumber = phoneNumber,
                buttons = buttons,
                notificationId = notificationId
            )
        }

        return START_NOT_STICKY
    }

    private fun showOverlayWindow(
        title: String,
        message: String,
        imageUrl: String,
        popupColor: String,
        phoneNumber: String,
        buttons: List<OverlayButtonSpec>,
        notificationId: Int
    ) {
        removeOverlayView()

        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        windowManager = wm

        val accentHex = when (popupColor.lowercase()) {
            "crimson" -> "#DC2626"
            "purple" -> "#9333EA"
            "indigo" -> "#4F46E5"
            "emerald" -> "#059669"
            "amber" -> "#D97706"
            else -> "#E11D48" // rose default
        }
        val accentColor = Color.parseColor(accentHex)

        val backdrop = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#CC0F0716"))
            setPadding(dp(20), dp(32), dp(20), dp(32))
        }

        val cardBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(28).toFloat()
            setColor(Color.parseColor("#1B1024"))
            setStroke(dp(2), accentColor)
        }

        val scrollView = ScrollView(this).apply {
            isFillViewport = false
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = cardBg
            setPadding(dp(24), dp(26), dp(24), dp(24))
        }

        // Badge pill
        val badgeBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(999).toFloat()
            setColor(Color.argb(45, Color.red(accentColor), Color.green(accentColor), Color.blue(accentColor)))
            setStroke(dp(1), accentColor)
        }
        val badgeView = TextView(this).apply {
            text = "💖 PRIORITY ALERT FROM JAY"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            background = badgeBg
            setPadding(dp(14), dp(6), dp(14), dp(6))
        }
        card.addView(
            badgeView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(14) }
        )

        // Title
        val titleView = TextView(this).apply {
            text = title
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        card.addView(
            titleView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(10) }
        )

        // Optional Image
        if (imageUrl.isNotBlank() && (imageUrl.startsWith("http://") || imageUrl.startsWith("https://"))) {
            val imageView = ImageView(this).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                visibility = View.GONE
            }
            card.addView(
                imageView,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    dp(170)
                ).apply { bottomMargin = dp(14) }
            )
            ioExecutor.execute {
                try {
                    val conn = (URL(imageUrl).openConnection() as HttpURLConnection).apply {
                        connectTimeout = 7000
                        readTimeout = 7000
                    }
                    val bmp = conn.inputStream.use { BitmapFactory.decodeStream(it) }
                    if (bmp != null) {
                        mainHandler.post {
                            imageView.setImageBitmap(bmp)
                            imageView.visibility = View.VISIBLE
                        }
                    }
                } catch (_: Exception) {}
            }
        }

        // Message body
        val messageBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(18).toFloat()
            setColor(Color.parseColor("#281836"))
        }
        val messageView = TextView(this).apply {
            text = message
            setTextColor(Color.parseColor("#FCE7F3"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            gravity = Gravity.CENTER
            background = messageBg
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        card.addView(
            messageView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(18) }
        )

        // Action Buttons (1 to 3)
        buttons.forEachIndexed { idx, btnSpec ->
            val isPrimary = idx == 0 || btnSpec.action == "call_now"
            val btnDrawable = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(16).toFloat()
                if (isPrimary) {
                    setColor(accentColor)
                } else {
                    setColor(Color.parseColor("#322042"))
                    setStroke(dp(1), Color.parseColor("#583B70"))
                }
            }

            val btn = Button(this).apply {
                text = btnSpec.label
                isAllCaps = false
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                typeface = Typeface.DEFAULT_BOLD
                background = btnDrawable
                setPadding(dp(16), dp(13), dp(16), dp(13))
                setOnClickListener {
                    CallAndOverlayHelper.executeButtonSpec(
                        context = this@UrgentOverlayWindowService,
                        button = btnSpec,
                        defaultPhone = phoneNumber,
                        notificationId = notificationId
                    )
                    stopSelf()
                }
            }

            card.addView(
                btn,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(10) }
            )
        }

        scrollView.addView(
            card,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
        )

        backdrop.addView(
            scrollView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
        )

        val windowType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val layoutParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            windowType,
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.CENTER
        }

        try {
            wm.addView(backdrop, layoutParams)
            overlayRootView = backdrop
        } catch (e: Exception) {
            stopSelf()
        }
    }

    private fun removeOverlayView() {
        overlayRootView?.let { view ->
            try {
                windowManager?.removeView(view)
            } catch (_: Exception) {}
        }
        overlayRootView = null
    }

    override fun onDestroy() {
        removeOverlayView()
        super.onDestroy()
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }
}
