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
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Écran unique : l'interface AKWA SCHOOL v8 (assets/www/index.html, la même que l'application Windows AKWA SCHOOL v8)
 * dans une WebView. Le stockage, le mot de passe, la licence, les fichiers et l'impression passent par le pont Java
 * « AkwaNative » (classe Pont, script assets/www/pont_android.js).
 */
public class MainActivity extends Activity {
    private WebView web;
    private Pont pont;
    /** Page en cours d'impression : gardée tant qu'Android la met en page. */
    private WebView aImprimer;
    /** Fichier demandé par la page (champ « choisir un fichier » : import Excel, restauration, logo). */
    private ValueCallback<Uri[]> choixPage;
    static final int FICHIER_PAGE = 45;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle etat) {
        super.onCreate(etat);
        if (!Integrite.conforme(this)) {
            new android.app.AlertDialog.Builder(this)
                    .setTitle("AKWA SCHOOL")
                    .setMessage("Cette copie d'AKWA SCHOOL a été modifiée et ne peut pas s'ouvrir. "
                            + "Installez l'application officielle depuis le lien de N'GATTA.")
                    .setCancelable(false)
                    .setPositiveButton("Fermer", (d, i) -> finish())
                    .show();
            return;
        }
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);                 // seules les pages de l'application (assets) sont chargées
        s.setAllowContentAccess(true);               // fichiers choisis par l'utilisateur (sélecteur d'Android)
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
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> retour, FileChooserParams p) {
                if (choixPage != null) {
                    choixPage.onReceiveValue(null);
                }
                choixPage = retour;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try {
                    startActivityForResult(i, FICHIER_PAGE);
                } catch (ActivityNotFoundException e) {
                    choixPage = null;
                    retour.onReceiveValue(null);
                }
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
        recu(getIntent());
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        if (web != null) recu(i);
    }

    /** Fichier ouvert avec AKWA SCHOOL depuis une autre application (réponse de l'ordinateur reçue par WhatsApp). */
    private void recu(Intent i) {
        if (i != null && Intent.ACTION_VIEW.equals(i.getAction()) && i.getData() != null) {
            pont.fichierOuvert(i.getData());
        }
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

    /** Met en page le document HTML (sans JavaScript) puis ouvre l'impression d'Android (imprimante ou PDF). */
    void imprimer(String html, String titre) {
        WebView w = new WebView(this);
        w.getSettings().setJavaScriptEnabled(false);
        w.getSettings().setAllowFileAccess(false);
        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                String nom = titre == null || titre.isEmpty() ? "AKWA SCHOOL" : titre;
                pm.print(nom, v.createPrintDocumentAdapter(nom), new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
            }
        });
        aImprimer = w;
        w.loadDataWithBaseURL("file:///android_asset/www/", html, "text/html", "utf-8", null);
    }

    /** Imprime la page elle-même (sa zone d'impression), comme l'application Windows : imprimante ou PDF. */
    void imprimerPage(boolean paysage) {
        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
        PrintAttributes.MediaSize a4 = PrintAttributes.MediaSize.ISO_A4;
        pm.print("AKWA SCHOOL", web.createPrintDocumentAdapter("AKWA SCHOOL"), new PrintAttributes.Builder()
                .setMediaSize(paysage ? a4.asLandscape() : a4.asPortrait()).build());
    }

    @Override
    protected void onActivityResult(int demande, int resultat, Intent donnees) {
        super.onActivityResult(demande, resultat, donnees);
        if (demande == FICHIER_PAGE) {
            ValueCallback<Uri[]> r = choixPage;
            choixPage = null;
            if (r != null) {
                Uri u = resultat == RESULT_OK && donnees != null ? donnees.getData() : null;
                r.onReceiveValue(u == null ? null : new Uri[]{u});
            }
        } else if (demande == Pont.CHOISIR || demande == Pont.ENREGISTRER) {
            pont.resultatActivite(demande, resultat == RESULT_OK, donnees == null ? null : donnees.getData());
        } else if (demande == Scan.SCANNER || demande == Scan.GALERIE) {
            pont.resultatScan(demande, resultat == RESULT_OK, donnees);
        }
    }

    @Override
    public void onBackPressed() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("window.akwaArriere ? String(akwaArriere()) : 'false'", v -> {
            if (!"\"true\"".equals(v)) {
                finish();
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.evaluateJavascript("window.akwaPause && akwaPause()", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.akwaReprise && akwaReprise()", null);
    }

    @Override
    protected void onDestroy() {
        if (pont != null) pont.fermer();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
