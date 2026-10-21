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
        val overlayDocId = intent.getStringExtra("overlay_doc_id") ?: ""
        val notifDocId = intent.getStringExtra("notif_doc_id") ?: ""
        val label = intent.getStringExtra("button_label") ?: "Action"
        val action = intent.getStringExtra("button_action") ?: "dismiss"
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
