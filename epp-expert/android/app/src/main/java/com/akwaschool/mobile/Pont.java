package com.akwaschool.mobile;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.akwaschool.mobile.noyau.Classeur;
import com.akwaschool.mobile.noyau.Coffre;
import com.akwaschool.mobile.noyau.Licence;
import com.akwaschool.mobile.noyau.Tableur;
import com.akwaschool.mobile.synchro.Client;
import com.akwaschool.mobile.synchro.Decouverte;
import com.akwaschool.mobile.synchro.FichierSynchro;
import com.akwaschool.mobile.synchro.Protocole;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
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
 * données privés de l'application, code PIN et mot de passe administrateur du téléphone, licence du téléphone
 * utilisé seul, import de tableaux, enregistrement de fichiers (exports, sauvegardes chiffrées) et impression.
 * Les opérations longues tournent hors de l'interface ; leur résultat est signalé par akwaRetour(id) puis lu
 * par resultat(id).
 */
public class Pont {
    private static final Pattern NOM_FICHIER = Pattern.compile("[a-z_]{1,40}\\.json");
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,40}");
    private static final int ITERATIONS_PIN = 20_000;
    static final int CHOISIR = 41;
    static final int ENREGISTRER = 42;
    /** Clés gardées quand on efface les données : licence et période d'essai du téléphone. */
    private static final String[] CLES_LICENCE = {"licence", "signature", "essai_debut", "derniere_vue"};
    private static final String[] CLES_ASSOCIATION = {"adresse", "appareil_id", "cle", "serveur_id", "seq", "seq_recu"};
    static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private final Activity activite;
    private final WebView web;
    private final SharedPreferences prefs;
    private final ExecutorService reseau = Executors.newSingleThreadExecutor();
    private final Map<String, String> resultats = new ConcurrentHashMap<>();
    private final Map<String, byte[]> fichiersChoisis = new ConcurrentHashMap<>();
    /** Demande en cours auprès d'Android (choix ou enregistrement d'un fichier) : un seul à la fois. */
    private String demandeId;
    private String demandeUsage;
    private byte[] aEnregistrer;
    /** Fichier ouvert avec AKWA SCHOOL depuis une autre application, en attente de l'interface. */
    private volatile byte[] fichierRecu;

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

    static String erreurJson(String message) {
        return erreur(0, message, null);
    }

    // ------------------------------------------------------------------ scan et rappels (version 1.2.0)
    /**
     * Scan d'une feuille de notes ou d'un extrait de naissance (source « scanner » ou « galerie ») : le texte lu
     * sur le téléphone est renvoyé ligne par ligne avec sa position, l'interface le remet en ordre.
     */
    @JavascriptInterface
    public void scanner(String id, String source) {
        activite.runOnUiThread(() -> {
            if (demandeId != null) {
                rendre(demandeId, erreur(0, "Opération annulée.", null));
            }
            demandeId = id;
            demandeUsage = "scan";
            Scan.lancer(activite, "galerie".equals(source), json -> {
                demandeId = null;
                rendre(id, json);
            });
        });
    }

    /** Résultat du scanner de documents ou de la galerie (appelé par MainActivity). */
    void resultatScan(int demande, boolean ok, Intent donnees) {
        String id = demandeId;
        demandeId = null;
        if (id == null) {
            return;
        }
        Uri uri = ok ? Scan.image(demande, donnees) : null;
        if (uri == null) {
            rendre(id, "{\"ok\":false,\"annule\":true,\"message\":\"Annulé.\"}");
            return;
        }
        reseau.execute(() -> Scan.lire(activite, uri, json -> rendre(id, json)));
    }

    /** Rappels en notifications : liste JSON [{quand (ms), titre, texte}] ; renvoie le nombre programmé. */
    @JavascriptInterface
    public int programmerRappels(String json) {
        int n = Rappels.programmer(activite, json);
        if (n > 0 && Build.VERSION.SDK_INT >= 33 && activite.checkSelfPermission(
                "android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED
                && !prefs.getBoolean("notif_demandee", false)) {
            prefs.edit().putBoolean("notif_demandee", true).apply();
            activite.runOnUiThread(() -> activite.requestPermissions(
                    new String[]{"android.permission.POST_NOTIFICATIONS"}, 45));
        }
        return n;
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
                    .put("admin", prefs.contains("admin"))
                    .put("essai", prefs.contains("essai_debut"))
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
                long seq = prochainSeq();
                try {
                    rep = Client.synchroniser(adresse, appareil, cle, seq, requete);
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
                    seq = prochainSeq();
                    rep = Client.synchroniser(nouvelle, appareil, cle, seq, requete);
                }
                recu(seq);
                rendre(id, "{\"ok\":true,\"reponse\":" + rep + "}");
            } catch (Client.Erreur e) {
                rendre(id, erreur(e.statut, e.getMessage(), e.corps));
            } catch (RuntimeException e) {
                rendre(id, erreur(0, "Synchronisation impossible : " + e.getMessage(), null));
            }
        });
    }

    /** Numéro de la dernière réponse reçue : une réponse plus ancienne (fichier en retard) est ignorée. */
    private void recu(long seq) {
        if (seq > prefs.getLong("seq_recu", 0)) {
            prefs.edit().putLong("seq_recu", seq).commit();
        }
    }

    // ------------------------------------------------------------------ synchronisation par fichier
    private static String nomSimple(String s) {
        String a = java.text.Normalizer.normalize(s == null ? "" : s, java.text.Normalizer.Form.NFD)
                .replaceAll("[\\p{M}]", "").replaceAll("[^A-Za-z0-9]+", "-").replaceAll("^-+|-+$", "");
        return a.isEmpty() ? "telephone" : a.substring(0, Math.min(30, a.length()));
    }

    /**
     * Crée le fichier de demande (saisies en attente, ou données du téléphone utilisé seul) chiffré pour
     * l'ordinateur de l'école, puis le partage (WhatsApp, e-mail…) ou l'enregistre, selon mode.
     */
    @JavascriptInterface
    public void creerDemande(String id, String requete, String mode) {
        reseau.execute(() -> {
            if (!prefs.contains("cle")) {
                rendre(id, erreur(0, "Ce téléphone n'est pas associé à l'ordinateur de l'école.", null));
                return;
            }
            try {
                long seq = prochainSeq();
                String modele = (Build.MANUFACTURER + " " + Build.MODEL).trim();
                String f = FichierSynchro.demande(prefs.getLong("appareil_id", 0), prefs.getString("serveur_id", ""),
                        Protocole.unb64(prefs.getString("cle", "")), seq, requete, modele,
                        java.time.LocalDateTime.now().withNano(0).toString());
                String nom = "AKWA-" + nomSimple(modele) + "-DEMANDE-" + seq + FichierSynchro.EXTENSION;
                byte[] b = f.getBytes(StandardCharsets.UTF_8);
                if ("enregistrer".equals(mode)) {
                    demanderEnregistrement(id, nom, "application/octet-stream", b);
                } else {
                    partager(id, nom, "application/octet-stream", b, "Demande de synchronisation AKWA SCHOOL",
                            "Fichier à importer sur l'ordinateur de l'école : AKWA SCHOOL › Rapports & administration "
                            + "› Téléphones › « Importer un fichier du téléphone ».");
                }
            } catch (Client.Erreur | GeneralSecurityException | RuntimeException e) {
                rendre(id, erreur(0, "Création du fichier impossible : " + e.getMessage(), null));
            }
        });
    }

    /** Confie un fichier à une autre application (choix d'Android : WhatsApp, Gmail, Bluetooth…). */
    private void partager(String id, String nom, String type, byte[] contenu, String sujet, String texte) {
        try {
            File d = Partage.dossier(activite);
            File[] anciens = d.listFiles();
            if (anciens != null) {
                for (File a : anciens) {
                    if (System.currentTimeMillis() - a.lastModified() > 7L * 86_400_000L) {
                        //noinspection ResultOfMethodCallIgnored
                        a.delete();
                    }
                }
            }
            try (FileOutputStream o = new FileOutputStream(new File(d, nom))) {
                o.write(contenu);
            }
        } catch (IOException e) {
            rendre(id, erreur(0, "Fichier impossible à préparer : " + e.getMessage(), null));
            return;
        }
        Uri u = Partage.lien(nom);
        activite.runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, u)
                    .putExtra(Intent.EXTRA_SUBJECT, sujet).putExtra(Intent.EXTRA_TEXT, texte)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.setClipData(ClipData.newRawUri(nom, u));
            try {
                activite.startActivity(Intent.createChooser(i, "Envoyer " + nom));
                rendre(id, "{\"ok\":true,\"nom\":" + Protocole.jsonTexte(nom) + "}");
            } catch (RuntimeException e) {
                rendre(id, erreur(0, "Aucune application de partage sur ce téléphone : utilisez « Enregistrer ».", null));
            }
        });
    }

    private String ouvrirReponse(byte[] data) {
        if (!prefs.contains("cle")) {
            return erreur(0, "Ce téléphone n'est pas associé à l'ordinateur de l'école.", null);
        }
        try {
            FichierSynchro.Reponse r = FichierSynchro.ouvrirReponse(data, prefs.getLong("appareil_id", 0),
                    prefs.getString("serveur_id", ""), Protocole.unb64(prefs.getString("cle", "")),
                    prefs.getLong("seq_recu", 0));
            recu(r.seq);
            return "{\"ok\":true,\"seq\":" + r.seq + ",\"reponse\":" + r.json + "}";
        } catch (Client.Erreur e) {
            return erreur(0, e.getMessage(), null);
        } catch (RuntimeException e) {
            return erreur(0, "Fichier de réponse illisible.", null);
        }
    }

    /** Fichier reçu par « Ouvrir avec AKWA SCHOOL » (appelé par MainActivity) : l'interface est prévenue. */
    void fichierOuvert(Uri uri) {
        reseau.execute(() -> {
            try (InputStream in = activite.getContentResolver().openInputStream(uri)) {
                if (in == null) {
                    return;
                }
                fichierRecu = Tableur.tout(in);
                activite.runOnUiThread(() -> web.evaluateJavascript("window.akwaFichierRecu && akwaFichierRecu()", null));
            } catch (IOException | Tableur.Illisible | RuntimeException e) {
                fichierRecu = null;
            }
        });
    }

    @JavascriptInterface
    public boolean aUnFichierRecu() {
        return fichierRecu != null;
    }

    /** Ouvre la réponse reçue par « Ouvrir avec AKWA SCHOOL ». */
    @JavascriptInterface
    public void ouvrirFichierRecu(String id) {
        reseau.execute(() -> {
            byte[] f = fichierRecu;
            fichierRecu = null;
            rendre(id, f == null ? erreur(0, "Aucun fichier reçu.", null) : ouvrirReponse(f));
        });
    }

    /** Classeur Excel (.xlsx), présentation de l'application Windows ; enregistré ou partagé selon mode. */
    @JavascriptInterface
    public void exporterClasseur(String id, String nom, String description, String mode) {
        reseau.execute(() -> {
            try {
                byte[] x = Classeur.depuisJson(description);
                if ("partager".equals(mode)) {
                    partager(id, nom, XLSX, x, nom, "Fichier Excel produit par AKWA SCHOOL.");
                } else {
                    demanderEnregistrement(id, nom, XLSX, x);
                }
            } catch (IOException | RuntimeException e) {
                rendre(id, erreur(0, "Classeur impossible à créer : " + e.getMessage(), null));
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

    /** Oublie l'ordinateur associé (clé, adresse) ; les fichiers de données sont gérés par l'interface. */
    @JavascriptInterface
    public void dissocier() {
        SharedPreferences.Editor e = prefs.edit();
        for (String k : CLES_ASSOCIATION) {
            e.remove(k);
        }
        e.commit();
    }

    /** Efface toutes les données du téléphone (code PIN oublié) ; la licence et l'essai sont conservés. */
    @JavascriptInterface
    public void effacerTout() {
        SharedPreferences.Editor e = prefs.edit();
        for (String k : prefs.getAll().keySet()) {
            if (!java.util.Arrays.asList(CLES_LICENCE).contains(k)) {
                e.remove(k);
            }
        }
        e.commit();
        File[] fs = activite.getFilesDir().listFiles();
        if (fs != null) {
            for (File f : fs) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    @JavascriptInterface
    public boolean supprimer(String nom) {
        try {
            File f = fichier(nom);
            return !f.exists() || f.delete();
        } catch (IllegalArgumentException e) {
            return false;
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

    // ------------------------------------------------------------------ mot de passe administrateur (téléphone seul)
    /** Définit le mot de passe administrateur du téléphone ; s'il existe déjà, l'ancien est exigé. */
    @JavascriptInterface
    public boolean definirAdmin(String nouveau, String ancien) {
        if (nouveau == null || nouveau.length() < 6) {
            return false;
        }
        if (prefs.contains("admin") && !verifierAdmin(ancien)) {
            return false;
        }
        try {
            byte[] sel = Protocole.aleatoire(16);
            byte[] h = Protocole.pbkdf2(nouveau.toCharArray(), sel, ITERATIONS_PIN);
            return prefs.edit().putString("admin", Protocole.b64(sel) + ":" + Protocole.b64(h)).putInt("admin_echecs", 0)
                    .commit();
        } catch (GeneralSecurityException e) {
            return false;
        }
    }

    @JavascriptInterface
    public int attenteAdmin() {
        long fin = prefs.getLong("admin_bloque_jusqua", 0);
        long now = System.currentTimeMillis();
        return fin > now ? (int) ((fin - now + 999) / 1000) : 0;
    }

    @JavascriptInterface
    public boolean verifierAdmin(String mdp) {
        String p = prefs.getString("admin", null);
        if (p == null || attenteAdmin() > 0 || mdp == null) {
            return false;
        }
        try {
            String[] x = p.split(":");
            boolean ok = Protocole.egaux(Protocole.unb64(x[1]),
                    Protocole.pbkdf2(mdp.toCharArray(), Protocole.unb64(x[0]), ITERATIONS_PIN));
            int echecs = ok ? 0 : prefs.getInt("admin_echecs", 0) + 1;
            SharedPreferences.Editor e = prefs.edit().putInt("admin_echecs", echecs);
            if (echecs > 0 && echecs % 5 == 0) {
                e.putLong("admin_bloque_jusqua", System.currentTimeMillis() + 30_000L * (echecs / 5));
            }
            e.commit();
            return ok;
        } catch (GeneralSecurityException | RuntimeException e) {
            return false;
        }
    }

    // ------------------------------------------------------------------ mot de passe administrateur oublié
    private static final String ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

    private String empreinte(String code) throws GeneralSecurityException {
        byte[] sel = Protocole.aleatoire(16);
        return Protocole.b64(sel) + ":" + Protocole.b64(Protocole.pbkdf2(code.toCharArray(), sel, ITERATIONS_PIN));
    }

    private static boolean correspond(String code, String stocke) {
        if (stocke == null || code == null) {
            return false;
        }
        try {
            String[] x = stocke.split(":");
            return Protocole.egaux(Protocole.unb64(x[1]),
                    Protocole.pbkdf2(code.toCharArray(), Protocole.unb64(x[0]), ITERATIONS_PIN));
        } catch (GeneralSecurityException | RuntimeException e) {
            return false;
        }
    }

    /** Nouveau code de secours (12 caractères) : renvoyé une seule fois, à noter ; seule son empreinte est gardée. */
    @JavascriptInterface
    public String nouveauCodeSecours() {
        byte[] a = Protocole.aleatoire(12);
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < 12; i++) {
            b.append(ALPHABET.charAt((a[i] & 0xFF) % 32));
        }
        try {
            prefs.edit().putString("secours", empreinte(b.toString())).commit();
        } catch (GeneralSecurityException e) {
            return null;
        }
        return b.substring(0, 4) + "-" + b.substring(4, 8) + "-" + b.substring(8);
    }

    /**
     * Nouveau mot de passe administrateur avec le code de secours. Renvoie {ok, secours: nouveau code} (le code
     * ne sert qu'une fois) ou {ok:false, message}.
     */
    @JavascriptInterface
    public String recupererAdmin(String code, String nouveau) {
        if (attenteAdmin() > 0) {
            return erreur(0, "Trop d'essais : patientez " + attenteAdmin() + " s.", null);
        }
        String c = code == null ? "" : code.toUpperCase(java.util.Locale.ROOT).replaceAll("[^0-9A-Z]", "");
        if (!(c.length() == 12 && correspond(c, prefs.getString("secours", null)))) {
            int echecs = prefs.getInt("admin_echecs", 0) + 1;
            SharedPreferences.Editor e = prefs.edit().putInt("admin_echecs", echecs);
            if (echecs % 5 == 0) {
                e.putLong("admin_bloque_jusqua", System.currentTimeMillis() + 30_000L * (echecs / 5));
            }
            e.commit();
            return erreur(0, "Code de secours incorrect.", null);
        }
        if (nouveau == null || nouveau.length() < 6) {
            return erreur(0, "Le nouveau mot de passe doit compter 6 caractères au moins.", null);
        }
        try {
            prefs.edit().putString("admin", empreinte(nouveau)).putInt("admin_echecs", 0).commit();
        } catch (GeneralSecurityException e) {
            return erreur(0, "Enregistrement impossible.", null);
        }
        String s = nouveauCodeSecours();
        return "{\"ok\":true,\"secours\":" + (s == null ? "null" : Protocole.jsonTexte(s)) + "}";
    }

    // ------------------------------------------------------------------ licence du téléphone utilisé seul
    private String machine() {
        String id = Settings.Secure.getString(activite.getContentResolver(), Settings.Secure.ANDROID_ID);
        return Licence.empreinte(id == null ? "inconnu" : id);
    }

    /** Démarre la période d'essai (premier usage du téléphone seul) ; sans effet si elle a déjà commencé. */
    @JavascriptInterface
    public void demarrerEssai() {
        if (!prefs.contains("essai_debut")) {
            prefs.edit().putLong("essai_debut", System.currentTimeMillis()).commit();
        }
    }

    @JavascriptInterface
    public String licence() {
        long now = System.currentTimeMillis();
        long vue = prefs.getLong("derniere_vue", 0);
        String etat = Licence.etat(prefs.getString("licence", null), prefs.getString("signature", null),
                Licence.CLE_PUBLIQUE, machine(), prefs.getLong("essai_debut", now), vue, now);
        if (now > vue) {
            prefs.edit().putLong("derniere_vue", now).apply();
        }
        return etat;
    }

    @JavascriptInterface
    public void activer(String id, String code, String ecole) {
        reseau.execute(() -> {
            try {
                String version = "?";
                try {
                    version = activite.getPackageManager().getPackageInfo(activite.getPackageName(), 0).versionName;
                } catch (PackageManager.NameNotFoundException ignored) {
                    // version inconnue
                }
                Licence.Activation a = Licence.activer(Licence.URL_ACTIVATION, code, machine(), ecole,
                        "android-" + version, prefs.getString("licence", null), prefs.getString("signature", null));
                prefs.edit().putString("licence", a.licence).putString("signature", a.signature).commit();
                rendre(id, "{\"ok\":true,\"licence\":" + licence() + "}");
            } catch (Client.Erreur e) {
                rendre(id, erreur(e.statut, e.getMessage(), null));
            } catch (RuntimeException e) {
                rendre(id, erreur(0, "Activation impossible : " + e.getMessage(), null));
            }
        });
    }

    // ------------------------------------------------------------------ fichiers échangés avec l'extérieur
    /**
     * Ouvre le sélecteur de fichiers d'Android. usage « tableau » : le fichier (.xls, .xlsx, .csv) est lu et ses
     * lignes renvoyées ; usage « sauvegarde » : le fichier est gardé en mémoire et une poignée est renvoyée,
     * pour ouvrirSauvegarde(poignee, motDePasse).
     */
    @JavascriptInterface
    public void choisirFichier(String id, String usage) {
        activite.runOnUiThread(() -> {
            if (demandeId != null) {
                rendre(demandeId, erreur(0, "Choix de fichier annulé.", null));
            }
            demandeId = id;
            demandeUsage = usage;
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            try {
                activite.startActivityForResult(i, CHOISIR);
            } catch (RuntimeException e) {
                demandeId = null;
                rendre(id, erreur(0, "Aucune application ne permet de choisir un fichier sur ce téléphone.", null));
            }
        });
    }

    /** Enregistre un fichier là où l'utilisateur le choisit (Téléchargements, Drive, carte SD…). */
    @JavascriptInterface
    public void enregistrerFichier(String id, String nom, String type, String contenu) {
        byte[] b = contenu.getBytes(StandardCharsets.UTF_8);
        if (type.startsWith("text/csv")) {          // Excel reconnaît l'UTF-8 (accents) grâce à l'indicateur BOM
            byte[] avec = new byte[b.length + 3];
            avec[0] = (byte) 0xEF;
            avec[1] = (byte) 0xBB;
            avec[2] = (byte) 0xBF;
            System.arraycopy(b, 0, avec, 3, b.length);
            b = avec;
        }
        demanderEnregistrement(id, nom, type, b);
    }

    /** Sauvegarde chiffrée (mot de passe administrateur) du contenu fourni par l'interface. */
    @JavascriptInterface
    public void creerSauvegarde(String id, String motDePasse, String nom, String contenu) {
        reseau.execute(() -> {
            try {
                byte[] f = Coffre.sceller(motDePasse, contenu.getBytes(StandardCharsets.UTF_8));
                demanderEnregistrement(id, nom, "application/octet-stream", f);
            } catch (GeneralSecurityException e) {
                rendre(id, erreur(0, "Chiffrement impossible : " + e.getMessage(), null));
            }
        });
    }

    @JavascriptInterface
    public String ouvrirSauvegarde(String poignee, String motDePasse) {
        byte[] f = fichiersChoisis.get(poignee);
        try {
            if (f == null) {
                return erreur(0, "Choisissez de nouveau le fichier de sauvegarde.", null);
            }
            if (!Coffre.estUneSauvegarde(f)) {
                return erreur(0, "Ce fichier n'est pas une sauvegarde AKWA SCHOOL (.akwa).", null);
            }
            String contenu = new String(Coffre.ouvrir(motDePasse == null ? "" : motDePasse, f), StandardCharsets.UTF_8);
            fichiersChoisis.remove(poignee);
            return new JSONObject().put("ok", true).put("contenu", contenu).toString();
        } catch (GeneralSecurityException e) {
            return erreur(0, "Mot de passe incorrect, ou fichier modifié.", null);
        } catch (JSONException e) {
            return erreur(0, "Sauvegarde illisible.", null);
        }
    }

    private void demanderEnregistrement(String id, String nom, String type, byte[] contenu) {
        activite.runOnUiThread(() -> {
            if (demandeId != null) {
                rendre(demandeId, erreur(0, "Enregistrement annulé.", null));
            }
            demandeId = id;
            demandeUsage = "enregistrer";
            aEnregistrer = contenu;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(type.split(";")[0]).putExtra(Intent.EXTRA_TITLE, nom);
            try {
                activite.startActivityForResult(i, ENREGISTRER);
            } catch (RuntimeException e) {
                demandeId = null;
                aEnregistrer = null;
                rendre(id, erreur(0, "Aucune application ne permet d'enregistrer un fichier sur ce téléphone.", null));
            }
        });
    }

    /** Réponse d'Android au choix ou à l'enregistrement d'un fichier (appelé par MainActivity). */
    void resultatActivite(int demande, boolean ok, Uri uri) {
        String id = demandeId, usage = demandeUsage;
        byte[] contenu = aEnregistrer;
        demandeId = null;
        aEnregistrer = null;
        if (id == null) {
            return;
        }
        if (!ok || uri == null) {
            rendre(id, "{\"ok\":false,\"annule\":true,\"message\":\"Annulé.\"}");
            return;
        }
        reseau.execute(() -> {
            try {
                if (demande == ENREGISTRER) {
                    try (OutputStream o = activite.getContentResolver().openOutputStream(uri, "wt")) {
                        if (o == null) {
                            throw new IOException("fichier inaccessible");
                        }
                        o.write(contenu);
                    }
                    rendre(id, "{\"ok\":true}");
                    return;
                }
                byte[] data;
                try (InputStream in = activite.getContentResolver().openInputStream(uri)) {
                    if (in == null) {
                        throw new IOException("fichier inaccessible");
                    }
                    data = Tableur.tout(in);
                }
                String nom = uri.getLastPathSegment() == null ? "" : uri.getLastPathSegment();
                if ("reponse".equals(usage)) {
                    rendre(id, ouvrirReponse(data));
                    return;
                }
                if ("sauvegarde".equals(usage)) {
                    String poignee = "f" + System.nanoTime();
                    fichiersChoisis.clear();
                    fichiersChoisis.put(poignee, data);
                    rendre(id, new JSONObject().put("ok", true).put("nom", nom).put("poignee", poignee)
                            .put("sauvegarde", Coffre.estUneSauvegarde(data)).toString());
                } else {
                    rendre(id, "{\"ok\":true,\"nom\":" + Protocole.jsonTexte(nom) + ",\"lignes\":"
                            + Tableur.json(Tableur.lire(data)) + "}");
                }
            } catch (Tableur.Illisible e) {
                rendre(id, erreur(0, e.getMessage(), null));
            } catch (IOException | JSONException | RuntimeException e) {
                rendre(id, erreur(0, "Fichier inaccessible : " + e.getMessage(), null));
            }
        });
    }

    // ------------------------------------------------------------------ impression (et PDF)
    /** Imprime une page HTML préparée par l'interface ; « Enregistrer au format PDF » est proposé par Android. */
    @JavascriptInterface
    public void imprimer(String html, String titre) {
        activite.runOnUiThread(() -> ((MainActivity) activite).imprimer(html, titre));
    }

    /** Imprime la page de l'interface v8 (zone d'impression préparée par la page), A4 portrait ou paysage. */
    @JavascriptInterface
    public void imprimerPage(boolean paysage) {
        activite.runOnUiThread(() -> ((MainActivity) activite).imprimerPage(paysage));
    }
}
