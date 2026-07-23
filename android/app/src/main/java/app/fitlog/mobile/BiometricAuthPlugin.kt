package app.fitlog.mobile

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Level-1 biometric gate: verify the user (fingerprint/face) before the app UI
 * is shown. Verification ONLY — no Keystore/crypto and no stored secrets; the
 * Supabase session stays in its normal storage. The app keeps a password
 * fallback (sign out → re-login), so a missing/failed biometric never bricks
 * the device. Web / older APKs never see this plugin (guarded on the JS side).
 *
 * BIOMETRIC_WEAK covers the most devices (face + fingerprint) for a privacy
 * lock; we deliberately don't combine DEVICE_CREDENTIAL (avoids the API-30
 * authenticator-combination rules — the app's own password escape is the
 * fallback instead).
 */
@CapacitorPlugin(name = "BiometricAuth")
class BiometricAuthPlugin : Plugin() {

    private val authenticators = BiometricManager.Authenticators.BIOMETRIC_WEAK

    /** { available: Boolean, status: Int } — status is the raw BiometricManager code. */
    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val status = BiometricManager.from(context).canAuthenticate(authenticators)
        call.resolve(
            JSObject()
                .put("available", status == BiometricManager.BIOMETRIC_SUCCESS)
                .put("status", status)
        )
    }

    /** Show the system biometric prompt; resolves { success: Boolean, error?: String }. */
    @PluginMethod
    fun authenticate(call: PluginCall) {
        if (BiometricManager.from(context).canAuthenticate(authenticators)
            != BiometricManager.BIOMETRIC_SUCCESS
        ) {
            call.resolve(JSObject().put("success", false).put("error", "unavailable"))
            return
        }
        val title = call.getString("title") ?: "Unlock FitLog"
        val subtitle = call.getString("subtitle") ?: "Confirm it's you"
        val cancelLabel = call.getString("cancelLabel") ?: "Cancel"

        activity.runOnUiThread {
            val prompt = BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(context),
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        call.resolve(JSObject().put("success", true))
                    }

                    // Terminal errors (cancel, negative button, lockout, no hardware).
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        call.resolve(
                            JSObject()
                                .put("success", false)
                                .put("error", "error")
                                .put("code", errorCode)
                                .put("message", errString.toString())
                        )
                    }
                    // onAuthenticationFailed = one bad read; the prompt stays up, so we wait.
                }
            )
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setNegativeButtonText(cancelLabel)
                .setAllowedAuthenticators(authenticators)
                .setConfirmationRequired(false)
                .build()
            prompt.authenticate(info)
        }
    }
}
