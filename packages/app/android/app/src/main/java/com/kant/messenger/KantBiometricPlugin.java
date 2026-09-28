package com.kant.messenger;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Fingerprint / face unlock for Kant.
 *
 * The web layer hands over the 32-byte key that unlocks the identity (derived
 * from the password with Argon2id). This plugin encrypts it with an AES-256-GCM
 * key that lives in the Android Keystore and can only be used right after a
 * strong biometric check (Class 3), and that the system destroys when a new
 * fingerprint or face is enrolled. Only the ciphertext is stored, in private
 * app preferences; without the Keystore key and the user's biometric it is
 * useless — including in a backup or a copy of the app's data.
 *
 * The JS side (src/lib/biometric.ts) documents the contract an iOS plugin of
 * the same name must implement.
 */
@CapacitorPlugin(name = "KantBiometric")
public class KantBiometricPlugin extends Plugin {

    private static final String KEY_ALIAS = "kant_biometric_unlock_v1";
    private static final String PREFS = "kant_biometric";
    private static final String PREF_IV = "iv";
    private static final String PREF_CT = "ct";
    /** Wrong fingers in one prompt before Kant asks for the password instead. */
    private static final int MAX_FAILED_ATTEMPTS = 3;

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        int can = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        ret.put("available", can == BiometricManager.BIOMETRIC_SUCCESS);
        ret.put("reason", reasonFor(can));
        ret.put("enrolled", isEnrolled());
        // Wall-clock time of the last boot: changes on every restart, so the
        // web layer can insist on the password after one.
        ret.put("bootTime", System.currentTimeMillis() - SystemClock.elapsedRealtime());
        call.resolve(ret);
    }

    @PluginMethod
    public void enable(PluginCall call) {
        byte[] secret = decode(call.getString("secret"));
        if (secret == null || secret.length != 32) { call.reject("Invalid secret", "INVALID"); return; }
        final Cipher cipher;
        try {
            deleteKey();
            SecretKey key = createKey();
            cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
        } catch (Exception e) {
            Arrays.fill(secret, (byte) 0);
            deleteKey();
            call.reject("Biometric key unavailable: " + e.getMessage(), "UNAVAILABLE");
            return;
        }
        prompt(call, cipher, call.getString("title", "Turn on fingerprint unlock"), new Done() {
            @Override public void run(Cipher ready) throws Exception {
                try {
                    byte[] ct = ready.doFinal(secret);
                    prefs().edit()
                        .putString(PREF_IV, Base64.encodeToString(ready.getIV(), Base64.NO_WRAP))
                        .putString(PREF_CT, Base64.encodeToString(ct, Base64.NO_WRAP))
                        .apply();
                    call.resolve();
                } finally {
                    Arrays.fill(secret, (byte) 0);
                }
            }
            @Override public void failed() {
                Arrays.fill(secret, (byte) 0);
                deleteKey();
            }
        });
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        SharedPreferences p = prefs();
        byte[] iv = decode(p.getString(PREF_IV, null));
        byte[] ct = decode(p.getString(PREF_CT, null));
        final Cipher cipher;
        try {
            SecretKey key = loadKey();
            if (key == null || iv == null || ct == null) { call.reject("Not set up", "NOT_ENROLLED"); return; }
            cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
        } catch (KeyPermanentlyInvalidatedException e) {
            // A fingerprint or face was added or removed: the old key is gone for good.
            disableNow();
            call.reject("Biometrics changed", "INVALIDATED");
            return;
        } catch (Exception e) {
            call.reject("Biometric key unavailable: " + e.getMessage(), "UNAVAILABLE");
            return;
        }
        prompt(call, cipher, call.getString("title", "Unlock Kant"), new Done() {
            @Override public void run(Cipher ready) throws Exception {
                byte[] secret = ready.doFinal(ct);
                try {
                    JSObject ret = new JSObject();
                    ret.put("secret", Base64.encodeToString(secret, Base64.NO_WRAP));
                    call.resolve(ret);
                } finally {
                    Arrays.fill(secret, (byte) 0);
                }
            }
            @Override public void failed() { }
        });
    }

    @PluginMethod
    public void disable(PluginCall call) {
        disableNow();
        call.resolve();
    }

    /* ── Internals ─────────────────────────────────────────────────── */

    private interface Done {
        void run(Cipher ready) throws Exception;
        void failed();
    }

    private void prompt(PluginCall call, Cipher cipher, String title, Done done) {
        FragmentActivity activity = getActivity();
        if (activity == null) { done.failed(); call.reject("No activity", "UNAVAILABLE"); return; }
        activity.runOnUiThread(() -> {
            final int[] failures = {0};
            final boolean[] settled = {false};
            final BiometricPrompt[] holder = new BiometricPrompt[1];
            BiometricPrompt.AuthenticationCallback callback = new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    if (settled[0]) return;
                    settled[0] = true;
                    BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                    Cipher ready = crypto != null ? crypto.getCipher() : null;
                    if (ready == null) { done.failed(); call.reject("No cipher", "FAILED"); return; }
                    try {
                        done.run(ready);
                    } catch (Exception e) {
                        done.failed();
                        call.reject("Could not use the biometric key", "FAILED");
                    }
                }

                @Override
                public void onAuthenticationError(int code, @NonNull CharSequence message) {
                    if (settled[0]) return;
                    settled[0] = true;
                    done.failed();
                    call.reject(message.toString(), codeFor(code));
                }

                @Override
                public void onAuthenticationFailed() {
                    // A finger or face that isn't enrolled. The prompt stays up
                    // and retries; after a few, stop and ask for the password.
                    if (++failures[0] >= MAX_FAILED_ATTEMPTS && !settled[0]) {
                        settled[0] = true;
                        if (holder[0] != null) holder[0].cancelAuthentication();
                        done.failed();
                        call.reject("Not recognised", "TOO_MANY_ATTEMPTS");
                    }
                }
            };
            holder[0] = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback);
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(call.getString("subtitle", ""))
                .setNegativeButtonText(call.getString("cancel", "Use password"))
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setConfirmationRequired(false)
                .build();
            holder[0].authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    private SecretKey createKey() throws Exception {
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) spec.setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Every single use needs a fresh strong biometric — no grace period.
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(spec.build());
        return generator.generateKey();
    }

    private SecretKey loadKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        return (SecretKey) store.getKey(KEY_ALIAS, null);
    }

    private void deleteKey() {
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) { }
    }

    private void disableNow() {
        deleteKey();
        prefs().edit().clear().apply();
    }

    private boolean isEnrolled() {
        SharedPreferences p = prefs();
        if (!p.contains(PREF_CT) || !p.contains(PREF_IV)) return false;
        try { return loadKey() != null; } catch (Exception e) { return false; }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static byte[] decode(String b64) {
        if (b64 == null) return null;
        try { return Base64.decode(b64, Base64.DEFAULT); } catch (IllegalArgumentException e) { return null; }
    }

    private static String reasonFor(int can) {
        switch (can) {
            case BiometricManager.BIOMETRIC_SUCCESS: return "";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED: return "not-enrolled";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE: return "no-hardware";
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED: return "security-update";
            default: return "unavailable";
        }
    }

    private static String codeFor(int error) {
        switch (error) {
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_CANCELED:
                return "CANCELLED";
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "LOCKOUT";
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
            case BiometricPrompt.ERROR_HW_NOT_PRESENT:
            case BiometricPrompt.ERROR_HW_UNAVAILABLE:
                return "UNAVAILABLE";
            default:
                return "FAILED";
        }
    }
}
