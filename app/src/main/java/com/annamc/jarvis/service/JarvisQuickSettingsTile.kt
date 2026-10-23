package com.annamc.jarvis.service

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.core.content.ContextCompat
import com.annamc.jarvis.MainActivity

class JarvisQuickSettingsTile : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        syncTile()
    }

    override fun onClick() {
        super.onClick()
        val prefs = getSharedPreferences(JarvisForegroundService.PREFS, MODE_PRIVATE)
        val enabled = prefs.getBoolean(JarvisForegroundService.KEY_ENABLED, false)
        if (enabled) {
            prefs.edit().putBoolean(JarvisForegroundService.KEY_ENABLED, false).apply()
            startService(Intent(this, JarvisForegroundService::class.java).setAction(JarvisForegroundService.ACTION_STOP))
        } else {
            val mic = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            val notifications = Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            if (!mic || !notifications) {
                val launch = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(android.app.PendingIntent.getActivity(this, 0, launch, android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE))
                else startActivityAndCollapse(launch)
            } else {
                prefs.edit().putBoolean(JarvisForegroundService.KEY_ENABLED, true).apply()
                val start = Intent(this, JarvisForegroundService::class.java).setAction(JarvisForegroundService.ACTION_START)
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(start) else startService(start)
            }
        }
        syncTile()
    }

    private fun syncTile() {
        qsTile?.let { tile ->
            val enabled = getSharedPreferences(JarvisForegroundService.PREFS, MODE_PRIVATE)
                .getBoolean(JarvisForegroundService.KEY_ENABLED, false)
            tile.state = if (enabled) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            tile.label = if (enabled) "JARVIS ON" else "JARVIS OFF"
            tile.contentDescription = "Toggle JARVIS offline voice listening"
            tile.updateTile()
        }
    }
}
