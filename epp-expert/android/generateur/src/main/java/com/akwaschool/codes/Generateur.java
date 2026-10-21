package com.akwaschool.codes;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import com.akwaschool.mobile.noyau.HorsLigne;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Date;
import java.util.Locale;

/**
 * Générateur de codes de licence hors ligne (outil du fournisseur, sans réseau) : saisit le code de demande affiché
 * par l'appareil de l'école et renvoie le code de licence de 25 caractères (5-5-5-5-5) pour cet appareil. La clé
 * maîtresse est gardée chiffrée par un mot de passe ; elle est oubliée dès que l'application passe en arrière-plan.
 * Le secret des applications en est dérivé (« Clé pour GitHub », secret AKWA_CLES_CODES_COURTS).
 */
public final class Generateur extends Activity {
    static final String[] TYPES = {"1an", "vie", "ens1an", "ensvie"};
    static final String URL_SERVICE = "https://epp-expert-activation.netlify.app";
    static final String[] LIBELLES = {"École, 1 an", "École, à vie", "Enseignant seul, 1 an", "Enseignant seul, à vie"};

    private SharedPreferences prefs;
    private byte[] graine;
    private LinearLayout page;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        prefs = getSharedPreferences("cle", MODE_PRIVATE);
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (graine == null) {
            if (prefs.contains("chiffre")) {
                ecranDeverrouiller();
            } else {
                ecranInstaller();
            }
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (graine != null && !isChangingConfigurations()) {
            Arrays.fill(graine, (byte) 0);
            graine = null;
        }
    }

    // ------------------------------------------------------------------ mise en page
    private void nouvellePage(String titre) {
        ScrollView sv = new ScrollView(this);
        page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        int p = dp(18);
        page.setPadding(p, p, p, p);
        sv.addView(page);
        setContentView(sv);
        TextView t = texte(titre);
        t.setTextSize(20);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        page.addView(t);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private TextView texte(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(15);
        t.setPadding(0, dp(10), 0, dp(4));
        return t;
    }

    private EditText champ(String indice, boolean secret) {
        EditText e = new EditText(this);
        e.setHint(indice);
        e.setInputType(secret ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD
                : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        page.addView(e);
        return e;
    }

    private Button bouton(String s, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setOnClickListener(l);
        page.addView(b);
        return b;
    }

    private void message(String s) {
        new AlertDialog.Builder(this).setMessage(s).setPositiveButton("OK", null).show();
    }

    /** Calcul long (dérivation du mot de passe) hors du fil de l'interface. */
    private void enArrierePlan(Button b, Runnable travail) {
        b.setEnabled(false);
        new Thread(() -> {
            travail.run();
            runOnUiThread(() -> b.setEnabled(true));
        }).start();
    }

    // ------------------------------------------------------------------ clé
    private void ecranInstaller() {
        nouvellePage("AKWA Codes hors ligne");
        page.addView(texte("Collez la clé privée du service (variable EPP_LICENCE_CLE_PRIVEE de Netlify) : les codes "
                + "à garder en lieu sûr. Laissez vide pour créer une nouvelle clé maîtresse. Ensuite, mettez la « Clé pour "
                + "GitHub » dans le secret AKWA_CLES_CODES_COURTS avant de compiler les applications."));
        EditText cle = champ("Clé privée (base64), facultative", true);
        page.addView(texte("Mot de passe du générateur (8 caractères au moins) :"));
        EditText m1 = champ("Mot de passe", true), m2 = champ("Confirmation", true);
        bouton("Enregistrer la clé", v -> {
            String a = m1.getText().toString(), c = cle.getText().toString().trim();
            if (!a.equals(m2.getText().toString())) {
                message("Les deux mots de passe sont différents.");
                return;
            }
            enArrierePlan((Button) v, () -> {
                try {
                    byte[] g;
                    if (c.isEmpty()) {
                        g = new byte[32];
                        new SecureRandom().nextBytes(g);
                    } else {
                        g = Cle.graineDepuisTexte(c);
                    }
                    Cle.Scellee s = Cle.sceller(g, a);
                    prefs.edit().putString("sel", s.sel).putString("nonce", s.nonce).putString("chiffre", s.chiffre)
                            .putString("publique", Cle.publique(g)).commit();
                    runOnUiThread(() -> {
                        graine = g;
                        ecranPrincipal();
                    });
                } catch (IllegalArgumentException | GeneralSecurityException e) {
                    runOnUiThread(() -> message(e.getMessage()));
                }
            });
        });
    }

    private void ecranDeverrouiller() {
        nouvellePage("AKWA Codes hors ligne");
        page.addView(texte("Mot de passe du générateur :"));
        EditText m = champ("Mot de passe", true);
        bouton("Ouvrir", v -> {
            String mdp = m.getText().toString();
            enArrierePlan((Button) v, () -> {
                try {
                    byte[] g = Cle.ouvrir(new Cle.Scellee(prefs.getString("sel", ""), prefs.getString("nonce", ""),
                            prefs.getString("chiffre", "")), mdp);
                    runOnUiThread(() -> {
                        graine = g;
                        ecranPrincipal();
                    });
                } catch (GeneralSecurityException | IllegalArgumentException e) {
                    runOnUiThread(() -> message("Mot de passe incorrect."));
                }
            });
        });
    }

    // ------------------------------------------------------------------ codes
    private void ecranPrincipal() {
        nouvellePage("AKWA Codes hors ligne");
        int numero = prefs.getInt("numero", 1);
        TextView cle = texte("Clé n° " + numero + " : les applications compilées avec la même « Clé pour GitHub » "
                + "acceptent les codes.");
        cle.setTextColor(Color.rgb(14, 102, 70));
        page.addView(cle);
        page.addView(texte("Code de demande affiché par l'appareil de l'école :"));
        EditText demande = champ("XXXX-XXXX-XXXX-XXXX", false);
        demande.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        demande.setTypeface(Typeface.MONOSPACE);
        page.addView(texte("Type de licence :"));
        Spinner type = new Spinner(this);
        type.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, LIBELLES));
        page.addView(type);
        page.addView(texte("Établissement ou note (registre) :"));
        EditText note = champ("EPP …", false);
        TextView sortie = new TextView(this);
        sortie.setTypeface(Typeface.MONOSPACE);
        sortie.setTextSize(17);
        sortie.setTextIsSelectable(true);
        sortie.setPadding(0, dp(12), 0, dp(12));
        String[] dernier = {null};
        bouton("Générer le code de licence", v -> {
            int i = type.getSelectedItemPosition();
            boolean an = TYPES[i].endsWith("1an");
            LocalDate expire = an ? LocalDate.now().plusDays(365) : null;
            int emis = (int) ChronoUnit.DAYS.between(HorsLigne.ORIGINE, LocalDate.now());
            String code;
            try {
                code = HorsLigne.coderCourt(HorsLigne.secretCourt(graine, numero), numero,
                        demande.getText().toString(), TYPES[i], emis);
            } catch (IllegalArgumentException e) {
                message(e.getMessage());
                return;
            }
            String num = HorsLigne.serieCourt(code);
            String d16 = HorsLigne.grouper(HorsLigne.nettoyer(demande.getText().toString()));
            noter(new String[]{new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT).format(new Date()), num,
                    LIBELLES[i], expire == null ? "" : expire.toString(), d16, note.getText().toString().trim(),
                    TYPES[i], empreinte(code)});
            dernier[0] = code;
            sortie.setText(code + "\n\n" + LIBELLES[i] + (expire == null ? "" : ", expire le " + expire) + " · " + num);
            copier(code);
        });
        page.addView(texte("Code de licence à saisir sur l'appareil de l'école (copié automatiquement) :"));
        page.addView(sortie);
        bouton("Partager le code", v -> {
            if (dernier[0] != null) {
                partager("Code de licence AKWA SCHOOL", dernier[0]);
            }
        });
        bouton("Clé pour GitHub", v -> new AlertDialog.Builder(this)
                .setMessage("Valeur du secret GitHub AKWA_CLES_CODES_COURTS (Settings › Secrets and variables › Actions)."
                        + " Ne la donnez à personne d'autre.")
                .setPositiveButton("Copier", (d, w) -> copier(numero + ":" + java.util.Base64.getEncoder().encodeToString(HorsLigne.secretCourt(graine, numero))))
                .setNegativeButton("Fermer", null).show());
        bouton("Changer de numéro de clé (fuite)", v -> new AlertDialog.Builder(this)
                .setMessage("À faire seulement si des codes pirates circulent : la prochaine version des applications "
                        + "refusera les codes de la clé n° " + numero + ". Continuer ?")
                .setPositiveButton("Oui", (d, w) -> {
                    if (numero >= 7) {
                        message("Dernier numéro atteint : créez une nouvelle clé maîtresse.");
                        return;
                    }
                    prefs.edit().putInt("numero", numero + 1).commit();
                    ecranPrincipal();
                })
                .setNegativeButton("Non", null).show());
        bouton("Envoyer le registre (Internet)", v -> {
            EditText jeton = new EditText(this);
            jeton.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            jeton.setHint("EPP_ADMIN_TOKEN");
            new AlertDialog.Builder(this).setTitle("Jeton administrateur du service").setView(jeton)
                    .setPositiveButton("Envoyer", (d, w) -> envoyerRegistre(jeton.getText().toString().trim()))
                    .setNegativeButton("Annuler", null).show();
        });
        bouton("Partager le registre", v -> {
            File f = registre();
            try {
                partager("Registre des codes hors ligne", f.exists()
                        ? new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8) : "Registre vide.");
            } catch (IOException e) {
                message("Registre illisible : " + e.getMessage());
            }
        });
    }

    /** Empreinte envoyée au service : le code lui-même ne quitte pas l'appareil. */
    static String empreinte(String code) {
        try {
            StringBuilder sb = new StringBuilder();
            for (byte b : java.security.MessageDigest.getInstance("SHA-256")
                    .digest(HorsLigne.nettoyer(code).getBytes(StandardCharsets.UTF_8))) {
                sb.append(String.format("%02x", b & 0xFF));
            }
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * Envoie les empreintes des codes émis au service : un appareil qui retrouve Internet vérifie que son code y
     * figure (un code pirate en est absent et finit refusé).
     */
    private void envoyerRegistre(String jeton) {
        File f = registre();
        if (!f.exists() || jeton.isEmpty()) {
            return;
        }
        new Thread(() -> {
            String resultat;
            try {
                StringBuilder corps = new StringBuilder("{\"codes\":[");
                int n = 0;
                for (String ligne : Files.readAllLines(f.toPath(), StandardCharsets.UTF_8)) {
                    String[] c = ligne.split(";", -1);
                    if (c.length < 8 || !c[7].matches("[0-9a-f]{64}")) {
                        continue;
                    }
                    corps.append(n++ > 0 ? "," : "").append("{\"h\":\"").append(c[7]).append("\",\"type\":\"")
                            .append(c[6]).append("\",\"emis\":\"").append(c[0], 0, Math.min(10, c[0].length()))
                            .append("\"}");
                }
                java.net.HttpURLConnection h = (java.net.HttpURLConnection) new java.net.URL(URL_SERVICE
                        + "/api/admin/hors-ligne").openConnection();
                h.setRequestMethod("POST");
                h.setDoOutput(true);
                h.setConnectTimeout(15000);
                h.setReadTimeout(30000);
                h.setRequestProperty("Content-Type", "application/json");
                h.setRequestProperty("Authorization", "Bearer " + jeton);
                h.getOutputStream().write(corps.append("]}").toString().getBytes(StandardCharsets.UTF_8));
                int st = h.getResponseCode();
                resultat = st == 200 ? "Registre envoyé : " + n + " code(s)."
                        : st == 401 ? "Jeton refusé par le service." : "Erreur du service (" + st + ").";
                h.disconnect();
            } catch (IOException e) {
                resultat = "Service injoignable : vérifiez la connexion Internet.";
            }
            String r = resultat;
            runOnUiThread(() -> message(r));
        }).start();
    }

    private File registre() {
        return new File(getFilesDir(), "registre.csv");
    }

    private void noter(String[] colonnes) {
        File f = registre();
        StringBuilder sb = new StringBuilder();
        if (!f.exists()) {
            sb.append("Date;Numéro;Type;Expire le;Code de demande;Établissement ou note;Type (code);Empreinte\n");
        }
        for (int i = 0; i < colonnes.length; i++) {
            sb.append(i > 0 ? ";" : "").append(colonnes[i].replace(";", ",").replace("\n", " "));
        }
        try (FileOutputStream o = new FileOutputStream(f, true)) {
            o.write(sb.append('\n').toString().getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            Toast.makeText(this, "Registre non écrit : " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void copier(String s) {
        ((ClipboardManager) getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("code", s));
        Toast.makeText(this, "Code copié.", Toast.LENGTH_SHORT).show();
    }

    private void partager(String sujet, String texte) {
        Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, sujet)
                .putExtra(Intent.EXTRA_TEXT, texte);
        startActivity(Intent.createChooser(i, sujet));
    }
}
