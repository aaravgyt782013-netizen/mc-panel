package com.annamc.jarvis.voice

import java.util.Locale

/** Wake-name matcher resilient to common offline ASR substitutions while requiring the name at the start. */
object AssistantNameMatcher {
    private val punctuation = Regex("[^\\p{L}\\p{N}\\s]")
    private val whitespace = Regex("\\s+")

    fun extractCommand(transcript: String, assistantName: String): String? {
        val words = normalize(transcript).split(' ').filter(String::isNotBlank).toMutableList()
        val nameWords = normalize(assistantName).split(' ').filter(String::isNotBlank)
        if (words.isEmpty() || nameWords.isEmpty()) return null

        // ASR commonly hears "Jarvis" as "Javis", "service", or "services".
        // Keep fuzzy aliases scoped to the configured Jarvis name and only at the start.
        if (nameWords.size == 1 && nameWords[0] == "jarvis") {
            val aliases = setOf("javis", "javiss", "service", "services", "jervis", "jarviss", "jarvus", "jarvis")
            var prefix = 0
            if (words.firstOrNull() in setOf("hi", "hey", "ok", "okay")) prefix++
            if (words.getOrNull(prefix) in aliases) {
                return words.drop(prefix + 1).joinToString(" ")
            }
        }

        if (words.size >= nameWords.size && words.take(nameWords.size) == nameWords) {
            return words.drop(nameWords.size).joinToString(" ")
        }
        if (words.first() == "hey" && words.size >= nameWords.size + 1 &&
            words.slice(1 until 1 + nameWords.size) == nameWords) {
            return words.drop(1 + nameWords.size).joinToString(" ")
        }
        // Bounded edit-distance fallback for short ASR variants (e.g. "jervis").
        if (nameWords.size == 1 && words.first().length in 4..7 &&
            editDistanceAtMostOne(words.first(), nameWords.first())) {
            return words.drop(1).joinToString(" ")
        }
        return null
    }

    fun isAddressed(transcript: String, assistantName: String): Boolean =
        extractCommand(transcript, assistantName) != null

    private fun normalize(value: String): String =
        value.lowercase(Locale.ROOT).replace(punctuation, " ").replace(whitespace, " ").trim()

    private fun editDistanceAtMostOne(a: String, b: String): Boolean {
        if (kotlin.math.abs(a.length - b.length) > 1) return false
        var i = 0
        var j = 0
        var edits = 0
        while (i < a.length && j < b.length) {
            if (a[i] == b[j]) { i++; j++ } else {
                edits++
                if (edits > 1) return false
                if (a.length > b.length) i++ else if (b.length > a.length) j++ else { i++; j++ }
            }
        }
        if (i < a.length || j < b.length) edits++
        return edits <= 1
    }
}
