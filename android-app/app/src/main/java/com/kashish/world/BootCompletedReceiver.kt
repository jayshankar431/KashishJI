package com.kashish.world

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Automatically starts the silent Truecaller-style Firebase Overlay Background Watcher
 * whenever the phone boots up, the app is updated, or the silent heartbeat alarm fires.
 */
class BootCompletedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (
            action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
            action == "android.intent.action.QUICKBOOT_POWERON" ||
            action == "com.htc.intent.action.QUICKBOOT_POWERON" ||
            action == FirestoreOverlayBackgroundService.ACTION_SILENT_HEARTBEAT
        ) {
            Log.d("BootCompletedReceiver", "Ensuring silent FirestoreOverlayBackgroundService on $action")
            FirestoreOverlayBackgroundService.startServiceSafely(context)
        }
    }
}
