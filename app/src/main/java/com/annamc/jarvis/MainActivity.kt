package com.annamc.jarvis

import android.Manifest
import android.content.Context
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.media.AudioManager
import android.media.ToneGenerator
import android.hardware.camera2.CameraManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.annamc.jarvis.settings.AssistantSettings
import com.annamc.jarvis.voice.AssistantNameMatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Void = Color(0xFF030812)
private val Panel = Color(0xFF091727)
private val Cyan = Color(0xFF49E9FF)
private val Muted = Color(0xFF8DA9BE)
private enum class ConfirmLevel { ALWAYS, SENSITIVE_ONLY, NEVER }
private data class PendingAction(val description: String, val execute: () -> Boolean)

class MainActivity : ComponentActivity(), TextToSpeech.OnInitListener {
    private var tts: TextToSpeech? = null
    private var recognizer: SpeechRecognizer? = null
    private var isListening by mutableStateOf(false)
    private var status by mutableStateOf("SYSTEM STANDBY")
    private var heard by mutableStateOf("Awaiting your command")
    private var bootText by mutableStateOf("Initializing...")
    private var clock by mutableStateOf("--:--:--")
    private var battery by mutableIntStateOf(0)
    private var network by mutableStateOf("CHECKING")
    private var assistantName by mutableStateOf("Jarvis")
    private lateinit var assistantSettings: AssistantSettings
    private var pitch by mutableFloatStateOf(0.92f)
    private var rate by mutableFloatStateOf(0.88f)
    private var level by mutableStateOf(ConfirmLevel.ALWAYS)
    private var pending by mutableStateOf<PendingAction?>(null)
    private var countdown by mutableIntStateOf(10)
    private var permissionStage by mutableStateOf("")
    private val skippedPermissions = mutableSetOf<String>()
    private var torchOn = false
    private val history = mutableStateListOf<String>()

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshPermissions() }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshPermissions() }
    private val phoneStatePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshPermissions() }

    private val serviceReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                com.annamc.jarvis.service.JarvisForegroundService.ACTION_STATE -> {
                    val state = intent.getStringExtra(com.annamc.jarvis.service.JarvisForegroundService.EXTRA_STATE).orEmpty()
                    status = state.uppercase(Locale.ROOT)
                    isListening = state != "OFF"
                }
                com.annamc.jarvis.service.JarvisForegroundService.ACTION_COMMAND -> {
                    heard = intent.getStringExtra(com.annamc.jarvis.service.JarvisForegroundService.EXTRA_COMMAND).orEmpty()
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val serviceFilter = IntentFilter().apply {
            addAction(com.annamc.jarvis.service.JarvisForegroundService.ACTION_STATE)
            addAction(com.annamc.jarvis.service.JarvisForegroundService.ACTION_COMMAND)
        }
        ContextCompat.registerReceiver(this, serviceReceiver, serviceFilter, ContextCompat.RECEIVER_NOT_EXPORTED)
        val prefs = getSharedPreferences("jarvis", MODE_PRIVATE)
        assistantSettings = AssistantSettings(this)
        lifecycleScope.launch { assistantSettings.assistantName.collect { assistantName = it } }
        level = runCatching { ConfirmLevel.valueOf(prefs.getString("level", "ALWAYS") ?: "ALWAYS") }.getOrDefault(ConfirmLevel.ALWAYS)
        pitch = prefs.getFloat("pitch", 0.92f)
        rate = prefs.getFloat("rate", 0.88f)
        tts = TextToSpeech(this, this)
        refreshPermissions()
        setContent {
            LaunchedEffect(Unit) {
                delay(800); bootText = "Calibrating arc reactor..."
                delay(900); bootText = "All systems online"
                val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
                val greeting = when (hour) { in 5..11 -> "Good morning, sir."; in 12..16 -> "Good afternoon, sir."; else -> "Good evening, sir." }
                heard = greeting; speak(greeting)
                while (true) {
                    clock = SimpleDateFormat("HH:mm:ss", Locale.UK).format(Date())
                    battery = (getSystemService(BATTERY_SERVICE) as BatteryManager).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                    val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
                    val caps = cm.getNetworkCapabilities(cm.activeNetwork)
                    network = when { caps == null -> "OFFLINE"; caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WI-FI"; caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "MOBILE"; else -> "CONNECTED" }
                    delay(1000)
                }
            }
            JarvisScreen(status, heard, isListening, bootText, clock, battery, network, history.toList(), level, pitch, rate, pending, countdown, permissionStage, assistantName,
                { requestStart() }, { stopListening() }, { startTapToTalk() },
                { level = it; prefs.edit().putString("level", it.name).apply() },
                { pitch = it; prefs.edit().putFloat("pitch", it).apply(); applyVoice() },
                { rate = it; prefs.edit().putFloat("rate", it).apply(); applyVoice() },
                { name -> lifecycleScope.launch { assistantSettings.setAssistantName(name) } },
                { resolvePending(true) }, { resolvePending(false) }, { requestPermission(it) }, { countdown = it }, { skippedPermissions.add(it); refreshPermissions() }, { isPermissionReady(it) })
        }
    }

    override fun onInit(result: Int) { if (result == TextToSpeech.SUCCESS) applyVoice() }
    private fun applyVoice() { tts?.language = Locale.UK; tts?.setPitch(pitch); tts?.setSpeechRate(rate) }
    private fun speak(text: String) { applyVoice(); tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "jarvis-response") }
    private fun tone(tone: Int) { try { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 60).startTone(tone, 120) } catch (_: Exception) {} }

    private val permissionSteps = listOf(
        "MICROPHONE", "NOTIFICATIONS", "ACCESSIBILITY", "NOTIFICATION_ACCESS", "OVERLAY",
        "CONTACTS", "CALLS", "SMS", "CALENDAR", "CAMERA", "WRITE_SETTINGS",
        "USAGE_ACCESS", "EXACT_ALARMS", "DND", "BATTERY", "AUTOSTART"
    )

    private fun isPermissionReady(key: String): Boolean = try {
        when (key) {
            "MICROPHONE" -> ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            "NOTIFICATIONS" -> Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            "ACCESSIBILITY" -> Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
                ?.split(':')?.any { it.equals("$packageName/com.annamc.jarvis.accessibility.JarvisAccessibilityService", true) } == true
            "NOTIFICATION_ACCESS" -> Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
                ?.split(':')?.any { it.contains(packageName, true) } == true
            "OVERLAY" -> Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this)
            "CONTACTS" -> ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
            "CALLS" -> ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
            "SMS" -> ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
            "CALENDAR" -> ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED
            "CAMERA" -> ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            "WRITE_SETTINGS" -> Build.VERSION.SDK_INT < 23 || Settings.System.canWrite(this)
            "USAGE_ACCESS" -> {
                val appOps = getSystemService(Context.APP_OPS_SERVICE) as android.app.AppOpsManager
                val mode = if (Build.VERSION.SDK_INT >= 29) appOps.unsafeCheckOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), packageName)
                    else appOps.checkOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), packageName)
                mode == android.app.AppOpsManager.MODE_ALLOWED
            }
            "EXACT_ALARMS" -> Build.VERSION.SDK_INT < 31 || (getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager).canScheduleExactAlarms()
            "DND" -> (getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).isNotificationPolicyAccessGranted
            "BATTERY" -> Build.VERSION.SDK_INT < 23 || (getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).isIgnoringBatteryOptimizations(packageName)
            "AUTOSTART" -> true // OEM autostart controls have no portable Android API; offer the app-info page as guidance.
            else -> false
        }
    } catch (_: Exception) { false }

    private fun refreshPermissions() {
        permissionStage = permissionSteps.firstOrNull { !isPermissionReady(it) && it !in skippedPermissions }.orEmpty()
        if (permissionStage.isNotBlank()) status = "SETUP REQUIRED"
    }

    override fun onResume() { super.onResume(); refreshPermissions() }

    private fun requestPermission(which: String) {
        fun appDetails() = startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + packageName)))
        fun request(vararg permissions: String) {
            if (permissions.isNotEmpty()) requestPermissions(permissions, 721)
        }
        when (which) {
            "MICROPHONE" -> micPermission.launch(Manifest.permission.RECORD_AUDIO)
            "NOTIFICATIONS" -> if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) else refreshPermissions()
            "ACCESSIBILITY" -> startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            "NOTIFICATION_ACCESS" -> startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))
            "OVERLAY" -> if (Build.VERSION.SDK_INT >= 23) startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:" + packageName))) else appDetails()
            "CONTACTS" -> request(Manifest.permission.READ_CONTACTS)
            "PHONE_STATE" -> phoneStatePermission.launch(Manifest.permission.READ_PHONE_STATE)
            "CALLS" -> request(Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE)
            "SMS" -> request(Manifest.permission.SEND_SMS, Manifest.permission.READ_SMS)
            "CALENDAR" -> request(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)
            "CAMERA" -> request(Manifest.permission.CAMERA)
            "WRITE_SETTINGS" -> if (Build.VERSION.SDK_INT >= 23) startActivity(Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, android.net.Uri.parse("package:" + packageName))) else appDetails()
            "USAGE_ACCESS" -> startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            "EXACT_ALARMS" -> if (Build.VERSION.SDK_INT >= 31) startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, android.net.Uri.parse("package:" + packageName))) else refreshPermissions()
            "DND" -> startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
            "BATTERY" -> if (Build.VERSION.SDK_INT >= 23) startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, android.net.Uri.parse("package:" + packageName))) else refreshPermissions()
            "AUTOSTART" -> appDetails()
            else -> appDetails()
        }
    }

    private fun requestStart() {
        refreshPermissions()
        if (permissionStage == "MICROPHONE") { micPermission.launch(Manifest.permission.RECORD_AUDIO); return }
        if (permissionStage == "NOTIFICATIONS") {
            if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        try {
            val intent = Intent(this, com.annamc.jarvis.service.JarvisForegroundService::class.java)
                .setAction(com.annamc.jarvis.service.JarvisForegroundService.ACTION_START)
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
            isListening = true
            status = "STANDBY"
            heard = "Offline wake listening enabled"
        } catch (_: Exception) {
            isListening = false
            respond("I couldn't start the offline voice service, sir.")
        }
    }

    private fun stopListening() {
        try {
            recognizer?.cancel()
            recognizer?.destroy()
            recognizer = null
            val intent = Intent(this, com.annamc.jarvis.service.JarvisForegroundService::class.java)
                .setAction(com.annamc.jarvis.service.JarvisForegroundService.ACTION_STOP)
            startService(intent)
        } catch (_: Exception) {}
        isListening = false
        status = "SYSTEM STANDBY"
        heard = "Microphone released"
    }

    private fun startTapToTalk() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            respond("Android speech recognition is unavailable on this device, sir.")
            return
        }
        try {
            recognizer?.cancel()
            recognizer?.destroy()
            recognizer = SpeechRecognizer.createSpeechRecognizer(this).also { sr ->
                sr.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) { status = "LISTENING"; heard = "Listening for one command…" }
                    override fun onBeginningOfSpeech() { status = "LISTENING"; heard = "Speech detected…" }
                    override fun onRmsChanged(rmsdB: Float) { }
                    override fun onBufferReceived(buffer: ByteArray?) { }
                    override fun onEndOfSpeech() { status = "PROCESSING" }
                    override fun onError(error: Int) {
                        status = "VOICE TEST FAILED"
                        heard = "Tap-to-talk error $error. Check network / Google speech service and microphone permission."
                        history.add(0, "Tap-to-talk error $error")
                    }
                    override fun onResults(results: Bundle?) {
                        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                        if (text.isBlank()) { respond("I didn't catch that, sir. Please try again."); return }
                        heard = "Tap-to-talk: $text"
                        history.add(0, "Recognized: $text")
                        handleCommand(text.lowercase(Locale.ROOT))
                    }
                    override fun onPartialResults(partialResults: Bundle?) {
                        val partial = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                        if (!partial.isNullOrBlank()) heard = "Hearing: $partial"
                    }
                    override fun onEvent(eventType: Int, params: Bundle?) { }
                })
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.UK.toLanguageTag())
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                    putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false)
                }
                sr.startListening(intent)
            }
        } catch (e: Exception) {
            respond("I couldn't start tap-to-talk, sir: ${e.message ?: "speech service error"}.")
        }
    }

    private fun handleCommand(command: String) {
        if (pending != null) { respond("Please confirm or cancel the pending action, sir."); return }
        when {
            command.contains("time") -> respond("The time is " + SimpleDateFormat("h:mm a", Locale.UK).format(Date()) + ", sir.")
            command.contains("battery") -> respond("Battery level is " + battery + " percent, sir.")
            command.contains("network") || command.contains("internet") -> respond("Network status is " + network + ", sir.")
            command.contains("flashlight") || command.contains("torch") -> requestAction("toggle flashlight", false) { toggleTorch() }
            command.contains("brightness") -> requestAction("open brightness settings", false) { startActivity(Intent(Settings.ACTION_DISPLAY_SETTINGS)); true }
            command.contains("bluetooth") -> requestAction("open Bluetooth settings", false) { startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)); true }
            command.contains("wifi") || command.contains("wi-fi") -> requestAction("open Wi-Fi settings", false) { startActivity(Intent(Settings.ACTION_WIFI_SETTINGS)); true }
            command.contains("dnd") || command.contains("do not disturb") -> requestAction("open Do Not Disturb settings", false) { startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)); true }
            command.contains("airplane mode") -> requestAction("open airplane mode settings", false) { startActivity(Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS)); true }
            command.contains("rotation") || command.contains("auto rotate") -> requestAction("open display settings", false) { startActivity(Intent(Settings.ACTION_DISPLAY_SETTINGS)); true }
            command.contains("wallpaper") -> requestAction("open wallpaper chooser", false) { startActivity(Intent(Intent.ACTION_SET_WALLPAPER)); true }
            command.contains("settings") -> requestAction("open system settings", false) { startActivity(Intent(Settings.ACTION_SETTINGS)); true }
            command.contains("youtube") -> requestAction("open YouTube", false) { openApp("com.google.android.youtube", "https://www.youtube.com") }
            command.contains("chrome") || command.contains("browser") -> requestAction("open browser", false) { openApp("com.android.chrome", "https://www.google.com") }
            command.contains("call ") || command.contains("sms") || command.contains("delete") || command.contains("install") || command.contains("payment") -> respond("I'm afraid I can't perform that sensitive action yet, sir.")
            command.contains("stop listening") || command.contains("stop jarvis") -> { stopListening(); respond("Voice commands stopped, sir.") }
            else -> respond("I'm afraid I can't do that yet, sir.")
        }
    }
    private fun requestAction(description: String, sensitive: Boolean, execute: () -> Boolean) {
        val require = when (level) { ConfirmLevel.ALWAYS -> true; ConfirmLevel.SENSITIVE_ONLY -> sensitive; ConfirmLevel.NEVER -> false }
        if (!require) { val ok = try { execute() } catch (_: Exception) { false }; report(description, ok); return }
        pending = PendingAction(description, execute); countdown = 10; status = "AWAITING CONFIRMATION"; speak("Shall I proceed, sir?")
    }
    private fun resolvePending(yes: Boolean) {
        val action = pending ?: return; pending = null
        if (!yes) { status = "ACTION CANCELLED"; respond("Cancelled, sir."); return }
        val ok = try { action.execute() } catch (_: Exception) { false }
        report(action.description, ok)
    }
    private fun respond(message: String) {
        heard = message
        status = "SPEAKING"
        speak(message)
    }

    private fun report(action: String, success: Boolean) {
        val msg = if (success) "Done, sir. " + action + " succeeded." else "I'm afraid " + action + " failed, sir."
        history.add(0, SimpleDateFormat("HH:mm:ss", Locale.UK).format(Date()) + "  " + msg)
        while (history.size > 10) history.removeAt(history.lastIndex)
        status = if (success) "ACTION COMPLETE" else "ACTION FAILED"; heard = msg; speak(msg)
    }
    private fun toggleTorch(): Boolean {
        return try {
            val m = getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val id = m.cameraIdList.firstOrNull { m.getCameraCharacteristics(it).get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE) == true } ?: return false
            val next = !torchOn; m.setTorchMode(id, next); torchOn = next; true
        } catch (_: Exception) { false }
    }
    private fun openApp(pkg: String, fallback: String): Boolean {
        return try { startActivity(packageManager.getLaunchIntentForPackage(pkg) ?: Intent(Intent.ACTION_VIEW, android.net.Uri.parse(fallback))); true }
        catch (_: Exception) { false }
    }
    override fun onDestroy() {
        try { recognizer?.cancel(); recognizer?.destroy() } catch (_: Exception) {}
        try { unregisterReceiver(serviceReceiver) } catch (_: Exception) {}
        tts?.stop()
        tts?.shutdown()
        super.onDestroy()
    }
}

@Composable
private fun JarvisScreen(
    status: String, heard: String, listening: Boolean, bootText: String, clock: String, battery: Int, network: String,
    history: List<String>, level: ConfirmLevel, pitch: Float, rate: Float, pending: PendingAction?, countdown: Int,
    permissionStage: String, assistantName: String, onStart: () -> Unit, onStop: () -> Unit, onTapToTalk: () -> Unit, onLevel: (ConfirmLevel) -> Unit,
    onPitch: (Float) -> Unit, onRate: (Float) -> Unit, onAssistantName: (String) -> Unit, onConfirm: () -> Unit, onCancel: () -> Unit,
    onPermission: (String) -> Unit, onCountdown: (Int) -> Unit, onSkip: (String) -> Unit, onPermissionStatus: (String) -> Boolean
) {
    var tab by remember { mutableStateOf("Home") }
    val context = LocalContext.current
    val powerSaverOn = (context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).isPowerSaveMode
    val diagPrefs = context.getSharedPreferences("jarvis", Context.MODE_PRIVATE)
    val diagnosticLog = diagPrefs.getString("diag_log", "No service logs yet. Start JARVIS to collect diagnostics.").orEmpty()
    val serviceStartedAt = context.getSharedPreferences("jarvis", Context.MODE_PRIVATE).getLong("listening_started_at", 0L)
    val uptimeText = if (serviceStartedAt > 0L) { val seconds = ((System.currentTimeMillis() - serviceStartedAt) / 1000L).coerceAtLeast(0L); "%02d:%02d:%02d".format(Locale.UK, seconds / 3600, (seconds % 3600) / 60, seconds % 60) } else "Not currently recorded"
    val transition = rememberInfiniteTransition(label = "reactor")
    val pulse by transition.animateFloat(0.94f, 1.06f, infiniteRepeatable(tween(1350), RepeatMode.Reverse), label = "pulse")
    val wave = if (diagPrefs.contains("diag_audio_level")) ((diagPrefs.getFloat("diag_audio_level", 0f) + 10f) / 50f).coerceIn(0.05f, 1f) else 0.05f
    LaunchedEffect(pending) {
        if (pending != null) {
            for (seconds in 10 downTo 1) {
                delay(1000)
                if (pending != null) onCountdown(seconds - 1)
            }
            if (pending != null) onCancel()
        }
    }
    MaterialTheme(colorScheme = darkColorScheme(primary = Cyan, background = Void, surface = Panel)) {
        Surface(Modifier.fillMaxSize(), color = Void) {
            Column(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF071A2B), Void)))) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column { Text("J.A.R.V.I.S.", color = Cyan, fontSize = 21.sp, letterSpacing = 3.sp, fontWeight = FontWeight.SemiBold); Text(bootText, color = Muted, fontSize = 11.sp) }
                    Column(horizontalAlignment = Alignment.End) { Text(clock, color = Color.White, fontSize = 16.sp); Text("$battery%  •  $network", color = Cyan, fontSize = 11.sp) }
                }
                if (permissionStage.isNotBlank() && tab == "Home") {
                    val steps = listOf(
                        "MICROPHONE" to "Microphone access lets JARVIS listen for your wake name and voice commands.",
                        "NOTIFICATIONS" to "Notifications allow Android to display the persistent listening notification and its Stop control.",
                        "ACCESSIBILITY" to "Accessibility is optional but required for Home, Back, gestures, and on-screen label actions. Enable only if you want those controls.",
                        "NOTIFICATION_ACCESS" to "Notification access lets JARVIS read notifications you explicitly allow it to access. Treat this as sensitive.",
                        "OVERLAY" to "Display over other apps is only needed for a floating overlay. Android may show a restricted-settings warning; open App info and choose Allow restricted settings if you trust this app.",
                        "CONTACTS" to "Contacts access is used for contact lookup. You can skip it if you do not need contact commands.",
                        "CALLS" to "Phone permissions support call-related features. JARVIS currently opens the dialer rather than placing calls automatically.",
                        "SMS" to "SMS permission supports message-related features. JARVIS currently opens the message composer; it does not silently send messages.",
                        "CALENDAR" to "Calendar access is for reading and creating events. Event commands are not fully implemented yet.",
                        "CAMERA" to "Camera access is for camera features. Opening the camera app does not require JARVIS to capture images itself.",
                        "WRITE_SETTINGS" to "Modify system settings allows supported changes such as brightness. Android opens a dedicated settings page.",
                        "USAGE_ACCESS" to "Usage access can help identify foreground apps. Grant only if you want this optional capability.",
                        "EXACT_ALARMS" to "Exact alarms permit precise reminders on supported Android versions.",
                        "DND" to "Do Not Disturb access allows supported DND controls. JARVIS may open settings instead of changing the mode directly.",
                        "BATTERY" to "Battery optimization exemption may improve background reliability but increases battery use. Android and your phone maker may still restrict background work.",
                        "AUTOSTART" to "Some phone makers provide their own Autostart setting. Android has no universal status API, so this step is guidance only."
                    )
                    val index = steps.indexOfFirst { it.first == permissionStage }.coerceAtLeast(0)
                    val granted = steps.filter { onPermissionStatus(it.first) }
                    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 22.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("INITIAL SETUP", color = Cyan, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Text("Step ${index + 1} of ${steps.size} • ${steps[index].first.replace('_', ' ')}", color = Muted, fontSize = 12.sp)
                        LinearProgressIndicator(progress = { (index + 1).toFloat() / steps.size }, modifier = Modifier.fillMaxWidth(), color = Cyan, trackColor = Color(0xFF183246))
                        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Panel), border = androidx.compose.foundation.BorderStroke(1.dp, Cyan.copy(alpha = .5f))) {
                            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text(steps[index].first.replace('_', ' '), color = Cyan, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                Text(steps[index].second, color = Color.White, fontSize = 14.sp)
                                if (permissionStage == "ACCESSIBILITY" || permissionStage == "NOTIFICATION_ACCESS" || permissionStage == "OVERLAY") {
                                    Text("If Android says this setting is restricted, open this app's App info page and manually enable “Allow restricted settings” before returning here.", color = Color(0xFFFFD28A), fontSize = 12.sp)
                                }
                                Button(onClick = { onPermission(permissionStage) }, modifier = Modifier.fillMaxWidth()) { Text("GRANT / OPEN SETTINGS") }
                                OutlinedButton(onClick = { onSkip(permissionStage) }, modifier = Modifier.fillMaxWidth()) { Text("SKIP THIS STEP") }
                            }
                        }
                        Text("GRANTED", color = Color(0xFF63E6A5), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        granted.forEach { item ->
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("✓", color = Color(0xFF63E6A5), fontSize = 16.sp)
                                Text(item.second.substringBefore('.'), color = Color(0xFFB7F5D4), fontSize = 12.sp)
                            }
                        }
                        Text("You can skip optional steps and enable them later in Permissions. Microphone and notifications are needed for background voice listening.", color = Muted, fontSize = 11.sp)
                    }
                } else {
                when (tab) {
                    "Home" -> {
                        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 18.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.SpaceEvenly) {
                            if (permissionStage.isNotBlank()) Text("Some assistant features are unavailable until permissions are granted.", color = Color(0xFFFFD28A), fontSize = 11.sp, textAlign = TextAlign.Center)
                            Box(Modifier.fillMaxWidth().heightIn(min = 220.dp, max = 310.dp), contentAlignment = Alignment.Center) {
                                Box(Modifier.size(226.dp).scale(pulse).border(1.dp, Cyan.copy(alpha = .25f), CircleShape))
                                Box(Modifier.size(196.dp).scale(1.03f / pulse).border(2.dp, Cyan.copy(alpha = .4f), CircleShape).padding(12.dp).border(1.dp, Color(0xFF1976D2), CircleShape))
                                Box(Modifier.size(156.dp).border(2.dp, Cyan.copy(alpha = .9f), CircleShape).background(Brush.radialGradient(listOf(Color(0xFF37E8FF), Color(0xFF0B426C), Color(0xFF06111F))), CircleShape), contentAlignment = Alignment.Center) {
                                    Box(Modifier.size(122.dp).border(1.dp, Color.White.copy(alpha = .3f), CircleShape), contentAlignment = Alignment.Center) {
                                        Text("J", color = Color.White, fontSize = 66.sp, fontWeight = FontWeight.Light)
                                    }
                                }
                            }
                            Row(Modifier.fillMaxWidth().height(36.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                                repeat(36) { i ->
                                    val height = (5 + ((i * 7) % 17) * wave * if (listening) 1.4f else .45f).dp
                                    Box(Modifier.padding(horizontal = 1.5.dp).width(3.dp).height(height).background(if (listening) Cyan else Cyan.copy(alpha = .28f), RoundedCornerShape(3.dp)))
                                }
                            }
                            Text(when {
                                status.contains("LISTEN") -> "LISTENING"
                                status.contains("PROCESS") -> "PROCESSING"
                                status.contains("SPEAK") -> "SPEAKING"
                                status.contains("OFF") -> "OFFLINE"
                                else -> "STANDBY"
                            }, color = Cyan, fontSize = 12.sp, letterSpacing = 3.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
                            Card(Modifier.fillMaxWidth().padding(top = 10.dp), colors = CardDefaults.cardColors(containerColor = Panel), border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF17384D))) {
                                Column(Modifier.padding(16.dp)) {
                                    Text("LIVE TRANSCRIPT", color = Muted, fontSize = 10.sp, letterSpacing = 2.sp)
                                    Text(heard.ifBlank { "Waiting for an addressed command…" }, Modifier.padding(top = 7.dp), color = Color.White, fontSize = 15.sp)
                                }
                            }
                            if (listening && (powerSaverOn || !onPermissionStatus("BATTERY"))) {
                                Card(Modifier.fillMaxWidth().padding(top = 8.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFF332515)), border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFFFC56D))) {
                                    Column(Modifier.padding(12.dp)) {
                                        Text("BACKGROUND ACTIVITY MAY BE RESTRICTED", color = Color(0xFFFFD28A), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                        Text(if (powerSaverOn) "Battery Saver is enabled and may interrupt voice listening." else "Battery optimization is still enabled. Some phone makers may also stop background listening.", color = Color.White, fontSize = 12.sp)
                                        TextButton(onClick = { onPermission("BATTERY") }) { Text("FIX BATTERY SETTINGS", color = Cyan) }
                                    }
                                }
                            }
                            if (pending != null) Card(Modifier.fillMaxWidth().padding(top = 10.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFF12283B)), border = androidx.compose.foundation.BorderStroke(1.dp, Cyan)) {
                                Column(Modifier.padding(12.dp)) {
                                    Text("CONFIRM ACTION", color = Cyan, fontWeight = FontWeight.Bold)
                                    Text(pending.description, color = Color.White)
                                    Text("Auto-cancel in $countdown seconds", color = Muted, fontSize = 12.sp)
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Button(onClick = onConfirm, modifier = Modifier.weight(1f)) { Text("CONFIRM") }
                                        OutlinedButton(onClick = onCancel, modifier = Modifier.weight(1f)) { Text("CANCEL") }
                                    }
                                }
                            }
                            OutlinedButton(onClick = onTapToTalk, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) { Text("🎙  TAP TO TALK • TEST COMMAND ENGINE", color = Cyan, fontWeight = FontWeight.Bold) }\n                            Button(onClick = { if (listening) onStop() else onStart() }, modifier = Modifier.fillMaxWidth().height(60.dp).padding(top = 4.dp), colors = ButtonDefaults.buttonColors(containerColor = if (listening) Color(0xFF9C2942) else Color(0xFF087C91))) {
                                Text(if (listening) "⏻  POWER OFF  •  STOP LISTENING" else "⏻  POWER ON  •  START JARVIS", fontWeight = FontWeight.Bold, color = Color.White)
                            }
                        }
                    }
                    "Commands" -> Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(18.dp)) {
                        Text("COMMAND HISTORY", color = Cyan, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                        Text("Recent replies and action results", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 12.dp))
                        if (history.isEmpty()) Text("No completed actions yet.", color = Muted)
                        history.forEach { item -> Card(Modifier.fillMaxWidth().padding(bottom = 8.dp), colors = CardDefaults.cardColors(containerColor = Panel)) { Text(item, Modifier.padding(12.dp), color = Color.White, fontSize = 13.sp) } }
                        Divider(Modifier.padding(vertical = 12.dp), color = Color(0xFF17384D))
                        Text("DIAGNOSTICS", color = Cyan, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        listOf("Service state" to status, "Wake engine" to if (listening) "Enabled • runtime not device-tested" else "Stopped", "Listening uptime" to uptimeText, "Battery" to "$battery%", "Battery Saver" to if (powerSaverOn) "ON — listening may pause" else "Off", "Battery exemption" to if (onPermissionStatus("BATTERY")) "Granted" else "Not granted", "Last heard" to heard, "Network" to network, "Permission gate" to if (permissionStage.isBlank()) "Setup complete or optional steps skipped" else "$permissionStage pending", "OEM background policy" to "Not detectable by a universal Android API").forEach { (label, value) ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), horizontalArrangement = Arrangement.SpaceBetween) { Text(label, color = Muted, fontSize = 12.sp); Text(value, color = Color.White, fontSize = 12.sp, modifier = Modifier.widthIn(max = 190.dp)) }
                        }
                    }
                    "Diagnostics" -> Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(18.dp)) {
                        Text("LIVE DIAGNOSTICS", color = Cyan, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        val diagRows = listOf(
                            "Vosk model" to diagPrefs.getString("diag_model", "Not confirmed loaded").orEmpty(),
                            "Model error" to diagPrefs.getString("diag_model_error", "—").orEmpty(),
                            "Service state" to status,
                            "Microphone / engine" to diagPrefs.getString("diag_mic", "No microphone callback yet").orEmpty(),
                            "Audio level (RMS dB)" to if (diagPrefs.contains("diag_audio_level")) diagPrefs.getFloat("diag_audio_level", 0f).toString() else "No level reported",
                            "Last partial heard" to diagPrefs.getString("diag_last_partial", "—").orEmpty(),
                            "Last final heard" to diagPrefs.getString("diag_last_final", "—").orEmpty(),
                            "Wake-name match" to diagPrefs.getString("diag_wake_match", "Not evaluated").orEmpty(),
                            "Engine error" to diagPrefs.getString("diag_engine_error", diagPrefs.getString("diag_fallback_error", "—")).orEmpty(),
                            "Accessibility" to if (onPermissionStatus("ACCESSIBILITY")) "Enabled" else "Disabled",
                            "Notification listener" to if (onPermissionStatus("NOTIFICATION_ACCESS")) "Enabled" else "Disabled",
                            "Battery Saver" to if (powerSaverOn) "ON" else "Off",
                            "Battery optimization" to if (onPermissionStatus("BATTERY")) "Exempt" else "Optimized"
                        )
                        diagRows.forEach { (label, value) ->
                            Column(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                                Text(label, color = Muted, fontSize = 11.sp)
                                Text(value, color = Color.White, fontSize = 13.sp)
                            }
                            Divider(color = Color(0xFF17384D))
                        }
                        Text("LAST 50 LOG LINES", color = Cyan, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp, bottom = 6.dp))
                        Text(diagnosticLog, color = Color(0xFFB7D3E5), fontSize = 10.sp)
                        Button(onClick = {
                            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("JARVIS diagnostics", diagnosticLog))
                        }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) { Text("COPY LOG") }
                        OutlinedButton(onClick = { onPermission("BATTERY") }, modifier = Modifier.fillMaxWidth()) { Text("OPEN BATTERY OPTIMIZATION SETTINGS") }
                    }
                    "Permissions" -> Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(18.dp)) {
                        Text("PERMISSIONS", color = Cyan, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        Text("Grant only the capabilities you want JARVIS to use. Android may require you to confirm access in Settings.", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(vertical = 8.dp))
                        val permissionItems = listOf(
                            "MICROPHONE" to "Microphone • voice wake and commands",
                            "NOTIFICATIONS" to "Notifications • foreground service controls",
                            "ACCESSIBILITY" to "Accessibility • UI gestures and label taps",
                            "NOTIFICATION_ACCESS" to "Notification listener • notification reading",
                            "OVERLAY" to "Display over other apps • optional floating HUD",
                            "CONTACTS" to "Contacts • contact lookup",
                            "PHONE_STATE" to "Phone state • call detection",
                            "SMS" to "SMS • message composer",
                            "CALENDAR" to "Calendar • event creation",
                            "CAMERA" to "Camera • camera features",
                            "WRITE_SETTINGS" to "Modify system settings",
                            "USAGE_ACCESS" to "Usage access • app detection",
                            "EXACT_ALARMS" to "Exact alarms • precise reminders",
                            "DND" to "Do Not Disturb access",
                            "BATTERY" to "Battery optimization exemption",
                            "AUTOSTART" to "Autostart / background settings"
                        )
                        permissionItems.forEach { (key, label) ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(label, color = Color.White, fontSize = 12.sp, modifier = Modifier.weight(1f).padding(end = 8.dp))
                                TextButton(onClick = { onPermission(key) }) { Text(if (onPermissionStatus(key)) "✓ Granted" else if (key == permissionStage) "Grant" else "Open", color = if (onPermissionStatus(key)) Color(0xFF63E6A5) else Cyan) }
                            }
                            Divider(color = Color(0xFF17384D))
                        }
                        Text("Green checks are live Android status. OEM autostart cannot be detected reliably and is shown as guidance.", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 10.dp))
                    }
                    else -> Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(18.dp)) {
                        Text("SETTINGS", color = Cyan, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        Text("Assistant", color = Cyan, fontSize = 13.sp, modifier = Modifier.padding(top = 18.dp, bottom = 6.dp))
                        OutlinedTextField(value = assistantName, onValueChange = onAssistantName, modifier = Modifier.fillMaxWidth(), singleLine = true, label = { Text("Wake name") }, supportingText = { Text("Commands must begin with this name.") })
                        Text("Confirmation policy", color = Cyan, fontSize = 13.sp, modifier = Modifier.padding(top = 18.dp, bottom = 6.dp))
                        Column { ConfirmLevel.values().forEach { item ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                RadioButton(selected = level == item, onClick = { onLevel(item) })
                                Column { Text(when(item) { ConfirmLevel.ALWAYS -> "Confirm every action"; ConfirmLevel.SENSITIVE_ONLY -> "Confirm sensitive actions"; ConfirmLevel.NEVER -> "No confirmations" }, color = Color.White); Text(when(item) { ConfirmLevel.ALWAYS -> "Safest default"; ConfirmLevel.SENSITIVE_ONLY -> "Fewer prompts"; ConfirmLevel.NEVER -> "Use with caution" }, color = Muted, fontSize = 11.sp) }
                            }
                        } }
                        Text("Voice", color = Cyan, fontSize = 13.sp, modifier = Modifier.padding(top = 18.dp))
                        Text("Pitch  " + "%.2f".format(Locale.UK, pitch), color = Color.White, fontSize = 12.sp)
                        Slider(value = pitch, onValueChange = onPitch, valueRange = 0.5f..1.5f)
                        Text("Rate  " + "%.2f".format(Locale.UK, rate), color = Color.White, fontSize = 12.sp)
                        Slider(value = rate, onValueChange = onRate, valueRange = 0.5f..1.5f)
                        Text("Background operation is best-effort. Android/OEM power policies may stop microphone listening; test while locked.", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 18.dp))
                    }
                }
                }
                NavigationBar(containerColor = Color(0xFF071321), contentColor = Cyan) {
                    listOf("Home" to "⌂", "Commands" to "≋", "Diagnostics" to "⌁", "Permissions" to "✓", "Settings" to "⚙").forEach { (label, symbol) ->
                        NavigationBarItem(selected = tab == label, onClick = { tab = label }, icon = { Text(symbol, fontSize = 18.sp) }, label = { Text(label, fontSize = 10.sp) }, alwaysShowLabel = true, colors = NavigationBarItemDefaults.colors(selectedIconColor = Cyan, selectedTextColor = Cyan, indicatorColor = Color(0xFF153449), unselectedIconColor = Muted, unselectedTextColor = Muted))
                    }
                }
            }
        }
    }
}
