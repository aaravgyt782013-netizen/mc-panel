package com.annamc.jarvis.service

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/** Best-effort watchdog. Android may still block background microphone starts on recent releases. */
class JarvisWatchdogWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences(JarvisForegroundService.PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(JarvisForegroundService.KEY_ENABLED, false)) return Result.success()
        val intent = Intent(applicationContext, JarvisForegroundService::class.java)
            .setAction(JarvisForegroundService.ACTION_START)
        return try {
            if (Build.VERSION.SDK_INT >= 26) applicationContext.startForegroundService(intent)
            else applicationContext.startService(intent)
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
