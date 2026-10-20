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
 * Full-Screen Intent fallback activity (USE_FULL_SCREEN_INTENT) when SYSTEM_ALERT_WINDOW permission
 * is missing. Displays over the lock screen and provides the exact same action buttons.
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

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            km?.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }

        val title = intent?.getStringExtra("title") ?: "Urgent Message from Jay 💖"
        val message = intent?.getStringExtra("message") ?: "Jay needs your attention right now!"
        val imageUrl = intent?.getStringExtra("imageUrl") ?: ""
        val popupColor = intent?.getStringExtra("popupColor") ?: "rose"
        val phoneNumber = intent?.getStringExtra("phoneNumber") ?: ""
        val buttonItemsJson = intent?.getStringExtra("buttonItems") ?: ""
        val buttonsJson = intent?.getStringExtra("buttons") ?: ""
        val notificationId = intent?.getIntExtra("notificationId", CallAndOverlayHelper.URGENT_NOTIFICATION_ID)
            ?: CallAndOverlayHelper.URGENT_NOTIFICATION_ID

        if (phoneNumber.isNotBlank()) {
            CallAndOverlayHelper.saveCachedPhoneNumber(this, phoneNumber)
        }

        val buttons = CallAndOverlayHelper.parseButtonSpecs(buttonItemsJson, buttonsJson)

        val accentHex = when (popupColor.lowercase()) {
            "crimson" -> "#DC2626"
            "purple" -> "#9333EA"
            "indigo" -> "#4F46E5"
            "emerald" -> "#059669"
            "amber" -> "#D97706"
            else -> "#E11D48"
        }
        val accentColor = Color.parseColor(accentHex)

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#F20F0716"))
            setPadding(dp(20), dp(32), dp(20), dp(32))
        }

        val cardBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(28).toFloat()
            setColor(Color.parseColor("#1B1024"))
            setStroke(dp(2), accentColor)
        }

        val scrollView = ScrollView(this)
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = cardBg
            setPadding(dp(24), dp(26), dp(24), dp(24))
        }

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

        val messageView = TextView(this).apply {
            text = message
            setTextColor(Color.parseColor("#FCE7F3"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(12), dp(12), dp(16))
        }
        card.addView(
            messageView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(16) }
        )

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
                        context = this@UrgentOverlayFallbackActivity,
                        button = btnSpec,
                        defaultPhone = phoneNumber,
                        notificationId = notificationId
                    )
                    finish()
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

        scrollView.addView(card)
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
