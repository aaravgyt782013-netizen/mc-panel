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
import com.annamc.jarvis.MainActivity
import com.annamc.jarvis.R
import com.annamc.jarvis.settings.AssistantSettings
import com.annamc.jarvis.voice.AssistantNameMatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
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
    private var pendingCommand: String? = null
    private var pausedByPowerSaver = false
    private var pausedByOtherRecorder = false
    private var pausedByCall = false
    private var torchOn = false
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
            if (status == android.speech.tts.TextToSpeech.SUCCESS) tts?.language = Locale.UK
        }
        scope.launch(Dispatchers.Main) {
            AssistantSettings(applicationContext).assistantName.collect { newName ->
                if (newName != assistantName) {
                    assistantName = newName
                    if (model != null && !listeningForCommand &&
                        getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_ENABLED, false)) {
                        startWakeListening()
                    }
                }
            }
        }

        if (Build.VERSION.SDK_INT >= 29) {
            audioManager.registerAudioRecordingCallback(object : AudioManager.AudioRecordingCallback() {
                override fun onRecordingConfigChanged(configs: List<AudioRecordingConfiguration>?) {
                    val others = configs.orEmpty().any { it.clientPackageName != packageName }
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
                if (command != null) executeCommand(command)
                updateNotification("Listening in background")
                return START_STICKY
            }
            ACTION_CANCEL -> {
                pendingCommand = null
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
                startWakeListening()
            },
            { error ->
                updateNotification("Offline model unavailable: " + (error.message ?: "unpack failed"))
            })
    }

    private fun startWakeListening() {
        if (listeningForCommand || pausedByPowerSaver || pausedByOtherRecorder || pausedByCall || !isEnabled()) return
        try {
            speechService?.stop()
            speechService = null
            val loadedModel = model ?: return
            val grammar = JSONArray().put(assistantName.lowercase(Locale.ROOT))
                .put("hey " + assistantName.lowercase(Locale.ROOT))
                .put("[unk]").toString()
            val recognizer = Recognizer(loadedModel, 16000.0f, grammar)
            speechService = SpeechService(recognizer, 16000.0f).also { it.startListening(wakeListener) }
            updateNotification("Standby — say $assistantName")
            sendState("Standby")
        } catch (error: Exception) {
            updateNotification("Voice engine error: " + (error.message ?: "unknown"))
        }
    }

    private val wakeListener = object : VoskListener {
        override fun onPartialResult(hypothesis: String?) {}
        override fun onResult(hypothesis: String?) {
            val text = parseText(hypothesis)
            if (AssistantNameMatcher.isAddressed(text, assistantName)) {
                listeningForCommand = true
                try { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70).startTone(ToneGenerator.TONE_PROP_BEEP, 100) } catch (_: Exception) {}
                speechService?.stop()
                speechService = null
                updateNotification("Listening for command")
                sendState("Listening")
                startCommandRecognition()
            }
        }
        override fun onFinalResult(hypothesis: String?) { }
        override fun onError(exception: Exception?) { if (!pausedByPowerSaver) startWakeListening() }
        override fun onTimeout() { if (!pausedByPowerSaver) startWakeListening() }
    }

    private fun startCommandRecognition() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            speak("Command recognition is unavailable, sir.")
            listeningForCommand = false
            startWakeListening()
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
                        listeningForCommand = false
                        sendState("Standby")
                        startWakeListening()
                    }
                    override fun onResults(results: android.os.Bundle?) {
                        val raw = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                        val command = raw.trim().lowercase(Locale.ROOT)
                        listeningForCommand = false
                        if (command.isNotBlank()) {
                            sendCommand(command)
                            handleBackgroundCommand(command)
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
            startWakeListening()
        }
    }

    private fun handleBackgroundCommand(command: String) {
        when {
            command.contains("stop listening") || command.contains("go to sleep") -> {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, false).apply()
                speak("Going to sleep, sir.")
                stopEngine()
                stopForegroundCompat()
                stopSelf()
            }
            command.contains("time") -> {
                speak("The time is " + SimpleDateFormat("h:mm a", Locale.UK).format(Date()) + ", sir.")
                startWakeListening()
            }
            command.contains("battery") -> {
                val level = (getSystemService(BATTERY_SERVICE) as BatteryManager).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                speak("Battery level is $level percent, sir.")
                startWakeListening()
            }
            else -> {
                // Any action that changes the device or opens an app requires explicit notification confirmation.
                pendingCommand = command
                updateNotification("Confirm action: $command")
                speak("Shall I proceed, sir?")
                startWakeListening()
            }
        }
    }

    private fun executeCommand(command: String) {
        if (command.contains("flashlight") || command.contains("torch")) {
            val success = try {
                val camera = getSystemService(Context.CAMERA_SERVICE) as android.hardware.camera2.CameraManager
                val id = camera.cameraIdList.firstOrNull {
                    camera.getCameraCharacteristics(it).get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
                }
                if (id == null) false else {
                    val next = !torchOn
                    camera.setTorchMode(id, next)
                    torchOn = next
                    true
                }
            } catch (_: Exception) { false }
            speak(if (success) "Done, sir. Flashlight changed." else "I'm afraid the flashlight failed, sir.")
            startWakeListening()
            return
        }
        val intent = when {
            command.contains("youtube") -> packageManager.getLaunchIntentForPackage("com.google.android.youtube")
                ?: Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://www.youtube.com"))
            command.contains("browser") || command.contains("chrome") -> packageManager.getLaunchIntentForPackage("com.android.chrome")
                ?: Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://www.google.com"))
            command.contains("wifi") || command.contains("wi-fi") -> Intent(android.provider.Settings.ACTION_WIFI_SETTINGS)
            command.contains("bluetooth") -> Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS)
            command.contains("brightness") || command.contains("rotation") -> Intent(android.provider.Settings.ACTION_DISPLAY_SETTINGS)
            command.contains("settings") -> Intent(android.provider.Settings.ACTION_SETTINGS)
            else -> null
        }
        val success = try {
            if (intent == null) false else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
                true
            }
        } catch (_: Exception) { false }
        speak(if (success) "Done, sir. The requested screen was opened." else "I'm afraid that action is not supported or failed, sir.")
        startWakeListening()
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
        try { JSONObject(json ?: "{}").optString("text", "") } catch (_: Exception) { "" }

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

    private fun stopEngine() {
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
