package com.annamc.jarvis.settings

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.jarvisDataStore by preferencesDataStore(name = "jarvis_settings")

class AssistantSettings(private val context: Context) {
    private val assistantNameKey = stringPreferencesKey("assistant_name")
    val assistantName: Flow<String> = context.jarvisDataStore.data.map { preferences ->
        preferences[assistantNameKey]?.trim()?.takeIf { it.isNotEmpty() } ?: "Jarvis"
    }
    suspend fun setAssistantName(name: String) {
        val safeName = name.trim().take(40)
        if (safeName.isNotEmpty()) {
            context.jarvisDataStore.edit { it[assistantNameKey] = safeName }
        }
    }
}
