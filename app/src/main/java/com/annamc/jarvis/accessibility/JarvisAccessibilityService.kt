package com.annamc.jarvis.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityEvent
import java.util.Locale

/**
 * Opt-in UI automation bridge. Android displays a system consent screen before this service
 * can be enabled. Actions fail closed when the service or target node is unavailable.
 */
class JarvisAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() { super.onServiceConnected(); active = this }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) { /* Screen content is not stored. */ }
    override fun onInterrupt() = Unit
    override fun onDestroy() { if (active === this) active = null; super.onDestroy() }

    private fun findLabel(label: String): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        val wanted = label.trim().lowercase(Locale.ROOT)
        return root.findAccessibilityNodeInfosByText(label).firstOrNull { node ->
            val text = (node.text?.toString() ?: node.contentDescription?.toString() ?: "")
            text.lowercase(Locale.ROOT).contains(wanted) && node.isVisibleToUser
        }
    }

    private fun clickLabel(label: String): Boolean {
        val node = findLabel(label) ?: return false
        var current: AccessibilityNodeInfo? = node
        while (current != null) {
            if (current.isClickable && current.isEnabled) return current.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            current = current.parent
        }
        return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    private fun typeText(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val nodes = root.findAccessibilityNodeInfosByViewId("android:id/content")
        val edit = nodes.firstOrNull { it.isEditable } ?: findEditable(root)
        return edit?.performAction(AccessibilityNodeInfo.ACTION_FOCUS) == true &&
            edit.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            })
    }

    private fun findEditable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isEditable && node.isVisibleToUser) return node
        for (i in 0 until node.childCount) findEditable(node.getChild(i) ?: continue)?.let { return it }
        return null
    }

    private fun swipe(direction: String): Boolean {
        val dm = resources.displayMetrics
        val x = dm.widthPixels / 2f
        val y = dm.heightPixels / 2f
        val path = Path()
        val (sx, sy, ex, ey) = when (direction.lowercase(Locale.ROOT)) {
            "up" -> floatArrayOf(x, y + dm.heightPixels * .22f, x, y - dm.heightPixels * .22f)
            "down" -> floatArrayOf(x, y - dm.heightPixels * .22f, x, y + dm.heightPixels * .22f)
            "left" -> floatArrayOf(x + dm.widthPixels * .25f, y, x - dm.widthPixels * .25f, y)
            else -> floatArrayOf(x - dm.widthPixels * .25f, y, x + dm.widthPixels * .25f, y)
        }
        path.moveTo(sx, sy); path.lineTo(ex, ey)
        return dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 380)).build(), null, null)
    }

    companion object {
        @Volatile private var active: JarvisAccessibilityService? = null
        fun isConnected(): Boolean = active != null
        fun global(action: String): Boolean {
            val service = active ?: return false
            val id = when (action.lowercase(Locale.ROOT)) {
                "home" -> GLOBAL_ACTION_HOME
                "back" -> GLOBAL_ACTION_BACK
                "recents" -> GLOBAL_ACTION_RECENTS
                "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
                "quick settings" -> GLOBAL_ACTION_QUICK_SETTINGS
                "power dialog" -> GLOBAL_ACTION_POWER_DIALOG
                else -> return false
            }
            return service.performGlobalAction(id)
        }
        fun click(label: String): Boolean = active?.clickLabel(label) ?: false
        fun type(text: String): Boolean = active?.typeText(text) ?: false
        fun swipe(direction: String): Boolean = active?.swipe(direction) ?: false
        fun scroll(direction: String): Boolean {
            val service = active ?: return false
            val root = service.rootInActiveWindow ?: return false
            val action = if (direction.equals("up", true)) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
            fun findScrollable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
                if (node.isScrollable) return node
                for (i in 0 until node.childCount) findScrollable(node.getChild(i) ?: continue)?.let { return it }
                return null
            }
            return findScrollable(root)?.performAction(action) ?: swipe(direction)
        }
    }
}
