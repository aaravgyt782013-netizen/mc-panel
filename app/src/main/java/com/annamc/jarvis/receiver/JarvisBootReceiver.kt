package com.annamc.jarvis.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.annamc.jarvis.service.JarvisForegroundService
import com.annamc.jarvis.service.JarvisWatchdogWorker
import java.util.concurrent.TimeUnit

class JarvisBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) return
        val prefs = context.getSharedPreferences(JarvisForegroundService.PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(JarvisForegroundService.KEY_ENABLED, false)) return
        val request = PeriodicWorkRequestBuilder<JarvisWatchdogWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "jarvis-background-watchdog", ExistingPeriodicWorkPolicy.UPDATE, request
        )
        // Boot broadcasts are allowed to schedule work; direct microphone-service startup is
        // intentionally best-effort because Android 12+ restricts background FGS launches.
        try {
            val start = Intent(context, JarvisForegroundService::class.java).setAction(JarvisForegroundService.ACTION_START)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(start) else context.startService(start)
        } catch (_: Exception) {
            prefs.edit().putString("background_restart_warning", "Android blocked automatic microphone service restart; open JARVIS and tap Power On.").apply()
        }
    }
}
