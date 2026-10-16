package com.akwaschool.mobile.noyau;

import com.akwaschool.mobile.synchro.Protocole;

import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Comptes des enseignants du téléphone (comme AKWA SCHOOL v8 sous Windows) : créés par le directeur avec un mot de
 * passe provisoire, que l'enseignant remplace à sa première connexion ; il reçoit alors un code de secours (mot de
 * passe oublié, sans Internet). Seules des empreintes PBKDF2 sont gardées. Texte enregistré : une ligne par compte,
 * « identifiant, enseignant, empreinte du mot de passe, provisoire (0/1), empreinte du code de secours » séparés par
 * des tabulations.
 */
public final class Comptes {
    private static final Pattern IDENTIFIANT = Pattern.compile("[a-z0-9._-]{2,30}");
    private static final Pattern ENSEIGNANT = Pattern.compile("[A-Za-z0-9_-]{1,40}");
    private static final String ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

    /** Refus lisible par l'utilisateur. */
    public static final class Erreur extends Exception {
        public Erreur(String message) {
            super(message);
        }
    }

    public static final class Compte {
        public final String login;
        public final String enseignant;
        String empreinte;
        boolean provisoire;
        String secours;

        Compte(String login, String enseignant, String empreinte, boolean provisoire, String secours) {
            this.login = login;
            this.enseignant = enseignant;
            this.empreinte = empreinte;
            this.provisoire = provisoire;
            this.secours = secours;
        }

        public boolean provisoire() {
            return provisoire;
        }
    }

    private final Map<String, Compte> comptes = new LinkedHashMap<>();
    private final int iterations;

    public Comptes(String texte, int iterations) {
        this.iterations = iterations;
        if (texte == null) {
            return;
        }
        for (String l : texte.split("\n")) {
            String[] x = l.split("\t", -1);
            if (x.length == 5 && IDENTIFIANT.matcher(x[0]).matches()) {
                comptes.put(x[0], new Compte(x[0], x[1], x[2], "1".equals(x[3]), x[4].isEmpty() ? null : x[4]));
            }
        }
    }

    public String texte() {
        StringBuilder b = new StringBuilder();
        for (Compte c : comptes.values()) {
            b.append(c.login).append('\t').append(c.enseignant).append('\t').append(c.empreinte).append('\t')
                    .append(c.provisoire ? "1" : "0").append('\t').append(c.secours == null ? "" : c.secours).append('\n');
        }
        return b.toString();
    }

    public static String normaliser(String login) {
        return login == null ? "" : login.trim().toLowerCase(Locale.ROOT);
    }

    public Compte parEnseignant(String enseignant) {
        for (Compte c : comptes.values()) {
            if (c.enseignant.equals(enseignant)) {
                return c;
            }
        }
        return null;
    }

    public List<Compte> tous() {
        return new ArrayList<>(comptes.values());
    }

    // ------------------------------------------------------------------ gestion par le directeur
    /** Crée le compte de l'enseignant et renvoie son mot de passe provisoire (à lui remettre). */
    public String creer(String enseignant, String login) throws Erreur {
        String l = normaliser(login);
        if (!IDENTIFIANT.matcher(l).matches() || "admin".equals(l)) {
            throw new Erreur("Identifiant invalide : 2 à 30 lettres minuscules, chiffres, point ou tiret, sans accent.");
        }
        if (enseignant == null || !ENSEIGNANT.matcher(enseignant).matches()) {
            throw new Erreur("Enseignant inconnu.");
        }
        if (comptes.containsKey(l)) {
            throw new Erreur("Cet identifiant est déjà utilisé.");
        }
        if (parEnseignant(enseignant) != null) {
            throw new Erreur("Cet enseignant a déjà un compte.");
        }
        String mdp = provisoire();
        comptes.put(l, new Compte(l, enseignant, empreinte(mdp), true, null));
        return mdp;
    }

    /** Nouveau mot de passe provisoire (enseignant qui a oublié le sien et perdu son code de secours). */
    public String reinitialiser(String enseignant) throws Erreur {
        Compte c = parEnseignant(enseignant);
        if (c == null) {
            throw new Erreur("Cet enseignant n'a pas de compte.");
        }
        String mdp = provisoire();
        c.empreinte = empreinte(mdp);
        c.provisoire = true;
        return mdp;
    }

    public void supprimer(String enseignant) {
        Compte c = parEnseignant(enseignant);
        if (c != null) {
            comptes.remove(c.login);
        }
    }

    // ------------------------------------------------------------------ connexion de l'enseignant
    /** Le compte si le mot de passe est le bon, sinon null. */
    public Compte verifier(String login, String mdp) {
        Compte c = comptes.get(normaliser(login));
        return c != null && correspond(mdp, c.empreinte, iterations) ? c : null;
    }

    /** Mot de passe choisi par l'enseignant ; renvoie son nouveau code de secours (à noter, il ne sert qu'une fois). */
    public String definir(String login, String nouveau) throws Erreur {
        Compte c = comptes.get(normaliser(login));
        if (c == null) {
            throw new Erreur("Compte inconnu.");
        }
        if (nouveau == null || nouveau.length() < 6) {
            throw new Erreur("Le mot de passe doit compter 6 caractères au moins.");
        }
        if (nouveau.startsWith("Prov-")) {
            throw new Erreur("Choisissez un mot de passe personnel.");
        }
        c.empreinte = empreinte(nouveau);
        c.provisoire = false;
        String code = code();
        c.secours = empreinte(code.replace("-", ""));
        return code;
    }

    /** Mot de passe oublié : le code de secours permet d'en choisir un nouveau ; un nouveau code est renvoyé. */
    public String recuperer(String login, String code, String nouveau) throws Erreur {
        Compte c = comptes.get(normaliser(login));
        String k = code == null ? "" : code.toUpperCase(Locale.ROOT).replaceAll("[^0-9A-Z]", "");
        if (c == null || c.secours == null || k.length() != 12 || !correspond(k, c.secours, iterations)) {
            throw new Erreur("Identifiant ou code de secours incorrect.");
        }
        return definir(login, nouveau);
    }

    // ------------------------------------------------------------------ outils
    private static String tirage(int n) {
        byte[] a = Protocole.aleatoire(n);
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < n; i++) {
            b.append(ALPHABET.charAt((a[i] & 0xFF) % 32));
        }
        return b.toString();
    }

    private static String provisoire() {
        return "Prov-" + tirage(6);
    }

    private static String code() {
        String b = tirage(12);
        return b.substring(0, 4) + "-" + b.substring(4, 8) + "-" + b.substring(8);
    }

    private String empreinte(String secret) {
        try {
            byte[] sel = Protocole.aleatoire(16);
            return Protocole.b64(sel) + ":" + Protocole.b64(Protocole.pbkdf2(secret.toCharArray(), sel, iterations));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static boolean correspond(String secret, String stocke, int iterations) {
        if (secret == null || stocke == null) {
            return false;
        }
        try {
            String[] x = stocke.split(":");
            return Protocole.egaux(Protocole.unb64(x[1]),
                    Protocole.pbkdf2(secret.toCharArray(), Protocole.unb64(x[0]), iterations));
        } catch (GeneralSecurityException | RuntimeException e) {
            return false;
        }
    }
}
