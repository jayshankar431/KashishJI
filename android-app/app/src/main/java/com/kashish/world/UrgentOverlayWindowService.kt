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
 * Truecaller-Style System Overlay Service (SYSTEM_ALERT_WINDOW):
 * Displays a romantic popup card directly over other apps (Instagram, WhatsApp, YouTube, Lock Screen)
 * even when Kashish's World is closed or in the background, and lights up the screen via WakeLock.
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

        // Immediately wake up the screen so it lights up even if phone was locked/idle
        CallAndOverlayHelper.wakeUpScreenImmediately(this, 18_000L)

        val overlayDocId = intent.getStringExtra("overlayDocId") ?: ""
        val title = intent.getStringExtra("title") ?: "Thinking of You 💖"
        val message = intent.getStringExtra("message") ?: "Jay sent you a special note right now!"
        val imageUrl = intent.getStringExtra("imageUrl") ?: ""
        val theme = intent.getStringExtra("theme")
            ?: intent.getStringExtra("popupColor")
            ?: "velvet-rose"
        val fontStyle = intent.getStringExtra("fontStyle") ?: "romantic-serif"
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
                overlayDocId = overlayDocId,
                title = title,
                message = message,
                imageUrl = imageUrl,
                theme = theme,
                fontStyle = fontStyle,
                phoneNumber = phoneNumber,
                buttons = buttons,
                notificationId = notificationId
            )
        }

        return START_NOT_STICKY
    }

    private data class NativeOverlayPalette(
        val cardColors: IntArray,
        val borderColor: Int,
        val kickerColor: Int,
        val titleColor: Int,
        val bodyColor: Int,
        val quoteBgColor: Int,
        val primaryBtnColors: IntArray,
        val secondaryBtnBg: Int,
        val secondaryBtnText: Int,
        val badgeBgColor: Int
    )

    private fun resolvePalette(themeKey: String): NativeOverlayPalette {
        return when (themeKey.lowercase()) {
            "golden-letter", "amber" -> NativeOverlayPalette(
                cardColors = intArrayOf(Color.parseColor("#261509"), Color.parseColor("#160B04"), Color.parseColor("#2B1708")),
                borderColor = Color.parseColor("#66FBBF24"),
                kickerColor = Color.parseColor("#FCD34D"),
                titleColor = Color.parseColor("#FFFBEB"),
                bodyColor = Color.parseColor("#FEF3C7"),
                quoteBgColor = Color.parseColor("#1AFBBF24"),
                primaryBtnColors = intArrayOf(Color.parseColor("#F59E0B"), Color.parseColor("#D97706")),
                secondaryBtnBg = Color.parseColor("#22FBBF24"),
                secondaryBtnText = Color.parseColor("#FEF3C7"),
                badgeBgColor = Color.parseColor("#33F59E0B")
            )
            "soft-blush" -> NativeOverlayPalette(
                cardColors = intArrayOf(Color.parseColor("#FFF5F8"), Color.parseColor("#FFE6F0"), Color.parseColor("#FFF0F5")),
                borderColor = Color.parseColor("#55D6336C"),
                kickerColor = Color.parseColor("#BE185D"),
                titleColor = Color.parseColor("#4A0E27"),
                bodyColor = Color.parseColor("#5C1634"),
                quoteBgColor = Color.parseColor("#15D6336C"),
                primaryBtnColors = intArrayOf(Color.parseColor("#E11D48"), Color.parseColor("#BE185D")),
                secondaryBtnBg = Color.parseColor("#1AD6336C"),
                secondaryBtnText = Color.parseColor("#4A0E27"),
                badgeBgColor = Color.parseColor("#24E11D48")
            )
            "starlight-night", "indigo", "purple" -> NativeOverlayPalette(
                cardColors = intArrayOf(Color.parseColor("#111827"), Color.parseColor("#1E1B4B"), Color.parseColor("#191332")),
                borderColor = Color.parseColor("#59C4B5FD"),
                kickerColor = Color.parseColor("#C4B5FD"),
                titleColor = Color.parseColor("#F5F3FF"),
                bodyColor = Color.parseColor("#EDE9FE"),
                quoteBgColor = Color.parseColor("#1AC4B5FD"),
                primaryBtnColors = intArrayOf(Color.parseColor("#8B5CF6"), Color.parseColor("#EC4899")),
                secondaryBtnBg = Color.parseColor("#1FFFFFFF"),
                secondaryBtnText = Color.parseColor("#EDE9FE"),
                badgeBgColor = Color.parseColor("#338B5CF6")
            )
            else -> NativeOverlayPalette( // "velvet-rose" default
                cardColors = intArrayOf(Color.parseColor("#260E36"), Color.parseColor("#150722"), Color.parseColor("#2B0F2E")),
                borderColor = Color.parseColor("#66F472B6"),
                kickerColor = Color.parseColor("#F9A8D4"),
                titleColor = Color.parseColor("#FFF1F2"),
                bodyColor = Color.parseColor("#FCE7F3"),
                quoteBgColor = Color.parseColor("#14FFFFFF"),
                primaryBtnColors = intArrayOf(Color.parseColor("#F43F5E"), Color.parseColor("#DB2777")),
                secondaryBtnBg = Color.parseColor("#1FFFFFFF"),
                secondaryBtnText = Color.parseColor("#FCE7F3"),
                badgeBgColor = Color.parseColor("#33F43F5E")
            )
        }
    }

    private fun resolveTypeface(fontStyle: String, isTitle: Boolean): Typeface {
        return when (fontStyle.lowercase()) {
            "romantic-serif" -> if (isTitle) Typeface.create(Typeface.SERIF, Typeface.BOLD) else Typeface.SANS_SERIF
            "handwriting", "calligraphy" -> Typeface.create("cursive", if (isTitle) Typeface.BOLD else Typeface.NORMAL)
            else -> if (isTitle) Typeface.DEFAULT_BOLD else Typeface.SANS_SERIF
        }
    }

    private fun showOverlayWindow(
        overlayDocId: String,
        title: String,
        message: String,
        imageUrl: String,
        theme: String,
        fontStyle: String,
        phoneNumber: String,
        buttons: List<OverlayButtonSpec>,
        notificationId: Int
    ) {
        removeOverlayView()

        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        windowManager = wm
        val palette = resolvePalette(theme)

        val backdrop = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#CC0A0412"))
            setPadding(dp(20), dp(32), dp(20), dp(32))
        }

        val cardBg = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            palette.cardColors
        ).apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(28).toFloat()
            setStroke(dp(2), palette.borderColor)
        }

        val scrollView = ScrollView(this).apply {
            isFillViewport = false
        }

        val cardWrapper = FrameLayout(this).apply {
            background = cardBg
            setPadding(dp(22), dp(22), dp(22), dp(22))
        }

        // Top-right Close (✕) button
        val closeBtnBg = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(palette.secondaryBtnBg)
            setStroke(dp(1), palette.borderColor)
        }
        val closeBtn = TextView(this).apply {
            text = "✕"
            setTextColor(palette.kickerColor)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            background = closeBtnBg
            setOnClickListener {
                if (overlayDocId.isNotBlank()) {
                    FirestoreOverlayBackgroundService.markOverlayDismissedInFirestore(
                        this@UrgentOverlayWindowService,
                        overlayDocId,
                        "dismiss"
                    )
                }
                CallAndOverlayHelper.dismissPopupAndNotification(this@UrgentOverlayWindowService, notificationId)
                stopSelf()
            }
        }
        cardWrapper.addView(
            closeBtn,
            FrameLayout.LayoutParams(dp(32), dp(32), Gravity.TOP or Gravity.END)
        )

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(4), dp(8), dp(4), dp(4))
        }

        // Top Romantic Kicker
        val kickerView = TextView(this).apply {
            text = "♥ A SPECIAL NOTE FOR KASHISH ♥"
            setTextColor(palette.kickerColor)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            letterSpacing = 0.08f
        }
        card.addView(
            kickerView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
        )

        // Heart Emblem or Circular Avatar Image
        val heartBadgeBg = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(palette.badgeBgColor)
            setStroke(dp(1), palette.borderColor)
        }
        val heartBadge = TextView(this).apply {
            text = "💖"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
            gravity = Gravity.CENTER
            background = heartBadgeBg
        }
        card.addView(
            heartBadge,
            LinearLayout.LayoutParams(dp(64), dp(64)).apply { bottomMargin = dp(12) }
        )

        if (imageUrl.isNotBlank() && (imageUrl.startsWith("http://") || imageUrl.startsWith("https://"))) {
            val imageView = ImageView(this).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                visibility = View.GONE
            }
            card.addView(
                imageView,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    dp(165)
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
                            heartBadge.visibility = View.GONE
                            imageView.setImageBitmap(bmp)
                            imageView.visibility = View.VISIBLE
                        }
                    }
                } catch (_: Exception) {}
            }
        }

        // Title
        val titleView = TextView(this).apply {
            text = title
            setTextColor(palette.titleColor)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 23f)
            typeface = resolveTypeface(fontStyle, isTitle = true)
            gravity = Gravity.CENTER
        }
        card.addView(
            titleView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
        )

        // Message Sanctuary Box
        val messageBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(18).toFloat()
            setColor(palette.quoteBgColor)
            setStroke(dp(1), palette.borderColor)
        }
        val messageView = TextView(this).apply {
            text = message
            setTextColor(palette.bodyColor)
            setTextSize(
                TypedValue.COMPLEX_UNIT_SP,
                if (fontStyle.lowercase() == "handwriting") 18f else 15.5f
            )
            typeface = resolveTypeface(fontStyle, isTitle = false)
            gravity = Gravity.CENTER
            background = messageBg
            setPadding(dp(16), dp(14), dp(16), dp(14))
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
            val btnDrawable = if (isPrimary) {
                GradientDrawable(
                    GradientDrawable.Orientation.LEFT_RIGHT,
                    palette.primaryBtnColors
                ).apply {
                    shape = GradientDrawable.RECTANGLE
                    cornerRadius = dp(14).toFloat()
                }
            } else {
                GradientDrawable().apply {
                    shape = GradientDrawable.RECTANGLE
                    cornerRadius = dp(14).toFloat()
                    setColor(palette.secondaryBtnBg)
                    setStroke(dp(1), palette.borderColor)
                }
            }

            val btn = Button(this).apply {
                text = btnSpec.label
                isAllCaps = false
                setTextColor(if (isPrimary) Color.WHITE else palette.secondaryBtnText)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                typeface = Typeface.DEFAULT_BOLD
                background = btnDrawable
                setPadding(dp(16), dp(12), dp(16), dp(12))
                setOnClickListener {
                    CallAndOverlayHelper.executeButtonSpec(
                        context = this@UrgentOverlayWindowService,
                        button = btnSpec,
                        defaultPhone = phoneNumber,
                        notificationId = notificationId,
                        overlayDocId = overlayDocId
                    )
                    stopSelf()
                }
            }

            card.addView(
                btn,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(8) }
            )
        }

        cardWrapper.addView(
            card,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            )
        )

        scrollView.addView(
            cardWrapper,
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

        @Suppress("DEPRECATION")
        val layoutParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            windowType,
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
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
