package com.annamc.jarvis.ui.theme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
private val JarvisColors = darkColorScheme(
    primary = CyanHUD, onPrimary = DeepNavy, primaryContainer = PanelBlue, onPrimaryContainer = IceBlue,
    secondary = SoftBlue, onSecondary = DeepNavy, background = DeepNavy, onBackground = IceBlue,
    surface = SurfaceNavy, onSurface = IceBlue, surfaceVariant = PanelBlue, onSurfaceVariant = MutedBlue,
    outline = OutlineBlue, error = ErrorRed, onError = DeepNavy
)
@Composable
fun JarvisTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = JarvisColors, typography = JarvisTypography, content = content)
}
