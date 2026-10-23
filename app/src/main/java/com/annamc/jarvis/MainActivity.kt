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
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
    private var torchOn = false
    private val history = mutableStateListOf<String>()

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshPermissions() }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshPermissions() }

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
                { requestStart() }, { stopListening() },
                { level = it; prefs.edit().putString("level", it.name).apply() },
                { pitch = it; prefs.edit().putFloat("pitch", it).apply(); applyVoice() },
                { rate = it; prefs.edit().putFloat("rate", it).apply(); applyVoice() },
                { name -> lifecycleScope.launch { assistantSettings.setAssistantName(name) } },
                { resolvePending(true) }, { resolvePending(false) }, { requestPermission(it) }, { countdown = it })
        }
    }

    override fun onInit(result: Int) { if (result == TextToSpeech.SUCCESS) applyVoice() }
    private fun applyVoice() { tts?.language = Locale.UK; tts?.setPitch(pitch); tts?.setSpeechRate(rate) }
    private fun speak(text: String) { applyVoice(); tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "jarvis-response") }
    private fun tone(tone: Int) { try { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 60).startTone(tone, 120) } catch (_: Exception) {} }

    private fun refreshPermissions() {
        val mic = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val notifications = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        permissionStage = when { !mic -> "MICROPHONE"; !notifications -> "NOTIFICATIONS"; else -> "" }
        if (!mic || !notifications) status = "PERMISSIONS REQUIRED"
    }
    override fun onResume() { super.onResume(); refreshPermissions() }

    private fun requestPermission(which: String) {
        when (which) {
            "MICROPHONE" -> micPermission.launch(Manifest.permission.RECORD_AUDIO)
            "NOTIFICATIONS" -> if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) else refreshPermissions()
            "ACCESSIBILITY" -> startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            "NOTIFICATION_ACCESS" -> startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))
            "WRITE_SETTINGS" -> startActivity(Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS))
            "BATTERY" -> startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            else -> startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + packageName)))
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
        stopListening()
        try { unregisterReceiver(serviceReceiver) } catch (_: Exception) {}
        recognizer?.destroy()
        tts?.stop()
        tts?.shutdown()
        super.onDestroy()
    }
}

@Composable
private fun JarvisScreen(
    status: String, heard: String, listening: Boolean, bootText: String, clock: String, battery: Int, network: String,
    history: List<String>, level: ConfirmLevel, pitch: Float, rate: Float, pending: PendingAction?, countdown: Int,
    permissionStage: String, assistantName: String, onStart: () -> Unit, onStop: () -> Unit, onLevel: (ConfirmLevel) -> Unit,
    onPitch: (Float) -> Unit, onRate: (Float) -> Unit, onAssistantName: (String) -> Unit, onConfirm: () -> Unit, onCancel: () -> Unit,
    onPermission: (String) -> Unit, onCountdown: (Int) -> Unit
) {
    val transition = rememberInfiniteTransition(label = "reactor")
    val pulse by transition.animateFloat(0.92f, 1.06f, infiniteRepeatable(tween(1400), RepeatMode.Reverse), label = "pulse")
    val wave by transition.animateFloat(0.25f, 1f, infiniteRepeatable(tween(500), RepeatMode.Reverse), label = "wave")
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
            Column(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF071A2B), Void))).padding(16.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column { Text("J.A.R.V.I.S.", color = Cyan, fontSize = 22.sp, letterSpacing = 4.sp); Text(bootText, color = Muted, fontSize = 11.sp) }
                    Column(horizontalAlignment = Alignment.End) { Text(clock, color = Color.White, fontSize = 16.sp); Text(battery.toString() + "% • " + network, color = Cyan, fontSize = 10.sp) }
                }
                if (permissionStage.isNotBlank()) {
                    Card(Modifier.fillMaxWidth().padding(top = 8.dp), colors = CardDefaults.cardColors(containerColor = Panel)) {
                        Column(Modifier.padding(12.dp)) {
                            Text("PERMISSION ONBOARDING", color = Cyan, fontWeight = FontWeight.Bold)
                            Text(if (permissionStage == "MICROPHONE") "Microphone permission lets JARVIS hear commands. You can skip it and grant it later." else "Notification permission lets Android show the ongoing assistant notification. You can skip it and grant it later.", color = Color.White, fontSize = 12.sp)
                            Row { Button(onClick = { onPermission(permissionStage) }) { Text("Grant") }; TextButton(onClick = {}) { Text("Skip", color = Muted) } }
                            TextButton(onClick = { onPermission("ACCESSIBILITY") }) { Text("Accessibility settings (optional)", color = Cyan) }
                            TextButton(onClick = { onPermission("NOTIFICATION_ACCESS") }) { Text("Notification access (optional)", color = Cyan) }
                            TextButton(onClick = { onPermission("WRITE_SETTINGS") }) { Text("Modify system settings (optional)", color = Cyan) }
                            TextButton(onClick = { onPermission("BATTERY") }) { Text("Battery optimization settings (optional)", color = Cyan) }
                        }
                    }
                }
                Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(210.dp).scale(pulse).border(1.dp, Cyan.copy(alpha = .3f), CircleShape))
                    Box(Modifier.size(170.dp).border(2.dp, Cyan.copy(alpha = .65f), CircleShape).padding(12.dp).border(1.dp, Color(0xFF1976D2), CircleShape))
                    Box(Modifier.size(128.dp).background(Brush.radialGradient(listOf(Color(0xFF28C9F0), Color(0xFF0A3155), Color(0xFF06111F))), CircleShape).border(2.dp, Cyan, CircleShape), contentAlignment = Alignment.Center) { Text("J", color = Color.White, fontSize = 68.sp, fontWeight = FontWeight.Light) }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { repeat(24) { i -> Box(Modifier.padding(horizontal = 2.dp).width(4.dp).height((8 + (i % 5 * 4 * wave)).dp).background(if (listening) Cyan else Cyan.copy(alpha = .35f), RoundedCornerShape(3.dp))) } }
                Text(status, Modifier.fillMaxWidth().padding(top = 8.dp), color = Cyan, textAlign = TextAlign.Center, fontSize = 10.sp, letterSpacing = 2.sp)
                Card(Modifier.fillMaxWidth().padding(top = 8.dp), colors = CardDefaults.cardColors(containerColor = Panel)) { Text(heard, Modifier.padding(12.dp), color = Color.White, textAlign = TextAlign.Center) }
                if (pending != null) Card(Modifier.fillMaxWidth().padding(top = 8.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFF12283B)), border = androidx.compose.foundation.BorderStroke(1.dp, Cyan)) {
                    Column(Modifier.padding(12.dp)) {
                        Text("CONFIRM ACTION", color = Cyan, fontWeight = FontWeight.Bold)
                        Text(pending.description, color = Color.White)
                        Text("Shall I proceed, sir? • " + countdown + " seconds", color = Muted, fontSize = 12.sp)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = onConfirm, modifier = Modifier.weight(1f)) { Text("CONFIRM") }
                            OutlinedButton(onClick = onCancel, modifier = Modifier.weight(1f)) { Text("CANCEL") }
                        }
                    }
                }
                Text("ASSISTANT NAME", color = Muted, fontSize = 10.sp, modifier = Modifier.padding(top = 8.dp))
                OutlinedTextField(
                    value = assistantName,
                    onValueChange = onAssistantName,
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Assistant name") },
                    supportingText = { Text("Commands must start with this name. Unaddressed speech is discarded.") },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                        focusedBorderColor = Cyan, unfocusedBorderColor = Muted,
                        focusedLabelColor = Cyan, unfocusedLabelColor = Muted
                    )
                )
                Text("CONFIRMATION LEVEL", color = Muted, fontSize = 10.sp, modifier = Modifier.padding(top = 8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    ConfirmLevel.values().forEach { item -> FilterChip(selected = level == item, onClick = { onLevel(item) }, label = { Text(when(item) { ConfirmLevel.ALWAYS -> "Always"; ConfirmLevel.SENSITIVE_ONLY -> "Sensitive"; ConfirmLevel.NEVER -> "Never" }, fontSize = 10.sp) }) }
                }
                Text("VOICE PITCH " + "%.2f".format(Locale.UK, pitch) + " • RATE " + "%.2f".format(Locale.UK, rate), color = Muted, fontSize = 10.sp)
                Slider(value = pitch, onValueChange = onPitch, valueRange = 0.5f..1.5f)
                Slider(value = rate, onValueChange = onRate, valueRange = 0.5f..1.5f)
                Button(
                    onClick = { if (listening) onStop() else onStart() },
                    modifier = Modifier.fillMaxWidth().height(58.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = if (listening) Color(0xFF7D2638) else Color(0xFF087C91))
                ) { Text(if (listening) "⏻  POWER OFF — RELEASE MICROPHONE" else "⏻  POWER ON — START JARVIS", fontWeight = FontWeight.Bold) }
                Text("COMMAND HISTORY", color = Cyan, fontSize = 10.sp, modifier = Modifier.padding(top = 6.dp))
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 64.dp)) { items(history) { Text(it, color = Muted, fontSize = 10.sp, modifier = Modifier.padding(vertical = 2.dp)) } }
            }
        }
    }
}
