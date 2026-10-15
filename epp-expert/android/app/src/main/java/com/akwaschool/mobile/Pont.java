package com.akwaschool.mobile;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.akwaschool.mobile.synchro.Client;
import com.akwaschool.mobile.synchro.Decouverte;
import com.akwaschool.mobile.synchro.Protocole;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.GeneralSecurityException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Pont entre l'interface (JavaScript) et le téléphone : réseau et chiffrement (classes synchro), fichiers de
 * données privés de l'application, code PIN. Les opérations longues tournent hors de l'interface ; leur
 * résultat est signalé par akwaRetour(id) puis lu par resultat(id).
 */
public class Pont {
    private static final Pattern NOM_FICHIER = Pattern.compile("[a-z_]{1,40}\\.json");
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,40}");
    private static final int ITERATIONS_PIN = 20_000;

    private final Activity activite;
    private final WebView web;
    private final SharedPreferences prefs;
    private final ExecutorService reseau = Executors.newSingleThreadExecutor();
    private final Map<String, String> resultats = new ConcurrentHashMap<>();

    Pont(Activity activite, WebView web) {
        this.activite = activite;
        this.web = web;
        this.prefs = activite.getSharedPreferences("akwa", Context.MODE_PRIVATE);
    }

    void fermer() {
        reseau.shutdownNow();
    }

    // ------------------------------------------------------------------ résultats asynchrones
    private void rendre(String id, String json) {
        if (!ID.matcher(id).matches()) {
            return;
        }
        resultats.put(id, json);
        activite.runOnUiThread(() -> web.evaluateJavascript("window.akwaRetour && akwaRetour('" + id + "')", null));
    }

    @JavascriptInterface
    public String resultat(String id) {
        String r = resultats.remove(id);
        return r == null ? "null" : r;
    }

    private static String erreur(int statut, String message, String corps) {
        try {
            JSONObject o = new JSONObject().put("ok", false).put("statut", statut).put("message", message);
            if (corps != null && corps.trim().startsWith("{")) {
                o.put("corps", new JSONObject(corps));
            }
            return o.toString();
        } catch (JSONException e) {
            return "{\"ok\":false,\"statut\":" + statut + ",\"message\":" + Protocole.jsonTexte(message) + "}";
        }
    }

    // ------------------------------------------------------------------ informations
    @JavascriptInterface
    public String infos() {
        try {
            String version = "?";
            try {
                PackageInfo p = activite.getPackageManager().getPackageInfo(activite.getPackageName(), 0);
                version = p.versionName;
            } catch (PackageManager.NameNotFoundException ignored) {
                // version inconnue
            }
            return new JSONObject()
                    .put("modele", (Build.MANUFACTURER + " " + Build.MODEL).trim())
                    .put("android", Build.VERSION.RELEASE)
                    .put("version", version)
                    .put("associe", prefs.contains("cle"))
                    .put("adresse", prefs.getString("adresse", ""))
                    .put("serveur_id", prefs.getString("serveur_id", ""))
                    .put("pin", prefs.contains("pin"))
                    .toString();
        } catch (JSONException e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public void ouvrir(String url) {
        activite.runOnUiThread(() -> ((MainActivity) activite).ouvrirAilleurs(Uri.parse(url)));
    }

    // ------------------------------------------------------------------ fichiers privés
    private File fichier(String nom) {
        if (!NOM_FICHIER.matcher(nom).matches()) {
            throw new IllegalArgumentException("nom de fichier refusé");
        }
        return new File(activite.getFilesDir(), nom);
    }

    @JavascriptInterface
    public String lire(String nom) {
        try {
            File f = fichier(nom);
            return f.exists() ? new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8) : null;
        } catch (IOException | IllegalArgumentException e) {
            return null;
        }
    }

    @JavascriptInterface
    public boolean ecrire(String nom, String contenu) {
        try {
            File f = fichier(nom);
            File tmp = new File(f.getPath() + ".tmp");
            try (FileOutputStream o = new FileOutputStream(tmp)) {
                o.write(contenu.getBytes(StandardCharsets.UTF_8));
                o.getFD().sync();
            }
            return tmp.renameTo(f);
        } catch (IOException | IllegalArgumentException e) {
            return false;
        }
    }

    // ------------------------------------------------------------------ ordinateur de l'école
    @JavascriptInterface
    public void chercher(String id) {
        reseau.execute(() -> {
            List<String> t = Decouverte.chercher(1800, Protocole.PORT_DECOUVERTE, null);
            rendre(id, "[" + String.join(",", t) + "]");
        });
    }

    @JavascriptInterface
    public void associer(String id, String adresse, String code, String nom) {
        reseau.execute(() -> {
            try {
                Client.Association a = Client.appairer(adresse, code, nom);
                prefs.edit().putString("adresse", adresse.trim()).putLong("appareil_id", a.appareilId)
                        .putString("cle", Protocole.b64(a.cle)).putString("serveur_id", a.serveurId)
                        .putLong("seq", 0).commit();
                rendre(id, new JSONObject().put("ok", true).put("contenu", new JSONObject(a.contenu)).toString());
            } catch (Client.Erreur e) {
                rendre(id, erreur(e.statut, e.getMessage(), e.corps));
            } catch (JSONException | RuntimeException e) {
                rendre(id, erreur(0, "Association impossible : " + e.getMessage(), null));
            }
        });
    }

    private long prochainSeq() {
        long seq = prefs.getLong("seq", 0) + 1;
        prefs.edit().putLong("seq", seq).commit();      // enregistré avant l'envoi : jamais réutilisé
        return seq;
    }

    @JavascriptInterface
    public void synchroniser(String id, String requete) {
        reseau.execute(() -> {
            if (!prefs.contains("cle")) {
                rendre(id, erreur(0, "Ce téléphone n'est pas associé à l'ordinateur de l'école.", null));
                return;
            }
            long appareil = prefs.getLong("appareil_id", 0);
            byte[] cle = Protocole.unb64(prefs.getString("cle", ""));
            String adresse = prefs.getString("adresse", "");
            try {
                String rep;
                try {
                    rep = Client.synchroniser(adresse, appareil, cle, prochainSeq(), requete);
                } catch (Client.Erreur e) {
                    if (e.statut != 0) {
                        throw e;
                    }
                    // ordinateur injoignable à l'adresse connue : il a peut-être changé d'adresse sur le Wi-Fi
                    String nouvelle = retrouver();
                    if (nouvelle == null || nouvelle.equals(adresse)) {
                        throw new Client.Erreur(0, "Ordinateur de l'école introuvable. Vérifiez que le téléphone "
                                + "est sur le même Wi-Fi que l'ordinateur et que la synchronisation y est démarrée "
                                + "(Rapports & administration › Téléphones).", null);
                    }
                    prefs.edit().putString("adresse", nouvelle).commit();
                    rep = Client.synchroniser(nouvelle, appareil, cle, prochainSeq(), requete);
                }
                rendre(id, "{\"ok\":true,\"reponse\":" + rep + "}");
            } catch (Client.Erreur e) {
                rendre(id, erreur(e.statut, e.getMessage(), e.corps));
            } catch (RuntimeException e) {
                rendre(id, erreur(0, "Synchronisation impossible : " + e.getMessage(), null));
            }
        });
    }

    private String retrouver() {
        String sid = prefs.getString("serveur_id", "");
        for (String json : Decouverte.chercher(1800, Protocole.PORT_DECOUVERTE, null)) {
            if (sid.equals(Protocole.champTexte(json, "serveur_id"))) {
                return Protocole.champTexte(json, "adresse");
            }
        }
        return null;
    }

    @JavascriptInterface
    public void dissocier() {
        prefs.edit().clear().commit();
        File[] fs = activite.getFilesDir().listFiles();
        if (fs != null) {
            for (File f : fs) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    // ------------------------------------------------------------------ code PIN du téléphone
    @JavascriptInterface
    public boolean definirPin(String pin) {
        if (pin == null || !pin.matches("\\d{4,8}")) {
            return false;
        }
        try {
            byte[] sel = Protocole.aleatoire(16);
            byte[] h = Protocole.pbkdf2(pin.toCharArray(), sel, ITERATIONS_PIN);
            return prefs.edit().putString("pin", Protocole.b64(sel) + ":" + Protocole.b64(h)).putInt("pin_echecs", 0)
                    .commit();
        } catch (GeneralSecurityException e) {
            return false;
        }
    }

    /** Secondes d'attente imposées après des erreurs répétées (0 = saisie possible). */
    @JavascriptInterface
    public int attentePin() {
        long fin = prefs.getLong("pin_bloque_jusqua", 0);
        long now = System.currentTimeMillis();
        return fin > now ? (int) ((fin - now + 999) / 1000) : 0;
    }

    @JavascriptInterface
    public boolean verifierPin(String pin) {
        String p = prefs.getString("pin", null);
        if (p == null || attentePin() > 0 || pin == null) {
            return false;
        }
        try {
            String[] x = p.split(":");
            boolean ok = Protocole.egaux(Protocole.unb64(x[1]),
                    Protocole.pbkdf2(pin.toCharArray(), Protocole.unb64(x[0]), ITERATIONS_PIN));
            int echecs = ok ? 0 : prefs.getInt("pin_echecs", 0) + 1;
            SharedPreferences.Editor e = prefs.edit().putInt("pin_echecs", echecs);
            if (echecs > 0 && echecs % 5 == 0) {
                e.putLong("pin_bloque_jusqua", System.currentTimeMillis() + 30_000L * (echecs / 5));
            }
            e.commit();
            return ok;
        } catch (GeneralSecurityException | RuntimeException e) {
            return false;
        }
    }
}
