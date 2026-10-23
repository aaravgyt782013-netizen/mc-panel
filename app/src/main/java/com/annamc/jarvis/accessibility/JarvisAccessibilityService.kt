package com.annamc.jarvis.accessibility
import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
class JarvisAccessibilityService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit
}
