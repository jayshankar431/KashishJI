package com.kashish.world

import android.app.KeyguardManager
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
import androidx.appcompat.app.AppCompatActivity
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Full-Screen Intent Activity (USE_FULL_SCREEN_INTENT + WakeLock):
 * Wakes up the lockscreen (setTurnScreenOn + setShowWhenLocked + WakeLock) when the phone is
 * locked or sitting with the screen off, and renders the romantic Truecaller-style popup card.
 */
class UrgentOverlayFallbackActivity : AppCompatActivity() {

    companion object {
        private var activeRef: WeakReference<UrgentOverlayFallbackActivity>? = null

        fun finishActiveInstance() {
            activeRef?.get()?.let { act ->
                if (!act.isFinishing) {
                    act.finish()
                }
            }
            activeRef = null
        }
    }

    private val ioExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        activeRef = WeakReference(this)

        // Acquire screen-bright WakeLock + turn screen on over lockscreen
        CallAndOverlayHelper.wakeUpScreenImmediately(this, 18_000L)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            km?.requestDismissKeyguard(this, null)
        }
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        )

        val overlayDocId = intent?.getStringExtra("overlayDocId") ?: ""
        val title = intent?.getStringExtra("title") ?: "Thinking of You 💖"
        val message = intent?.getStringExtra("message") ?: "Jay sent you a special note right now!"
        val imageUrl = intent?.getStringExtra("imageUrl") ?: ""
        val theme = intent?.getStringExtra("theme")
            ?: intent?.getStringExtra("popupColor")
            ?: "velvet-rose"
        val fontStyle = intent?.getStringExtra("fontStyle") ?: "romantic-serif"
        val phoneNumber = intent?.getStringExtra("phoneNumber") ?: ""
        val buttonItemsJson = intent?.getStringExtra("buttonItems") ?: ""
        val buttonsJson = intent?.getStringExtra("buttons") ?: ""
        val notificationId = intent?.getIntExtra("notificationId", CallAndOverlayHelper.URGENT_NOTIFICATION_ID)
            ?: CallAndOverlayHelper.URGENT_NOTIFICATION_ID

        if (phoneNumber.isNotBlank()) {
            CallAndOverlayHelper.saveCachedPhoneNumber(this, phoneNumber)
        }

        val buttons = CallAndOverlayHelper.parseButtonSpecs(buttonItemsJson, buttonsJson)

        val cardColors = when (theme.lowercase()) {
            "golden-letter", "amber" -> intArrayOf(Color.parseColor("#261509"), Color.parseColor("#160B04"), Color.parseColor("#2B1708"))
            "soft-blush" -> intArrayOf(Color.parseColor("#FFF5F8"), Color.parseColor("#FFE6F0"), Color.parseColor("#FFF0F5"))
            "starlight-night", "indigo", "purple" -> intArrayOf(Color.parseColor("#111827"), Color.parseColor("#1E1B4B"), Color.parseColor("#191332"))
            else -> intArrayOf(Color.parseColor("#260E36"), Color.parseColor("#150722"), Color.parseColor("#2B0F2E"))
        }
        val isLight = theme.lowercase() == "soft-blush"
        val borderColor = if (isLight) Color.parseColor("#55D6336C") else Color.parseColor("#66F472B6")
        val kickerColor = if (isLight) Color.parseColor("#BE185D") else Color.parseColor("#F9A8D4")
        val titleColor = if (isLight) Color.parseColor("#4A0E27") else Color.parseColor("#FFF1F2")
        val bodyColor = if (isLight) Color.parseColor("#5C1634") else Color.parseColor("#FCE7F3")
        val primaryBtnColors = when (theme.lowercase()) {
            "golden-letter", "amber" -> intArrayOf(Color.parseColor("#F59E0B"), Color.parseColor("#D97706"))
            "starlight-night", "indigo", "purple" -> intArrayOf(Color.parseColor("#8B5CF6"), Color.parseColor("#EC4899"))
            else -> intArrayOf(Color.parseColor("#F43F5E"), Color.parseColor("#DB2777"))
        }

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#F20A0412"))
            setPadding(dp(20), dp(32), dp(20), dp(32))
        }

        val cardBg = GradientDrawable(GradientDrawable.Orientation.TL_BR, cardColors).apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(28).toFloat()
            setStroke(dp(2), borderColor)
        }

        val scrollView = ScrollView(this)
        val cardWrapper = FrameLayout(this).apply {
            background = cardBg
            setPadding(dp(22), dp(22), dp(22), dp(22))
        }

        // Close button
        val closeBtnBg = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor("#1FFFFFFF"))
            setStroke(dp(1), borderColor)
        }
        val closeBtn = TextView(this).apply {
            text = "✕"
            setTextColor(kickerColor)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            background = closeBtnBg
            setOnClickListener {
                if (overlayDocId.isNotBlank()) {
                    FirestoreOverlayBackgroundService.markOverlayDismissedInFirestore(
                        this@UrgentOverlayFallbackActivity,
                        overlayDocId,
                        "dismiss"
                    )
                }
                CallAndOverlayHelper.dismissPopupAndNotification(this@UrgentOverlayFallbackActivity, notificationId)
                finish()
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

        val kickerView = TextView(this).apply {
            text = "♥ A SPECIAL NOTE FOR KASHISH ♥"
            setTextColor(kickerColor)
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

        val defaultAvatarView = ImageView(this).apply {
            setImageResource(R.drawable.ic_notification_large)
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        card.addView(
            defaultAvatarView,
            LinearLayout.LayoutParams(dp(72), dp(72)).apply { bottomMargin = dp(12) }
        )

        val titleView = TextView(this).apply {
            text = title
            setTextColor(titleColor)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 23f)
            typeface = if (fontStyle.lowercase() == "romantic-serif") {
                Typeface.create(Typeface.SERIF, Typeface.BOLD)
            } else {
                Typeface.DEFAULT_BOLD
            }
            gravity = Gravity.CENTER
        }
        card.addView(
            titleView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
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

        val messageBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(18).toFloat()
            setColor(if (isLight) Color.parseColor("#15D6336C") else Color.parseColor("#14FFFFFF"))
            setStroke(dp(1), borderColor)
        }
        val messageView = TextView(this).apply {
            text = message
            setTextColor(bodyColor)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
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

        buttons.forEachIndexed { idx, btnSpec ->
            val isPrimary = idx == 0 || btnSpec.action == "call_now"
            val btnDrawable = if (isPrimary) {
                GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, primaryBtnColors).apply {
                    shape = GradientDrawable.RECTANGLE
                    cornerRadius = dp(14).toFloat()
                }
            } else {
                GradientDrawable().apply {
                    shape = GradientDrawable.RECTANGLE
                    cornerRadius = dp(14).toFloat()
                    setColor(Color.parseColor("#1FFFFFFF"))
                    setStroke(dp(1), borderColor)
                }
            }

            val btn = Button(this).apply {
                text = btnSpec.label
                isAllCaps = false
                setTextColor(if (isPrimary) Color.WHITE else bodyColor)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                typeface = Typeface.DEFAULT_BOLD
                background = btnDrawable
                setPadding(dp(16), dp(12), dp(16), dp(12))
                setOnClickListener {
                    CallAndOverlayHelper.executeButtonSpec(
                        context = this@UrgentOverlayFallbackActivity,
                        button = btnSpec,
                        defaultPhone = phoneNumber,
                        notificationId = notificationId,
                        overlayDocId = overlayDocId
                    )
                    finish()
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

        cardWrapper.addView(card)
        scrollView.addView(cardWrapper)
        root.addView(
            scrollView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
        )
        setContentView(root)
    }

    override fun onDestroy() {
        if (activeRef?.get() === this) {
            activeRef = null
        }
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
