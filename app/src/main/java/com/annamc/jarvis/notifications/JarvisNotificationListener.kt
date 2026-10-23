package com.annamc.jarvis.notifications
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
class JarvisNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) = Unit
    override fun onNotificationRemoved(sbn: StatusBarNotification?) = Unit
}
