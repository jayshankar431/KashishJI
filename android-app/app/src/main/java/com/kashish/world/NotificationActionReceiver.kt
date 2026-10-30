package com.kashish.world

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles action buttons ("Call Right Now", "Open Section", "Open Link", "Dismiss", etc.)
 * tapped directly from high-priority notifications or Truecaller-style lock-screen alerts.
 */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.getStringExtra("button_action") ?: "dismiss"

        when (action) {
            "media_prev" -> {
                MainActivity.dispatchMediaAction("prev")
                return
            }
            "media_next" -> {
                MainActivity.dispatchMediaAction("next")
                return
            }
            "media_play" -> {
                MainActivity.dispatchMediaAction("play")
                return
            }
            "media_pause" -> {
                MainActivity.dispatchMediaAction("pause")
                return
            }
            "media_toggle" -> {
                MainActivity.dispatchMediaAction("toggle")
                return
            }
        }

        val overlayDocId = intent.getStringExtra("overlay_doc_id") ?: ""
        val notifDocId = intent.getStringExtra("notif_doc_id") ?: ""
        val label = intent.getStringExtra("button_label") ?: "Action"
        val payload = intent.getStringExtra("button_payload") ?: ""
        val phoneNumber = intent.getStringExtra("phone_number") ?: ""
        val notificationId = intent.getIntExtra("notification_id", CallAndOverlayHelper.URGENT_NOTIFICATION_ID)

        CallAndOverlayHelper.executeButtonSpec(
            context = context,
            button = OverlayButtonSpec(label, action, payload),
            defaultPhone = phoneNumber,
            notificationId = notificationId,
            overlayDocId = overlayDocId,
            notifDocId = notifDocId
        )
    }
}
