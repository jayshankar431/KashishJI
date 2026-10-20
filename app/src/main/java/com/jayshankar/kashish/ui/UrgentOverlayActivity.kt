package com.jayshankar.kashish.ui

import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.jayshankar.kashish.ui.theme.RomanticDark
import com.jayshankar.kashish.ui.theme.RomanticPink
import com.jayshankar.kashish.ui.theme.RomanticRose
import com.jayshankar.kashish.ui.theme.RomanticSurface
import com.jayshankar.kashish.ui.theme.TextMuted

class UrgentOverlayActivity : ComponentActivity() {

    companion object {
        const val EXTRA_OVERLAY_ID = "extra_overlay_id"
        const val EXTRA_MESSAGE = "extra_message"
        const val EXTRA_OPTIONS = "extra_options"
        const val EXTRA_BUTTON_LABEL = "extra_button_label"
        const val NOTIFICATION_ID = 99991
    }

    private var firestoreListener: ListenerRegistration? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 1. Forcefully wake up and light up screen even if sleeping or in deep Doze
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            val wakeLock = powerManager?.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                "kashish:urgent_overlay_activity_wake"
            )
            wakeLock?.acquire(10000L) // 10 seconds screen bright
        } catch (e: Exception) {
            Log.w("UrgentOverlay", "Could not acquire screen wake lock: ${e.message}")
        }

        // Dismiss the heads-up notification when overlay activity is opened
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            nm?.cancel(NOTIFICATION_ID)
        } catch (_: Exception) {}

        // Configure window to turn screen on and show over lock screen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            keyguardManager?.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val overlayId = intent.getStringExtra(EXTRA_OVERLAY_ID) ?: ""
        val initialMessage = intent.getStringExtra(EXTRA_MESSAGE) ?: "You have an urgent message from Jay 💖"
        val initialOptions = intent.getStringArrayListExtra(EXTRA_OPTIONS) ?: arrayListOf()
        val buttonLabel = intent.getStringExtra(EXTRA_BUTTON_LABEL) ?: "I Love You Too! ❤️"

        // Trigger attention vibration
        triggerVibration()

        setContent {
            var message by remember { mutableStateOf(initialMessage) }
            var options by remember { mutableStateOf(initialOptions) }
            var isSubmitting by remember { mutableStateOf(false) }

            // Auto-dismiss if acknowledged elsewhere
            DisposableEffect(overlayId) {
                if (overlayId.isNotEmpty()) {
                    try {
                        val db = FirebaseFirestore.getInstance()
                        firestoreListener = db.collection("overlays").document(overlayId)
                            .addSnapshotListener { snapshot, error ->
                                if (error != null) return@addSnapshotListener
                                if (snapshot != null && snapshot.exists()) {
                                    val ack = snapshot.getBoolean("acknowledged") ?: false
                                    if (ack) {
                                        finish()
                                    }
                                    val msg = snapshot.getString("message")
                                    if (!msg.isNullOrBlank()) message = msg
                                    val opts = (snapshot.get("buttons") ?: snapshot.get("options")) as? List<*>
                                    if (opts != null) {
                                        options = ArrayList(opts.mapNotNull { it?.toString() })
                                    }
                                }
                            }
                    } catch (_: Exception) {}
                }
                onDispose {
                    firestoreListener?.remove()
                }
            }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.65f))
                    .clickable(enabled = false) {}, // Block clicks outside
                contentAlignment = Alignment.Center
            ) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth(0.92f)
                        .padding(16.dp),
                    shape = RoundedCornerShape(28.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = RomanticSurface
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = 16.dp)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(24.dp)
                            .verticalScroll(rememberScrollState()),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        // Badge
                        Surface(
                            shape = RoundedCornerShape(50),
                            color = RomanticPink.copy(alpha = 0.2f),
                            border = androidx.compose.foundation.BorderStroke(1.dp, RomanticPink.copy(alpha = 0.5f))
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "💖 Urgent Message from Jay",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = RomanticPink
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(18.dp))

                        // Message Text
                        Text(
                            text = "\"$message\"",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.White,
                            textAlign = TextAlign.Center,
                            lineHeight = 26.sp
                        )

                        Spacer(modifier = Modifier.height(24.dp))

                        // Configurable Options or Fallback Button
                        if (options.isNotEmpty()) {
                            Text(
                                text = "TAP TO RESPOND:",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextMuted,
                                letterSpacing = 1.sp
                            )
                            Spacer(modifier = Modifier.height(10.dp))

                            options.forEach { option ->
                                Button(
                                    onClick = {
                                        if (!isSubmitting) {
                                            isSubmitting = true
                                            sendResponse(overlayId, option)
                                        }
                                    },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 4.dp),
                                    shape = RoundedCornerShape(16.dp),
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = RomanticRose
                                    ),
                                    contentPadding = PaddingValues(vertical = 14.dp, horizontal = 16.dp)
                                ) {
                                    Text(
                                        text = option,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color.White,
                                        textAlign = TextAlign.Center
                                    )
                                }
                            }
                        } else {
                            Button(
                                onClick = {
                                    if (!isSubmitting) {
                                        isSubmitting = true
                                        sendResponse(overlayId, buttonLabel)
                                    }
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp),
                                shape = RoundedCornerShape(16.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = RomanticRose
                                ),
                                contentPadding = PaddingValues(vertical = 14.dp, horizontal = 16.dp)
                            ) {
                                Text(
                                    text = buttonLabel,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        // Dismiss button
                        TextButton(
                            onClick = {
                                finish()
                            }
                        ) {
                            Text(
                                text = "Dismiss for now",
                                fontSize = 12.sp,
                                color = TextMuted
                            )
                        }
                    }
                }
            }
        }
    }

    private fun sendResponse(overlayId: String, responseText: String) {
        triggerVibration()
        if (overlayId.isNotEmpty()) {
            try {
                val db = FirebaseFirestore.getInstance()
                val updates = hashMapOf<String, Any>(
                    "response" to responseText,
                    "selectedResponse" to responseText,
                    "respondedAt" to com.google.firebase.Timestamp.now(),
                    "acknowledged" to true,
                    "acknowledgedAt" to com.google.firebase.Timestamp.now(),
                    "status" to "responded"
                )
                db.collection("overlays").document(overlayId)
                    .update(updates)
                    .addOnCompleteListener {
                        Toast.makeText(this@UrgentOverlayActivity, "Response sent to Jay 💖", Toast.LENGTH_SHORT).show()
                        finish()
                    }
                return
            } catch (_: Exception) {
                // If firestore call threw exception immediately, finish
            }
        }
        Toast.makeText(this, "Response recorded 💖", Toast.LENGTH_SHORT).show()
        finish()
    }

    private fun triggerVibration() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vm?.defaultVibrator?.vibrate(VibrationEffect.createOneShot(120, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                val v = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v?.vibrate(VibrationEffect.createOneShot(120, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    v?.vibrate(120)
                }
            }
        } catch (_: Exception) {}
    }

    override fun onDestroy() {
        super.onDestroy()
        firestoreListener?.remove()
    }
}
