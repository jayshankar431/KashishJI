package com.kashish.world

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles action buttons ("Call Right Now", "Call Later", etc.) tapped directly from high-priority notifications.
 */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent == null) return
        val overlayDocId = intent.getStringExtra("overlay_doc_id") ?: ""
        val actionType = intent.getStringExtra("button_action") ?: "dismiss"
        val label = intent.getStringExtra("button_label") ?: "Action"
        val payload = intent.getStringExtra("button_payload") ?: ""
        val defaultPhone = intent.getStringExtra("phone_number") ?: ""
        val notificationId = intent.getIntExtra("notification_id", CallAndOverlayHelper.URGENT_NOTIFICATION_ID)

        val spec = OverlayButtonSpec(label = label, action = actionType, payload = payload)
        CallAndOverlayHelper.executeButtonSpec(context, spec, defaultPhone, notificationId, overlayDocId)
    }
}
