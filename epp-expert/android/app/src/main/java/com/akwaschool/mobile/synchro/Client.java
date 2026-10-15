package com.akwaschool.mobile.synchro;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;

/** Requêtes HTTP vers l'ordinateur de l'école (Java pur, testé sur l'ordinateur contre le serveur Python). */
public final class Client {
    public static final int DELAI_CONNEXION_MS = 6000;
    public static final int DELAI_LECTURE_MS = 120000;

    private Client() {
    }

    /** Réponse brute : statut HTTP (0 = ordinateur injoignable) et corps. */
    public static final class Reponse {
        public final int statut;
        public final byte[] corps;
        public final String erreur;

        Reponse(int statut, byte[] corps, String erreur) {
            this.statut = statut;
            this.corps = corps;
            this.erreur = erreur;
        }

        public String texte() {
            return corps == null ? "" : new String(corps, StandardCharsets.UTF_8);
        }
    }

    /** Résultat d'une association réussie. */
    public static final class Association {
        public final long appareilId;
        public final byte[] cle;
        public final String serveurId;
        /** contenu renvoyé par l'ordinateur, sans la clé secrète (école, compte). */
        public final String contenu;

        Association(long appareilId, byte[] cle, String serveurId, String contenu) {
            this.appareilId = appareilId;
            this.cle = cle;
            this.serveurId = serveurId;
            this.contenu = contenu;
        }
    }

    /** Erreur lisible par l'utilisateur (message du serveur ou explication). */
    public static final class Erreur extends Exception {
        public final int statut;
        public final String corps;

        public Erreur(int statut, String message, String corps) {
            super(message);
            this.statut = statut;
            this.corps = corps;
        }
    }

    /** « 192.168.1.20 » ou « 192.168.1.20:8765 » → « http://192.168.1.20:8765 ». */
    public static String base(String adresse) {
        String a = adresse == null ? "" : adresse.trim();
        if (a.startsWith("http://")) {
            a = a.substring(7);
        }
        while (a.endsWith("/")) {
            a = a.substring(0, a.length() - 1);
        }
        return "http://" + (a.contains(":") ? a : a + ":" + Protocole.PORT_HTTP);
    }

    public static Reponse post(String url, byte[] corps, String type, String appareil) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) URI.create(url).toURL().openConnection();
            c.setConnectTimeout(DELAI_CONNEXION_MS);
            c.setReadTimeout(DELAI_LECTURE_MS);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setUseCaches(false);
            c.setRequestProperty("Content-Type", type);
            if (appareil != null) {
                c.setRequestProperty("X-Akwa-Appareil", appareil);
            }
            c.setFixedLengthStreamingMode(corps.length);
            try (OutputStream o = c.getOutputStream()) {
                o.write(corps);
            }
            int st = c.getResponseCode();
            InputStream in = st >= 400 ? c.getErrorStream() : c.getInputStream();
            return new Reponse(st, lire(in), null);
        } catch (IOException e) {
            return new Reponse(0, null, e.getClass().getSimpleName() + ": " + e.getMessage());
        } finally {
            if (c != null) {
                c.disconnect();
            }
        }
    }

    private static byte[] lire(InputStream in) throws IOException {
        if (in == null) {
            return new byte[0];
        }
        try (InputStream i = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = i.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private static String messageServeur(Reponse r, String defaut) {
        String m = r.corps == null ? null : Protocole.champTexte(r.texte(), "erreur");
        return m != null ? decoderUnicode(m) : defaut;
    }

    /** Les messages du serveur sont en UTF-8 sans échappement ; seuls \\uXXXX éventuels sont décodés. */
    static String decoderUnicode(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && i + 5 < s.length() && s.charAt(i + 1) == 'u') {
                sb.append((char) Integer.parseInt(s.substring(i + 2, i + 6), 16));
                i += 5;
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    public static Association appairer(String adresse, String code, String nom) throws Erreur {
        try {
            byte[] sel = Protocole.aleatoire(16);
            byte[] k = Protocole.cleAppairage(code, sel);
            String corps = "{\"sel\":" + Protocole.jsonTexte(Protocole.b64(sel)) + ",\"preuve\":"
                    + Protocole.jsonTexte(Protocole.b64(Protocole.preuve(k))) + ",\"nom\":" + Protocole.jsonTexte(nom)
                    + ",\"protocole\":" + Protocole.VERSION + "}";
            Reponse r = post(base(adresse) + "/api/appairer", corps.getBytes(StandardCharsets.UTF_8),
                    "application/json; charset=utf-8", null);
            if (r.statut == 0) {
                throw new Erreur(0, "Ordinateur injoignable à l'adresse " + adresse + ". Vérifiez que le téléphone "
                        + "est sur le même Wi-Fi et que la synchronisation est démarrée sur l'ordinateur.", null);
            }
            if (r.statut != 200) {
                throw new Erreur(r.statut, messageServeur(r, "L'ordinateur a refusé l'association (" + r.statut
                        + ")."), r.texte());
            }
            String donnees = Protocole.champTexte(r.texte(), "donnees");
            if (donnees == null) {
                throw new Erreur(r.statut, "Réponse inattendue de l'ordinateur.", r.texte());
            }
            String contenu = new String(Protocole.ouvrir(k, Protocole.unb64(donnees), Protocole.AAD_APPAIRAGE),
                    StandardCharsets.UTF_8);
            String cle = Protocole.champTexte(contenu, "cle");
            Long id = Protocole.champEntier(contenu, "appareil_id");
            if (cle == null || id == null) {
                throw new Erreur(r.statut, "Réponse d'association incomplète.", null);
            }
            String visible = contenu.replace("\"cle\":\"" + cle + "\"", "\"cle\":\"\"");
            return new Association(id, Protocole.unb64(cle), Protocole.champTexte(contenu, "serveur_id"), visible);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new Erreur(0, "Réponse de l'ordinateur non authentique : vérifiez le code et réessayez.", null);
        }
    }

    /**
     * Envoie une requête de synchronisation (objet JSON sans « seq », construit par l'interface) et renvoie la
     * réponse déchiffrée (JSON). Le compteur seq doit avoir été enregistré avant l'appel.
     */
    public static String synchroniser(String adresse, long appareilId, byte[] cle, long seq, String requete)
            throws Erreur {
        String r0 = requete.trim();
        if (!r0.startsWith("{")) {
            throw new Erreur(0, "Requête invalide.", null);
        }
        String json = "{\"seq\":" + seq + (r0.equals("{}") ? "}" : "," + r0.substring(1));
        try {
            byte[] msg = Protocole.sceller(cle, json.getBytes(StandardCharsets.UTF_8), Protocole.aadRequete(appareilId));
            Reponse r = post(base(adresse) + "/api/synchro", msg, "application/octet-stream", String.valueOf(appareilId));
            if (r.statut == 0) {
                throw new Erreur(0, "Ordinateur injoignable (" + adresse + ").", null);
            }
            if (r.statut != 200) {
                throw new Erreur(r.statut, messageServeur(r, "Synchronisation refusée (" + r.statut + ")."), r.texte());
            }
            return new String(Protocole.ouvrir(cle, r.corps, Protocole.aadReponse(appareilId, seq)),
                    StandardCharsets.UTF_8);
        } catch (GeneralSecurityException e) {
            throw new Erreur(0, "Réponse de l'ordinateur non authentique.", null);
        }
    }
}
