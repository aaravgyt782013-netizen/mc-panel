package com.annamc.jarvis.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.os.Handler
import android.os.Looper
import android.telephony.PhoneStateListener
import android.media.ToneGenerator
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.annamc.jarvis.MainActivity
import com.annamc.jarvis.accessibility.JarvisAccessibilityService
import com.annamc.jarvis.R
import com.annamc.jarvis.settings.AssistantSettings
import com.annamc.jarvis.voice.AssistantNameMatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener as VoskListener
import org.vosk.android.SpeechService
import org.vosk.android.StorageService
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class JarvisForegroundService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var model: Model? = null
    private var speechService: SpeechService? = null
    private var commandRecognizer: SpeechRecognizer? = null
    private var tts: android.speech.tts.TextToSpeech? = null
    private var assistantName = "Jarvis"
    private var listeningForCommand = false
    private var fallbackActive = false
    private var pendingCommand: String? = null
    private var confirmationTimeout: Job? = null
    private var pausedByPowerSaver = false
    private var pausedByOtherRecorder = false
    private var pausedByCall = false
    private var torchOn = false
    private var stopAfterSpeech = false
    private var listeningWakeLock: PowerManager.WakeLock? = null
    private var listeningStartedAt = 0L
    private val audioManager by lazy { getSystemService(AUDIO_SERVICE) as AudioManager }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "JARVIS assistant", NotificationManager.IMPORTANCE_LOW)
            channel.description = "Status and controls for JARVIS offline voice assistant"
            channel.setShowBadge(false)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        tts = android.speech.tts.TextToSpeech(this) { status ->
            if (status == android.speech.tts.TextToSpeech.SUCCESS) {
                tts?.language = Locale.UK
                tts?.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onError(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) {
                        Handler(Looper.getMainLooper()).post {
                            if (stopAfterSpeech) {
                                stopAfterSpeech = false
                                stopEngine()
                                sendState("OFF")
                                stopForegroundCompat()
                                stopSelf()
                            } else if (isEnabled() && !pausedByPowerSaver && !pausedByOtherRecorder && !pausedByCall) {
                                if (pendingCommand != null && listeningForCommand) startCommandRecognition()
                                else if (pendingCommand == null && !listeningForCommand) startWakeListening()
                            }
                        }
                    }
                })
            }
        }
        scope.launch(Dispatchers.Main) {
            AssistantSettings(applicationContext).assistantName.collect { newName ->
                if (newName != assistantName) {
                    assistantName = newName
                    if (model != null && isEnabled() && !pausedByPowerSaver && !pausedByOtherRecorder && !pausedByCall) {
                        listeningForCommand = false
                        fallbackActive = false
                        stopEngine()
                        startWakeListening()
                    }
                }
            }
        }

        if (Build.VERSION.SDK_INT >= 29) {
            audioManager.registerAudioRecordingCallback(object : AudioManager.AudioRecordingCallback() {
                override fun onRecordingConfigChanged(configs: List<AudioRecordingConfiguration>?) {
                    val others = configs.orEmpty().any { config -> runCatching { config.javaClass.getMethod("getClientUid").invoke(config) as? Int }.getOrNull()?.let { it != applicationInfo.uid } ?: false }
                    if (others && !pausedByOtherRecorder) {
                        pausedByOtherRecorder = true
                        stopEngine()
                        updateNotification("Paused: another app is using the microphone")
                    } else if (!others && pausedByOtherRecorder) {
                        pausedByOtherRecorder = false
                        if (isEnabled() && !pausedByPowerSaver && !pausedByCall) startWakeListening()
                    }
                }
            }, Handler(Looper.getMainLooper()))
        }
        val powerFilter = android.content.IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
        registerReceiver(powerReceiver, powerFilter)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
            try {
                val telephony = getSystemService(TELEPHONY_SERVICE) as TelephonyManager
                telephony.listen(object : PhoneStateListener() {
                    override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                        val inCall = state != TelephonyManager.CALL_STATE_IDLE
                        if (inCall) {
                            pausedByCall = true
                            stopEngine()
                            updateNotification("Paused during phone call")
                        } else if (pausedByCall) {
                            pausedByCall = false
                            if (isEnabled() && !pausedByPowerSaver && !pausedByOtherRecorder) startWakeListening()
                        }
                    }
                }, PhoneStateListener.LISTEN_CALL_STATE)
            } catch (_: Exception) {}
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, false).apply()
                stopEngine()
                sendState("OFF")
                stopForegroundCompat()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_CONFIRM -> {
                val command = pendingCommand
                pendingCommand = null
                confirmationTimeout?.cancel()
                confirmationTimeout = null
                if (command != null) executeCommand(command)
                updateNotification("Listening in background")
                return START_STICKY
            }
            ACTION_CANCEL -> {
                pendingCommand = null
                confirmationTimeout?.cancel()
                confirmationTimeout = null
                listeningForCommand = false
                speak("Cancelled, sir.")
                updateNotification("Listening in background")
                return START_STICKY
            }
            ACTION_START -> getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, true).apply()
        }

        if (!getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_ENABLED, false)) {
            stopSelf()
            return START_NOT_STICKY
        }
        val micGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val notificationGranted = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (!micGranted || !notificationGranted) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, false).apply()
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(NOTIFICATION_ID, buildNotification("Starting offline voice engine"))
        val watchdog = PeriodicWorkRequestBuilder<JarvisWatchdogWorker>(15, java.util.concurrent.TimeUnit.MINUTES).build()
        WorkManager.getInstance(applicationContext).enqueueUniquePeriodicWork(
            "jarvis-background-watchdog", ExistingPeriodicWorkPolicy.UPDATE, watchdog
        )
        val power = getSystemService(POWER_SERVICE) as PowerManager
        if (power.isPowerSaveMode) {
            pausedByPowerSaver = true
            updateNotification("Paused: Battery Saver is on")
            stopEngine()
            return START_STICKY
        }
        pausedByPowerSaver = false
        scope.launch(Dispatchers.Main) { loadModelAndListen() }
        return START_STICKY
    }

    private fun loadModelAndListen() {
        if (model != null) {
            startWakeListening()
            return
        }
        StorageService.unpack(applicationContext, "model-en-us", "model-en-us",
            { loaded ->
                model = loaded
                diagnostic("model", "Vosk model loaded")
                startWakeListening()
            },
            { error ->
                diagnostic("model_error", error.message ?: error.javaClass.simpleName)
                updateNotification("Vosk unavailable; using Android speech fallback")
                startFallbackWakeRecognition()
            })
    }


    private fun diagnostic(key: String, value: String) {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        prefs.edit().putString("diag_" + key, value).putLong("diag_updated", System.currentTimeMillis()).apply()
        val old = prefs.getString("diag_log", "").orEmpty().split("\n").filter(String::isNotBlank)
        val line = SimpleDateFormat("HH:mm:ss", Locale.UK).format(Date()) + " [" + key + "] " + value
        prefs.edit().putString("diag_log", (old + line).takeLast(50).joinToString("\n")).apply()
    }

    private fun startFallbackWakeRecognition() {
        if (!isEnabled() || pausedByPowerSaver || pausedByOtherRecorder || pausedByCall || listeningForCommand) return
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            diagnostic("fallback_error", "Android SpeechRecognizer unavailable")
            sendState("Error")
            updateNotification("No speech engine available")
            return
        }
        try {
            commandRecognizer?.cancel()
            commandRecognizer?.destroy()
            commandRecognizer = SpeechRecognizer.createSpeechRecognizer(applicationContext).also { sr ->
                sr.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: android.os.Bundle?) { diagnostic("mic", "Android speech recognizer ready"); sendState("Standby") }
                    override fun onBeginningOfSpeech() { diagnostic("mic", "Speech detected") }
                    override fun onRmsChanged(rmsdB: Float) { getSharedPreferences(PREFS, MODE_PRIVATE).edit().putFloat("diag_audio_level", rmsdB).apply() }
                    override fun onBufferReceived(buffer: ByteArray?) {}
                    override fun onEndOfSpeech() {}
                    override fun onError(error: Int) {
                        diagnostic("fallback_error", "SpeechRecognizer error " + error)
                        scope.launch(Dispatchers.Main) { delay(900); if (isEnabled() && !listeningForCommand) startFallbackWakeRecognition() }
                    }
                    override fun onResults(results: android.os.Bundle?) {
                        val raw = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                        diagnostic("last_final", raw)
                        val command = AssistantNameMatcher.extractCommand(raw, assistantName)
                        if (command != null) {
                            diagnostic("wake_match", "MATCH: " + raw)
                            try { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70).startTone(ToneGenerator.TONE_PROP_BEEP, 120) } catch (_: Exception) {}
                            sendCommand(raw)
                            sendState("Listening")
                            if (command.isBlank()) {
                                listeningForCommand = true
                                startCommandRecognition()
                            } else {
                                sendCommand(command)
                                handleBackgroundCommand(command)
                            }
                        } else {
                            diagnostic("wake_match", "NO MATCH: " + raw)
                            scope.launch(Dispatchers.Main) { delay(250); if (isEnabled() && !listeningForCommand) startFallbackWakeRecognition() }
                        }
                    }
                    override fun onPartialResults(partialResults: android.os.Bundle?) {
                        val partial = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                        if (partial.isNotBlank()) diagnostic("last_partial", partial)
                    }
                    override fun onEvent(eventType: Int, params: android.os.Bundle?) {}
                })
                val speechIntent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                }
                sr.startListening(speechIntent)
                diagnostic("engine", "Android speech fallback active; may require network/provider")
            }
        } catch (e: Exception) {
            diagnostic("fallback_error", e.message ?: e.javaClass.simpleName)
            scope.launch(Dispatchers.Main) { delay(1500); if (isEnabled() && !listeningForCommand) startFallbackWakeRecognition() }
        }
    }

    private fun startWakeListening() {
        if (listeningForCommand || pausedByPowerSaver || pausedByOtherRecorder || pausedByCall || !isEnabled()) return
        acquireListeningWakeLock()
        try { speechService?.stop() } catch (_: Exception) {}
        speechService = null
        // Android SpeechRecognizer is the primary live-demo path. Unlike Vosk's current
        // broken asset layout, it can use the device's installed recognition provider.
        updateNotification("Standby — say $assistantName")
        diagnostic("engine", "Android SpeechRecognizer primary; availability depends on device provider")
        startFallbackWakeRecognition()
    }

    private val wakeListener = object : VoskListener {
        override fun onPartialResult(hypothesis: String?) { activateWakeIfAddressed(hypothesis) }
        override fun onResult(hypothesis: String?) { activateWakeIfAddressed(hypothesis) }
        override fun onFinalResult(hypothesis: String?) { activateWakeIfAddressed(hypothesis) }
        override fun onError(exception: Exception?) { if (!pausedByPowerSaver && !listeningForCommand) startWakeListening() }
        override fun onTimeout() { if (!pausedByPowerSaver && !listeningForCommand) startWakeListening() }
    }

    private fun activateWakeIfAddressed(hypothesis: String?) {
        if (listeningForCommand || !isEnabled()) return
        val text = parseText(hypothesis)
        if (!AssistantNameMatcher.isAddressed(text, assistantName)) return
        listeningForCommand = true
        try { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70).startTone(ToneGenerator.TONE_PROP_BEEP, 100) } catch (_: Exception) {}
        speechService?.stop()
        speechService = null
        updateNotification("Listening for command")
        sendState("Listening")
        startCommandRecognition()
    }

    private fun startCommandRecognition() {
        acquireListeningWakeLock()
        try { speechService?.stop() } catch (_: Exception) {}
        speechService = null
        startFallbackCommandRecognition()
    }

    private val commandVoskListener = object : VoskListener {
        override fun onPartialResult(hypothesis: String?) {
            sendState("Listening")
        }
        override fun onResult(hypothesis: String?) {}
        override fun onFinalResult(hypothesis: String?) {
            val text = parseText(hypothesis).trim().lowercase(Locale.ROOT)
            val confidence = confidenceOf(hypothesis, text)
            if (text.isBlank() || confidence < 0.35f) {
                startFallbackCommandRecognition()
                return
            }
            listeningForCommand = false
            fallbackActive = false
            speechService?.stop()
            speechService = null
            sendState("Processing")
            if (pendingCommand != null) {
                handleConfirmationResponse(text)
            } else {
                sendCommand(text)
                handleBackgroundCommand(text)
            }
        }
        override fun onError(exception: Exception?) { if (listeningForCommand) startFallbackCommandRecognition() }
        override fun onTimeout() { if (listeningForCommand) startFallbackCommandRecognition() }
    }

    private fun startFallbackCommandRecognition() {
        if (fallbackActive) return
        fallbackActive = true
        listeningForCommand = true
        try { speechService?.stop() } catch (_: Exception) {}
        speechService = null
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            fallbackActive = false
            listeningForCommand = false
            speak("Command recognition is unavailable, sir.")
            return
        }
        try {
            commandRecognizer?.destroy()
            commandRecognizer = SpeechRecognizer.createSpeechRecognizer(applicationContext).also { recognizer ->
                recognizer.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: android.os.Bundle?) { sendState("Listening") }
                    override fun onBeginningOfSpeech() {}
                    override fun onRmsChanged(rmsdB: Float) {}
                    override fun onBufferReceived(buffer: ByteArray?) {}
                    override fun onEndOfSpeech() { sendState("Processing"); updateNotification("Processing command") }
                    override fun onError(error: Int) {
                        fallbackActive = false
                        if (pendingCommand != null) {
                            listeningForCommand = true
                            speak("Please say yes to proceed or no to cancel, sir.")
                        } else {
                            listeningForCommand = false
                            startWakeListening()
                        }
                    }
                    override fun onResults(results: android.os.Bundle?) {
                        val raw = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                        val command = raw.trim().lowercase(Locale.ROOT)
                        listeningForCommand = false
                        fallbackActive = false
                        if (command.isNotBlank()) {
                            sendState("Processing")
                            if (pendingCommand != null) handleConfirmationResponse(command)
                            else {
                                sendCommand(command)
                                handleBackgroundCommand(command)
                            }
                        } else if (pendingCommand != null) {
                            listeningForCommand = true
                            speak("Please say yes to proceed or no to cancel, sir.")
                        } else startWakeListening()
                    }
                    override fun onPartialResults(partialResults: android.os.Bundle?) {}
                    override fun onEvent(eventType: Int, params: android.os.Bundle?) {}
                })
                val speechIntent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-GB")
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                }
                recognizer.startListening(speechIntent)
            }
        } catch (_: Exception) {
            listeningForCommand = false
            fallbackActive = false
            startWakeListening()
        }
    }

    private fun confidenceOf(json: String?, text: String): Float {
        return try {
            val words = JSONObject(json ?: "{}").optJSONArray("result")
            if (words == null || words.length() == 0) {
                if (text.isBlank()) 0f else 0.5f
            } else {
                var total = 0.0
                for (i in 0 until words.length()) total += words.optJSONObject(i)?.optDouble("conf", 0.0) ?: 0.0
                (total / words.length()).toFloat()
            }
        } catch (_: Exception) { if (text.isBlank()) 0f else 0.25f }
    }

    private fun handleBackgroundCommand(command: String) {
        when {
            command.contains("stop listening") || command.contains("go to sleep") -> {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, false).apply()
                listeningForCommand = false
                stopEngine()
                stopAfterSpeech = true
                speak("Going to sleep, sir.")
            }
            command.contains("time") -> {
                speak("The time is " + SimpleDateFormat("h:mm a", Locale.UK).format(Date()) + ", sir.")
            }
            command.contains("battery") -> {
                val level = (getSystemService(BATTERY_SERVICE) as BatteryManager).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                speak("Battery level is $level percent, sir.")
            }
            else -> {
                // Any action that changes the device or opens an app requires explicit notification confirmation.
                pendingCommand = command
                confirmationTimeout?.cancel()
                confirmationTimeout = scope.launch(Dispatchers.Main) {
                    delay(10_000)
                    if (pendingCommand == command) {
                        pendingCommand = null
                        listeningForCommand = false
                        speak("Confirmation timed out, sir.")
                        updateNotification("Action cancelled — confirmation timed out")
                    }
                }
                listeningForCommand = true
                updateNotification("Confirm action: $command")
                speak("Shall I proceed, sir?")
            }
        }
    }

    private fun handleConfirmationResponse(response: String) {
        val requested = pendingCommand ?: run {
            listeningForCommand = false
            startWakeListening()
            return
        }
        val answer = response.lowercase(Locale.ROOT).trim()
        pendingCommand = null
        confirmationTimeout?.cancel()
        confirmationTimeout = null
        listeningForCommand = false
        fallbackActive = false
        if (answer == "yes" || answer == "confirm" || answer.contains("go ahead") || answer == "proceed") {
            updateNotification("Executing confirmed action")
            executeCommand(requested)
        } else if (answer == "no" || answer == "cancel" || answer.contains("stop")) {
            updateNotification("Action cancelled")
            speak("Cancelled, sir.")
        } else {
            pendingCommand = requested
            listeningForCommand = true
            speak("Please say yes to proceed or no to cancel, sir.")
        }
    }

    private fun executeCommand(command: String) {
        val c = command.lowercase(Locale.ROOT).trim()
        fun launch(intent: Intent): Boolean = try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (intent.resolveActivity(packageManager) == null) false else {
                startActivity(intent)
                true
            }
        } catch (_: Exception) { false }
        fun announce(action: String, success: Boolean) {
            val message = if (success) "The system accepted the request to $action, sir." else "I couldn't $action. The required app, permission, or service may be unavailable, sir."
            updateNotification(if (success) "Command accepted: $action" else "Command failed: $action")
            speak(message)
        }

        if (c.contains("flashlight") || c.contains("torch")) {
            val success = try {
                val camera = getSystemService(Context.CAMERA_SERVICE) as android.hardware.camera2.CameraManager
                val id = camera.cameraIdList.firstOrNull {
                    camera.getCameraCharacteristics(it).get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
                }
                if (id == null) false else {
                    val turnOn = !(c.contains("off") || (c.contains("toggle") && torchOn))
                    camera.setTorchMode(id, turnOn)
                    torchOn = turnOn
                    true
                }
            } catch (_: Exception) { false }
            announce(if (torchOn) "turn on the flashlight" else "turn off the flashlight", success)
            return
        }

        val accessAction = when {
            c == "home" || c.contains("go home") || c.contains("press home") -> "home"
            c == "back" || c.contains("go back") || c.contains("press back") -> "back"
            c.contains("recents") || c.contains("recent apps") -> "recents"
            c.contains("notification shade") || c.contains("show notifications") || c.contains("open notifications") -> "notifications"
            c.contains("quick settings") || c.contains("control center") -> "quick settings"
            c.contains("take screenshot") || c == "screenshot" -> "screenshot"
            c.startsWith("swipe up") -> "swipe:up"
            c.startsWith("swipe down") -> "swipe:down"
            c.startsWith("swipe left") -> "swipe:left"
            c.startsWith("swipe right") -> "swipe:right"
            c.startsWith("scroll up") -> "scroll:up"
            c.startsWith("scroll down") -> "scroll:down"
            c.startsWith("tap ") || c.startsWith("click ") -> "click:" + c.substringAfter(' ').trim()
            c.startsWith("press ") || c.startsWith("click the ") -> "click:" + c.substringAfter(' ').removePrefix("the ").trim()
            c.startsWith("type ") -> "type:" + command.substringAfter(' ').trim()
            else -> null
        }
        if (accessAction != null) {
            val success = when {
                accessAction.startsWith("swipe:") -> JarvisAccessibilityService.swipe(accessAction.substringAfter(':'))
                accessAction.startsWith("scroll:") -> JarvisAccessibilityService.scroll(accessAction.substringAfter(':'))
                accessAction.startsWith("click:") -> JarvisAccessibilityService.click(accessAction.substringAfter(':'))
                accessAction.startsWith("type:") -> JarvisAccessibilityService.type(accessAction.substringAfter(':'))
                else -> JarvisAccessibilityService.global(accessAction)
            }
            announce("perform the requested screen action", success)
            return
        }

        val intent: Intent? = when {
            c.contains("youtube") -> packageManager.getLaunchIntentForPackage("com.google.android.youtube")
                ?: Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://www.youtube.com"))
            c.contains("whatsapp") -> packageManager.getLaunchIntentForPackage("com.whatsapp")
                ?: Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://wa.me/"))
            c.contains("chrome") || c.contains("browser") -> packageManager.getLaunchIntentForPackage("com.android.chrome")
                ?: Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://www.google.com"))
            c.startsWith("open ") -> {
                val requested = c.removePrefix("open ").trim()
                val known = mapOf("maps" to "com.google.android.apps.maps", "camera" to "com.android.camera",
                    "settings" to "com.android.settings", "phone" to "com.google.android.dialer",
                    "messages" to "com.google.android.apps.messaging", "clock" to "com.google.android.deskclock")
                val pkg = known[requested]
                if (pkg != null) packageManager.getLaunchIntentForPackage(pkg)
                else Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://www.google.com/search?q=" + android.net.Uri.encode(requested)))
            }
            c.contains("wifi") || c.contains("wi-fi") -> Intent(android.provider.Settings.ACTION_WIFI_SETTINGS)
            c.contains("bluetooth") -> Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS)
            c.contains("airplane") -> Intent(android.provider.Settings.ACTION_AIRPLANE_MODE_SETTINGS)
            c.contains("hotspot") -> Intent(android.provider.Settings.ACTION_WIRELESS_SETTINGS)
            c.contains("location") -> Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            c.contains("brightness") || c.contains("rotation") -> Intent(android.provider.Settings.ACTION_DISPLAY_SETTINGS)
            c.contains("dnd") || c.contains("do not disturb") -> Intent(android.provider.Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
            c.contains("settings") -> Intent(android.provider.Settings.ACTION_SETTINGS)
            c.contains("search the web for ") -> Intent(Intent.ACTION_WEB_SEARCH).putExtra(android.app.SearchManager.QUERY, c.substringAfter("search the web for "))
            c.startsWith("search for ") -> Intent(Intent.ACTION_WEB_SEARCH).putExtra(android.app.SearchManager.QUERY, c.substringAfter("search for "))
            c.startsWith("navigate to ") || c.startsWith("directions to ") -> {
                val destination = c.substringAfter(" to ").trim()
                Intent(Intent.ACTION_VIEW, android.net.Uri.parse("google.navigation:q=" + android.net.Uri.encode(destination)))
                    .setPackage("com.google.android.apps.maps")
            }
            c.startsWith("call ") -> Intent(Intent.ACTION_DIAL, android.net.Uri.parse("tel:" + android.net.Uri.encode(command.substringAfter("call ").trim())))
            c.startsWith("text ") || c.startsWith("send sms ") || c.startsWith("compose sms") -> {
                val body = if (c.startsWith("text ")) command.substringAfter("text ").trim() else ""
                Intent(Intent.ACTION_SENDTO, android.net.Uri.parse("smsto:")).putExtra("sms_body", body)
            }
            c.contains("take a photo") || c == "open camera" -> Intent(android.provider.MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)
            c.startsWith("set an alarm") || c.startsWith("set alarm") -> Intent(android.provider.AlarmClock.ACTION_SET_ALARM)
            c.startsWith("set a timer") || c.startsWith("set timer") -> Intent(android.provider.AlarmClock.ACTION_SET_TIMER)
            c.contains("volume up") || c.contains("increase volume") -> null
            c.contains("volume down") || c.contains("decrease volume") -> null
            c.contains("pause music") || c.contains("play music") || c.contains("next track") || c.contains("previous track") -> null
            else -> null
        }
        if (c.contains("volume up") || c.contains("increase volume") || c.contains("volume down") || c.contains("decrease volume")) {
            val direction = if (c.contains("up") || c.contains("increase")) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER
            val success = try { audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI); true } catch (_: Exception) { false }
            announce("adjust media volume", success); return
        }
        if (c.contains("pause music") || c.contains("play music") || c.contains("next track") || c.contains("previous track")) {
            val key = when {
                c.contains("next") -> android.view.KeyEvent.KEYCODE_MEDIA_NEXT
                c.contains("previous") -> android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS
                c.contains("pause") -> android.view.KeyEvent.KEYCODE_MEDIA_PAUSE
                else -> android.view.KeyEvent.KEYCODE_MEDIA_PLAY
            }
            val success = try {
                val down = android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, key)
                val up = android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, key)
                audioManager.dispatchMediaKeyEvent(down); audioManager.dispatchMediaKeyEvent(up); true
            } catch (_: Exception) { false }
            announce("control media playback", success); return
        }
        val success = intent?.let { launch(it) } ?: false
        val actionLabel = when {
            c.startsWith("call ") -> "open the dialer"
            c.startsWith("text ") || c.startsWith("send sms ") || c.startsWith("compose sms") -> "open SMS composition"
            c.startsWith("navigate") || c.startsWith("directions") -> "open Maps navigation"
            c.contains("search") -> "open web search"
            else -> "open the requested app or settings"
        }
        announce(actionLabel, success)
    }

    private fun isEnabled(): Boolean = getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

    private val powerReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val power = getSystemService(POWER_SERVICE) as PowerManager
            if (power.isPowerSaveMode) {
                pausedByPowerSaver = true
                stopEngine()
                updateNotification("Paused: Battery Saver is on")
                sendState("Standby")
            } else if (pausedByPowerSaver) {
                pausedByPowerSaver = false
                if (isEnabled() && !pausedByOtherRecorder && !pausedByCall) loadModelAndListen()
            }
        }
    }

    private fun parseText(json: String?): String =
        try {
            val value = JSONObject(json ?: "{}")
            value.optString("text", value.optString("partial", ""))
        } catch (_: Exception) { "" }

    private fun speak(text: String) {
        sendState("Speaking")
        tts?.speak(text, android.speech.tts.TextToSpeech.QUEUE_FLUSH, null, "jarvis-background")
    }

    private fun sendState(state: String) {
        sendBroadcast(Intent(ACTION_STATE).setPackage(packageName).putExtra(EXTRA_STATE, state))
    }

    private fun sendCommand(command: String) {
        sendBroadcast(Intent(ACTION_COMMAND).setPackage(packageName).putExtra(EXTRA_COMMAND, command))
    }

    private fun buildNotification(message: String): Notification {
        val start = PendingIntent.getService(this, 1, Intent(this, javaClass).setAction(ACTION_START), pendingFlags())
        val stop = PendingIntent.getService(this, 2, Intent(this, javaClass).setAction(ACTION_STOP), pendingFlags())
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("JARVIS")
            .setContentText(message)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(0, "Start", start)
            .addAction(0, "Stop", stop)
        if (pendingCommand != null) {
            val confirm = PendingIntent.getService(this, 3, Intent(this, javaClass).setAction(ACTION_CONFIRM), pendingFlags())
            val cancel = PendingIntent.getService(this, 4, Intent(this, javaClass).setAction(ACTION_CANCEL), pendingFlags())
            builder.addAction(0, "Confirm", confirm).addAction(0, "Cancel", cancel)
        }
        val open = PendingIntent.getActivity(this, 5, Intent(this, MainActivity::class.java), pendingFlags())
        builder.setContentIntent(open)
        return builder.build()
    }

    private fun updateNotification(message: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(message))
    }

    private fun pendingFlags(): Int =
        if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE else PendingIntent.FLAG_UPDATE_CURRENT

    private fun acquireListeningWakeLock() {
        try {
            val power = getSystemService(POWER_SERVICE) as PowerManager
            if (listeningWakeLock?.isHeld != true) {
                listeningWakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "JARVIS:VoiceListening").apply {
                    setReferenceCounted(false)
                    acquire()
                }
                if (listeningStartedAt == 0L) {
                    listeningStartedAt = System.currentTimeMillis()
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong("listening_started_at", listeningStartedAt).apply()
                }
            }
        } catch (_: Exception) {}
    }

    private fun releaseListeningWakeLock() {
        try { if (listeningWakeLock?.isHeld == true) listeningWakeLock?.release() } catch (_: Exception) {}
        listeningWakeLock = null
        listeningStartedAt = 0L
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong("listening_started_at", 0L).apply()
    }

    private fun stopEngine() {
        releaseListeningWakeLock()
        try { speechService?.stop() } catch (_: Exception) {}
        speechService = null
        try { commandRecognizer?.cancel(); commandRecognizer?.destroy() } catch (_: Exception) {}
        commandRecognizer = null
        listeningForCommand = false
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Android may still restrict background microphone service restarts on newer versions.
        if (getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_ENABLED, false)) {
            val restart = Intent(applicationContext, javaClass).setAction(ACTION_START)
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(restart) else startService(restart)
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        stopEngine()
        try { unregisterReceiver(powerReceiver) } catch (_: Exception) {}
        model?.close()
        model = null
        tts?.stop()
        tts?.shutdown()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "com.annamc.jarvis.action.START_LISTENING"
        const val ACTION_STOP = "com.annamc.jarvis.action.STOP_LISTENING"
        const val ACTION_CONFIRM = "com.annamc.jarvis.action.CONFIRM"
        const val ACTION_CANCEL = "com.annamc.jarvis.action.CANCEL"
        const val ACTION_STATE = "com.annamc.jarvis.action.STATE"
        const val ACTION_COMMAND = "com.annamc.jarvis.action.COMMAND"
        const val EXTRA_STATE = "state"
        const val EXTRA_COMMAND = "command"
        const val PREFS = "jarvis"
        const val KEY_ENABLED = "listening_enabled"
        private const val CHANNEL_ID = "jarvis_assistant"
        private const val NOTIFICATION_ID = 4101
    }
}
