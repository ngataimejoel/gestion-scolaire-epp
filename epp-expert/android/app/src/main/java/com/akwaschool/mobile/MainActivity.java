package com.akwaschool.mobile;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Écran unique : l'interface AKWA SCHOOL (HTML du dossier assets/www, reprise du prototype v7) dans une WebView.
 * Le réseau, le chiffrement et le stockage passent par le pont Java « AkwaNative » (classe Pont).
 */
public class MainActivity extends Activity {
    private WebView web;
    private Pont pont;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle etat) {
        super.onCreate(etat);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);                 // seules les pages de l'application (assets) sont chargées
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);
        pont = new Pont(this, web);
        web.addJavascriptInterface(pont, "AkwaNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("file".equals(u.getScheme()) && u.getPath() != null && u.getPath().startsWith("/android_asset/")) {
                    return false;
                }
                ouvrirAilleurs(u);
                return true;
            }
        });
        // barres du système : la page est placée entre elles (Android 15 dessine l'application dessous)
        boolean nuit = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        FrameLayout cadre = new FrameLayout(this);
        cadre.setBackgroundColor(Color.parseColor(nuit ? "#141B17" : "#FFFFFF"));
        web.setBackgroundColor(Color.parseColor(nuit ? "#0C110E" : "#F2F4EF"));
        cadre.addView(web);
        cadre.setOnApplyWindowInsetsListener((v, ins) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = ins.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                v.setPadding(ins.getSystemWindowInsetLeft(), ins.getSystemWindowInsetTop(),
                        ins.getSystemWindowInsetRight(), ins.getSystemWindowInsetBottom());
            }
            return ins;
        });
        setContentView(cadre);
        if (Build.VERSION.SDK_INT >= 30 && !nuit) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int clair = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(clair, clair);
            }
        }
        web.loadUrl("file:///android_asset/www/index.html");
    }

    void ouvrirAilleurs(Uri u) {
        String sc = u.getScheme() == null ? "" : u.getScheme();
        Intent i;
        if (sc.equals("tel")) {
            i = new Intent(Intent.ACTION_DIAL, u);
        } else if (sc.equals("sms") || sc.equals("https") || sc.equals("http") || sc.equals("mailto")) {
            i = new Intent(Intent.ACTION_VIEW, u);
        } else {
            return;
        }
        try {
            startActivity(i);
        } catch (ActivityNotFoundException ignored) {
            // aucune application pour ce lien
        }
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.akwaArriere ? String(akwaArriere()) : 'false'", v -> {
            if (!"\"true\"".equals(v)) {
                finish();
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.evaluateJavascript("window.akwaPause && akwaPause()", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.evaluateJavascript("window.akwaReprise && akwaReprise()", null);
    }

    @Override
    protected void onDestroy() {
        pont.fermer();
        web.destroy();
        super.onDestroy();
    }
}
