package com.annamc.jarvis.voice

import java.util.Locale

/** Accepts commands only when the configured assistant name is the first spoken phrase. */
object AssistantNameMatcher {
    private val punctuation = Regex("[^\\p{L}\\p{N}\\s]")
    private val whitespace = Regex("\\s+")

    fun extractCommand(transcript: String, assistantName: String): String? {
        val name = normalize(assistantName)
        if (name.isBlank()) return null
        val words = normalize(transcript).split(' ').filter(String::isNotBlank)
        val nameWords = name.split(' ').filter(String::isNotBlank)
        if (words.size < nameWords.size || words.take(nameWords.size) != nameWords) {
            // Permit the conventional attention phrase "hey <name>", but never a partial name.
            if (words.size < nameWords.size + 1 || words.first() != "hey" ||
                words.slice(1 until 1 + nameWords.size) != nameWords) return null
            return words.drop(1 + nameWords.size).joinToString(" ").ifBlank { "" }
        }
        return words.drop(nameWords.size).joinToString(" ").ifBlank { "" }
    }

    fun isAddressed(transcript: String, assistantName: String): Boolean =
        !extractCommand(transcript, assistantName).isNullOrBlank() ||
            extractCommand(transcript, assistantName) == ""

    private fun normalize(value: String): String =
        value.lowercase(Locale.ROOT).replace(punctuation, " ").replace(whitespace, " ").trim()
}
