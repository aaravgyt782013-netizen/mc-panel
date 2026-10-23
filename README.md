# JARVIS — Android assistant

An original, cinematic JARVIS-inspired Android launcher/voice assistant starter. It is not an official Avengers product and does not use film assets.

## Features
- Futuristic dark HUD with animated reactor-style core
- Editable assistant name
- English and Hindi interface / speech recognition
- Explicit START / STOP listening controls
- Requests microphone permission at first use; flashlight asks for camera permission when needed
- Optional Android default-home launcher request (user must approve in system settings)
- Allowlisted commands: time, battery, flashlight, open Settings, open YouTube, open Chrome
- Text-to-speech responses

## Build
Open this repository in Android Studio, let Gradle sync, then build the app. Requires Android Studio with Android SDK 35 and a compatible JDK (17 recommended).

## Important Android limits
This app does not get unrestricted access to a phone. Android requires user consent for sensitive permissions and default launcher selection. Listening is user-started and stops when you press STOP; this starter does not implement an always-on hotword service. It does not replace the lock screen or bypass device security. Some commands depend on installed apps and device/OEM support.

## Privacy
Voice recognition uses Android's SpeechRecognizer service and may use the device's configured recognition provider. No audio is intentionally stored by this app. Optional online AI is not configured in this starter.
