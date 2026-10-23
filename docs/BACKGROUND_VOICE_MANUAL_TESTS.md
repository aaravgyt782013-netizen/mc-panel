# JARVIS background voice listening — manual test checklist

Run these on a physical Android 14+ device after installing the debug APK. Do not treat a green CI build as proof of device microphone behavior.

- [ ] Fresh install: deny microphone permission; service must not start and microphone must remain unused.
- [ ] Grant microphone but deny notifications on Android 13+: service must not start.
- [ ] Grant both permissions; tap the HUD power button ON and verify the ongoing microphone notification appears.
- [ ] Tap notification Stop; verify the foreground service stops and the microphone indicator disappears.
- [ ] Add JARVIS from Quick Settings edit mode; verify tile ON/OFF mirrors the actual service state.
- [ ] Change Assistant name to Friday; verify it applies immediately without restarting the app.
- [ ] Say “Jarvis, open YouTube” while the configured name is Friday; no command should run and the transcript must not be stored.
- [ ] Say “Friday, open YouTube”; command should run.
- [ ] Test name matching: case changes, punctuation, “Hey Friday”, partial name “Fri”, and name spoken after the command.
- [ ] Enable Battery Saver; verify listening pauses, microphone is released, and notification explains why.
- [ ] Start a phone call; verify listening pauses and resumes only after the call ends.
- [ ] Start another app recording audio; verify JARVIS yields/releases the microphone and recovers safely.
- [ ] Confirm sensitive action prompt says “Shall I proceed, sir?”; timeout, “no”, and Stop must cancel.
- [ ] Confirm replies distinguish real success from failure (for example, unavailable app or camera flashlight error).
- [ ] Force-stop / swipe away / kill the process; verify behavior matches Android's background-start restrictions and the service does not loop-crash.
- [ ] Test offline mode with Wi-Fi and mobile data disabled; wake detection and command recognition must still work.
- [ ] Verify the HUD visibly transitions through Standby, Listening, Processing, and Speaking.
