package com.kashish.world

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Automatically starts the Truecaller-style Firebase Overlay Background Service
 * whenever the phone boots up or the app is updated.
 */
class BootCompletedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (
            action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
            action == "android.intent.action.QUICKBOOT_POWERON" ||
            action == "com.htc.intent.action.QUICKBOOT_POWERON"
        ) {
            Log.d("BootCompletedReceiver", "Starting FirestoreOverlayBackgroundService on $action")
            FirestoreOverlayBackgroundService.startServiceSafely(context)
        }
    }
}
