# JARVIS background voice listening — manual test checklist

Run on a physical Android device (Android 13+ and Android 14+ are especially important). Check each box after observing the result.

## Permissions and service lifecycle
- [ ] Fresh install: tap Power ON with microphone permission denied; service does not start.
- [ ] Grant microphone but deny notifications on Android 13+: service does not start.
- [ ] Grant both permissions, tap Power ON; persistent foreground notification appears.
- [ ] Tap notification Stop; the service stops and releases microphone capture.
- [ ] Tap notification Start; service resumes only with both required permissions granted.
- [ ] Toggle the Quick Settings JARVIS tile ON/OFF; tile, notification, and HUD states agree.
- [ ] Swipe away the HUD while listening; background service continues.
- [ ] Stop the service, then reboot/kill process and verify restart behavior is documented and OS-permitted.
- [ ] Android 14+: start is initiated from the visible activity or user action and satisfies microphone foreground-service restrictions.

## Wake word, privacy, and name settings
- [ ] Say a sentence without the configured name; no command runs and no transcript is shown/stored/sent.
- [ ] Say "Jarvis, open YouTube"; wake phrase is accepted and only "open YouTube" is treated as command.
- [ ] Test uppercase/lowercase and punctuation: "JARVIS! turn on the flashlight".
- [ ] Test "Hey Jarvis, what time is it?".
- [ ] Say a partial name ("Jar", "Jav") and a name only; neither should execute a command.
- [ ] Change Assistant name in Settings while service is ON; new name works immediately and old name stops working.
- [ ] Test a multi-word assistant name if accepted by the field.
- [ ] Say "<name>, stop listening" and "<name>, go to sleep"; listening stops and mic is released.

## Recognition and command flow
- [ ] Hear activation tone after the wake name and before command capture.
- [ ] Vosk command recognition handles clear commands offline with airplane mode enabled.
- [ ] Low-confidence Vosk command falls back to Android SpeechRecognizer only for the command segment.
- [ ] HUD transitions through Standby, Listening, Processing, and Speaking.
- [ ] After reply finishes, service returns to wake-word standby.
- [ ] Confirmed flashlight command physically changes torch state; unavailable torch reports failure.
- [ ] Commands that open settings/apps report failure if launching the target activity fails.
- [ ] Sensitive action requests ask "Shall I proceed, sir?" and execute only after affirmative confirmation; No/timeout cancels.
- [ ] Notification text explains when paused by Battery Saver, phone call, or another app's microphone.
- [ ] Turn on Battery Saver; service pauses capture. Turn it off; service resumes if still enabled.
- [ ] Place/receive a phone call; listening pauses and resumes after call ends.
- [ ] Start another app recording; JARVIS releases/pauses microphone and resumes when recording ends.
- [ ] Press Power OFF during wake listening and during command capture; microphone is released in both cases.

## Build and automated tests
- [ ] GitHub Actions build, unit tests, APK signing verification, and artifact upload all succeed.
- [ ] `AssistantNameMatcherTest` passes for case, punctuation, "hey Jarvis", partial names, unaddressed speech, and name changes.


## Urgent live-demo verification (2026-10-23)
- [ ] CI validates the Vosk model archive has `uuid`, `am/`, and `conf/` at the archive root.
- [ ] Android SpeechRecognizer starts as the primary wake phrase path; provider availability and offline behavior vary by device.
- [ ] Test "Jarvis open YouTube" in one sentence, plus "Hi Jarvis", "Hey Jarvis", "OK Jarvis", "Javis", "Jervis", and "service".
- [ ] Verify partial and final transcripts update Diagnostics while speaking.
- [ ] Test error recovery by leaving/re-entering the app and toggling listening; confirm the recognizer restarts.
- [ ] Verify command results on a physical phone; a green build is not proof of real-device command success.
