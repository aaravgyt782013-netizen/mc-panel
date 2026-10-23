package com.annamc.jarvis.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AssistantNameMatcherTest {
    @Test fun acceptsCaseAndPunctuation() {
        assertEquals("open youtube", AssistantNameMatcher.extractCommand("JARVIS, open YouTube!", "Jarvis"))
    }
    @Test fun acceptsCommonJarvisMishearings() {
        assertEquals("open youtube", AssistantNameMatcher.extractCommand("Javis, open YouTube", "Jarvis"))
        assertEquals("open youtube", AssistantNameMatcher.extractCommand("Hey Jarvis, open YouTube", "Jarvis"))
        assertEquals("open youtube", AssistantNameMatcher.extractCommand("service open YouTube", "Jarvis"))
        assertEquals("open youtube", AssistantNameMatcher.extractCommand("jervis open YouTube", "Jarvis"))
    }
    @Test fun acceptsGreetingAndOkayAliases() {
        assertEquals("open youtube", AssistantNameMatcher.extractCommand("Hi Jarvis, open YouTube", "Jarvis"))
        assertEquals("open youtube", AssistantNameMatcher.extractCommand("OK Jarvis open YouTube", "Jarvis"))
        assertEquals("open youtube", AssistantNameMatcher.extractCommand("Okay Jarvis open YouTube", "Jarvis"))
    }
    @Test fun acceptsHeyNamePrefix() {
        assertEquals("turn on the flashlight", AssistantNameMatcher.extractCommand("Hey Jarvis, turn on the flashlight", "Jarvis"))
    }
    @Test fun rejectsPartialName() {
        assertNull(AssistantNameMatcher.extractCommand("Jar, open YouTube", "Jarvis"))
        assertNull(AssistantNameMatcher.extractCommand("open YouTube for Jarvis", "Jarvis"))
    }
    @Test fun rejectsUnaddressedSpeech() {
        assertNull(AssistantNameMatcher.extractCommand("turn on the flashlight", "Jarvis"))
    }
    @Test fun nameChangesApplyImmediately() {
        assertNull(AssistantNameMatcher.extractCommand("Jarvis, open YouTube", "Friday"))
        assertEquals("open youtube", AssistantNameMatcher.extractCommand("Friday, open YouTube", "Friday"))
    }
    @Test fun nameAloneIsAddressedButHasNoCommand() {
        assertEquals("", AssistantNameMatcher.extractCommand("Jarvis!", "Jarvis"))
    }
}
