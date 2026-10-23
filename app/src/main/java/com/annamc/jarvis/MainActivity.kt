package com.annamc.jarvis

import android.Manifest
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Void = Color(0xFF030812)
private val Panel = Color(0xFF091727)
private val Cyan = Color(0xFF49E9FF)
private val Blue = Color(0xFF1976D2)
private val Muted = Color(0xFF8DA9BE)

class MainActivity : ComponentActivity(), TextToSpeech.OnInitListener {
    private var tts: TextToSpeech? = null
    private var recognizer: SpeechRecognizer? = null
    private var isListening by mutableStateOf(false)
    private var status by mutableStateOf("SYSTEM STANDBY")
    private var heard by mutableStateOf("Awaiting your command")
    private var assistantName by mutableStateOf("JARVIS")
    private var language by mutableStateOf("English")
    private var torchOn = false

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startListening() else { status = "MICROPHONE PERMISSION DENIED"; speak("Microphone permission is required for voice commands.") }
    }
    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) toggleTorch() else respond(if (language == "Hindi") "फ्लैशलाइट के लिए कैमरा अनुमति चाहिए।" else "Camera permission is needed for the flashlight.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tts = TextToSpeech(this, this)
        setContent {
            JarvisScreen(
                name = assistantName, language = language, status = status, heard = heard, listening = isListening,
                onName = { assistantName = it.ifBlank { "JARVIS" } },
                onLanguage = { language = it; setSpeechLanguage() },
                onStart = { requestStart() }, onStop = { stopListening() },
                onLauncher = { requestDefaultLauncher() }
            )
        }
    }

    override fun onInit(result: Int) { if (result == TextToSpeech.SUCCESS) setSpeechLanguage() }

    private fun setSpeechLanguage() {
        val locale = if (language == "Hindi") Locale("hi", "IN") else Locale.US
        tts?.language = locale
    }

    private fun requestStart() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
        } else startListening()
    }

    private fun startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            status = "VOICE RECOGNITION UNAVAILABLE"
            respond(if (language == "Hindi") "इस डिवाइस पर वॉइस रिकग्निशन उपलब्ध नहीं है।" else "Speech recognition is not available on this device.")
            return
        }
        try {
            recognizer?.destroy()
            recognizer = SpeechRecognizer.createSpeechRecognizer(this)
            recognizer?.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) { status = "LISTENING"; isListening = true }
                override fun onBeginningOfSpeech() { status = "VOICE DETECTED" }
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() { isListening = false; status = "PROCESSING" }
                override fun onError(error: Int) { isListening = false; status = "READY"; heard = if (language == "Hindi") "फिर से START दबाएँ" else "Tap START to try again" }
                override fun onResults(results: Bundle?) {
                    isListening = false
                    val words = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                    heard = words.ifBlank { "No speech detected" }
                    handleCommand(words.lowercase(Locale.ROOT))
                }
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, if (language == "Hindi") "hi-IN" else "en-US")
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                putExtra(RecognizerIntent.EXTRA_PROMPT, if (language == "Hindi") "JARVIS सुन रहा है" else "JARVIS is listening")
            }
            status = "INITIALIZING VOICE"
            isListening = true
            recognizer?.startListening(intent)
        } catch (_: Exception) {
            isListening = false
            status = "VOICE START FAILED"
        }
    }

    private fun stopListening() {
        try { recognizer?.stopListening(); recognizer?.cancel() } catch (_: Exception) {}
        isListening = false
        status = "SYSTEM STANDBY"
        heard = "Listening stopped"
    }

    private fun handleCommand(command: String) {
        val hindi = language == "Hindi"
        when {
            command.contains("time") || command.contains("समय") || command.contains("टाइम") -> {
                val time = SimpleDateFormat("hh:mm a", if (hindi) Locale("hi", "IN") else Locale.US).format(Date())
                respond(if (hindi) "अभी समय $time है।" else "The time is $time.")
            }
            command.contains("battery") || command.contains("बैटरी") -> {
                val bm = getSystemService(BATTERY_SERVICE) as BatteryManager
                val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                respond(if (hindi) "बैटरी $pct प्रतिशत है।" else "Battery level is $pct percent.")
            }
            command.contains("flashlight") || command.contains("torch") || command.contains("टॉर्च") || command.contains("फ्लैशलाइट") -> {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) cameraPermission.launch(Manifest.permission.CAMERA) else toggleTorch()
            }
            command.contains("settings") || command.contains("सेटिंग") -> {
                respond(if (hindi) "सेटिंग्स खोल रहा हूँ।" else "Opening Settings.")
                startActivity(Intent(Settings.ACTION_SETTINGS))
            }
            command.contains("youtube") || command.contains("यूट्यूब") -> openApp("com.google.android.youtube", "https://www.youtube.com", if (hindi) "YouTube खोल रहा हूँ।" else "Opening YouTube.")
            command.contains("chrome") || command.contains("browser") || command.contains("ब्राउज़र") -> openApp("com.android.chrome", "https://www.google.com", if (hindi) "ब्राउज़र खोल रहा हूँ।" else "Opening your browser.")
            command.contains("stop jarvis") || command.contains("stop listening") || command.contains("बंद") -> { stopListening(); respond(if (hindi) "वॉइस कमांड रोक दिए गए हैं।" else "Voice commands stopped.") }
            else -> respond(if (hindi) "मैंने सुना: $command। अभी इस कमांड का समर्थन नहीं है।" else "I heard: $command. That command is not supported yet.")
        }
    }

    private fun toggleTorch() {
        try {
            val manager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val camera = manager.cameraIdList.firstOrNull { manager.getCameraCharacteristics(it).get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
            if (camera == null) { respond(if (language == "Hindi") "फ्लैशलाइट उपलब्ध नहीं है।" else "No flashlight is available."); return }
            torchOn = !torchOn
            manager.setTorchMode(camera, torchOn)
            respond(if (language == "Hindi") if (torchOn) "फ्लैशलाइट चालू है।" else "फ्लैशलाइट बंद है।" else if (torchOn) "Flashlight on." else "Flashlight off.")
        } catch (_: Exception) { respond(if (language == "Hindi") "फ्लैशलाइट नियंत्रित नहीं कर सका।" else "I could not control the flashlight.") }
    }

    private fun openApp(packageName: String, fallback: String, message: String) {
        respond(message)
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        try { startActivity(launch ?: Intent(Intent.ACTION_VIEW, android.net.Uri.parse(fallback))) }
        catch (_: Exception) { startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(fallback))) }
    }

    private fun requestDefaultLauncher() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val roleManager = getSystemService(RoleManager::class.java)
            if (roleManager.isRoleAvailable(RoleManager.ROLE_HOME) && !roleManager.isRoleHeld(RoleManager.ROLE_HOME)) {
                startActivity(roleManager.createRequestRoleIntent(RoleManager.ROLE_HOME))
            } else startActivity(Intent(Settings.ACTION_HOME_SETTINGS))
        } else startActivity(Intent(Settings.ACTION_HOME_SETTINGS))
    }

    private fun respond(message: String) { heard = message; status = "RESPONSE READY"; speak(message) }
    private fun speak(message: String) { setSpeechLanguage(); tts?.speak(message, TextToSpeech.QUEUE_FLUSH, null, "jarvis-response") }

    override fun onDestroy() {
        stopListening()
        recognizer?.destroy()
        tts?.stop()
        tts?.shutdown()
        super.onDestroy()
    }
}

@Composable
private fun JarvisScreen(
    name: String, language: String, status: String, heard: String, listening: Boolean,
    onName: (String) -> Unit, onLanguage: (String) -> Unit,
    onStart: () -> Unit, onStop: () -> Unit, onLauncher: () -> Unit
) {
    val transition = rememberInfiniteTransition(label = "reactor")
    val pulse by transition.animateFloat(initialValue = 0.94f, targetValue = 1.06f, animationSpec = infiniteRepeatable(tween(1700), RepeatMode.Reverse), label = "pulse")
    MaterialTheme(colorScheme = darkColorScheme(primary = Cyan, background = Void, surface = Panel)) {
        Surface(modifier = Modifier.fillMaxSize(), color = Void) {
            Column(
                modifier = Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF071A2B), Void, Color(0xFF02050A)))).padding(horizontal = 22.dp, vertical = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column {
                        Text("STARK INDUSTRIES  •  AI INTERFACE", color = Cyan, fontSize = 10.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold)
                        Text("PERSONAL ASSISTANT", color = Muted, fontSize = 10.sp, letterSpacing = 1.5.sp)
                    }
                    Text("● ONLINE", color = if (listening) Cyan else Color(0xFF78D7A5), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(contentAlignment = Alignment.Center, modifier = Modifier.size(238.dp)) {
                        Box(Modifier.size(226.dp).scale(pulse).border(1.dp, Cyan.copy(alpha = .32f), CircleShape))
                        Box(Modifier.size(190.dp).border(1.dp, Blue.copy(alpha = .7f), CircleShape).padding(10.dp).border(1.dp, Cyan.copy(alpha = .45f), CircleShape))
                        Box(Modifier.size(148.dp).background(Brush.radialGradient(listOf(Color(0xFF1A9BC0), Color(0xFF0A3155), Color(0xFF06111F))), CircleShape).border(2.dp, Cyan, CircleShape), contentAlignment = Alignment.Center) {
                            Text("J", color = Color.White, fontSize = 78.sp, fontWeight = FontWeight.Light)
                        }
                    }
                    Spacer(Modifier.height(20.dp))
                    Text(name.uppercase(), color = Color.White, fontSize = 29.sp, letterSpacing = 7.sp, fontWeight = FontWeight.Light)
                    Text(if (language == "Hindi") "आपका निजी एआई सहायक" else "YOUR PERSONAL AI ASSISTANT", color = Cyan, fontSize = 10.sp, letterSpacing = 2.sp)
                    Spacer(Modifier.height(22.dp))
                    Text(status, color = if (listening) Cyan else Muted, fontSize = 11.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(10.dp))
                    Surface(color = Panel, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 70.dp), border = androidx.compose.foundation.BorderStroke(1.dp, Cyan.copy(alpha = .25f))) {
                        Text(heard, modifier = Modifier.padding(16.dp), color = Color(0xFFE0F5FF), fontSize = 14.sp, textAlign = TextAlign.Center)
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (language == "Hindi") "नाम" else "NAME", color = Muted, fontSize = 10.sp)
                        var nameInput by remember(name) { mutableStateOf(name) }
                        OutlinedTextField(value = nameInput, onValueChange = { nameInput = it; onName(it) }, singleLine = true, modifier = Modifier.weight(1f).height(54.dp), textStyle = androidx.compose.ui.text.TextStyle(color = Color.White, fontSize = 14.sp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Cyan, unfocusedBorderColor = Muted))
                        var selected by remember(language) { mutableStateOf(language) }
                        TextButton(onClick = { selected = if (selected == "English") "Hindi" else "English"; onLanguage(selected) }) { Text(selected, color = Cyan, fontSize = 12.sp) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                        Button(onClick = onStart, modifier = Modifier.weight(1f).height(54.dp), colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Void), shape = RoundedCornerShape(12.dp)) {
                            Text(if (language == "Hindi") "▶ शुरू करें" else "▶ START JARVIS", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        }
                        OutlinedButton(onClick = onStop, modifier = Modifier.weight(1f).height(54.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFFF7B83)), border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFFF7B83)), shape = RoundedCornerShape(12.dp)) {
                            Text(if (language == "Hindi") "■ रोकें" else "■ STOP", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        }
                    }
                    OutlinedButton(onClick = onLauncher, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.outlinedButtonColors(contentColor = Cyan), border = androidx.compose.foundation.BorderStroke(1.dp, Cyan.copy(alpha = .4f)), shape = RoundedCornerShape(12.dp)) {
                        Text(if (language == "Hindi") "डिफ़ॉल्ट होम स्क्रीन के रूप में सेट करें" else "SET AS DEFAULT HOME SCREEN", fontSize = 11.sp, letterSpacing = 1.sp)
                    }
                    Text(if (language == "Hindi") "कमांड: समय • बैटरी • टॉर्च • सेटिंग्स • YouTube • Chrome" else "COMMANDS: TIME  •  BATTERY  •  FLASHLIGHT  •  SETTINGS  •  YOUTUBE  •  CHROME", color = Muted, fontSize = 9.sp, textAlign = TextAlign.Center, letterSpacing = .5.sp)
                }
            }
        }
    }
}
