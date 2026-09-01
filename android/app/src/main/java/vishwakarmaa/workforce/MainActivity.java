package com.vishwakarmaa.workforce;

import android.Manifest;
import androidx.fragment.app.FragmentActivity;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

public class MainActivity extends FragmentActivity {
    private WebView web;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });
        web.addJavascriptInterface(new NativeBridge(), "MannatNative");
        if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.CAMERA}, 100);
        web.loadUrl("file:///android_asset/index.html");
    }

    public class NativeBridge {
        @JavascriptInterface public boolean biometricAvailable() {
            BiometricManager bm = BiometricManager.from(MainActivity.this);
            int r = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.BIOMETRIC_WEAK);
            return r == BiometricManager.BIOMETRIC_SUCCESS;
        }
        @JavascriptInterface public void authenticateBiometric() {
            runOnUiThread(() -> {
                BiometricPrompt.AuthenticationCallback callback = new BiometricPrompt.AuthenticationCallback() {
                    @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                        super.onAuthenticationSucceeded(result);
                        web.evaluateJavascript("window.onNativeBiometric && window.onNativeBiometric('success')", null);
                    }
                    @Override public void onAuthenticationFailed() {
                        super.onAuthenticationFailed();
                        web.evaluateJavascript("window.onNativeBiometric && window.onNativeBiometric('failed')", null);
                    }
                    @Override public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                        super.onAuthenticationError(errorCode, errString);
                        String msg = errString.toString().replace("\\", "\\\\").replace("'", "\\'");
                        web.evaluateJavascript("window.onNativeBiometric && window.onNativeBiometric('error','" + msg + "')", null);
                    }
                };
                BiometricPrompt prompt = new BiometricPrompt(MainActivity.this, ContextCompat.getMainExecutor(MainActivity.this), callback);
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle("Project Vishwakarmaa verification")
                        .setSubtitle("Verify the operator on this Android phone")
                        .setNegativeButtonText("Cancel")
                        .build();
                prompt.authenticate(info);
            });
        }
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
