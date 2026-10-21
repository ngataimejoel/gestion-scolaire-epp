package com.akwaschool.mobile.noyau;

import com.akwaschool.mobile.synchro.Client;
import com.akwaschool.mobile.synchro.Protocole;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.Base64;

/**
 * Licence du téléphone utilisé seul (sans ordinateur), mêmes règles que l'application Windows
 * (epp/core/licence.py) :
 * <ul>
 *   <li>7 jours d'essai complets, comptés depuis le premier usage du téléphone seul ;</li>
 *   <li>activation en ligne d'un code (1 an ou à vie) auprès du même service que l'ordinateur ; la licence
 *   reçue est signée (Ed25519), liée à ce téléphone et vérifiée ensuite hors ligne ;</li>
 *   <li>essai terminé ou licence échue : les données sont masquées (jamais effacées) jusqu'à l'activation.</li>
 * </ul>
 * Associé à un ordinateur, le téléphone suit la licence de l'ordinateur (voir l'instantané reçu).
 * Java pur : testé sur l'ordinateur avec des licences signées par le code Python.
 */
public final class Licence {
    public static final int ESSAI_JOURS = 7;
    /** Clé publique du service d'activation : la même que epp/resources/activation.json (vérifié par les tests). */
    public static final String CLE_PUBLIQUE = "mKNteal8hyAeErJGtdNFw5cpQs4pp9lmobERxpDOcgw=";
    public static final String URL_ACTIVATION = "https://epp-expert-activation.netlify.app";
    /** Licence enregistrée après une activation sans Internet : « HL: » suivi du code de licence hors ligne. */
    public static final String PREFIXE_HL = "HL:";
    private static final long JOUR_MS = 86_400_000L;

    private Licence() {
    }

    /** Identifiant anonyme du téléphone envoyé au service (empreinte SHA-256, 64 caractères hexadécimaux). */
    public static String empreinte(String identifiantAndroid) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256")
                    .digest(("AKWA-ANDROID|" + identifiantAndroid).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : h) {
                sb.append(String.format("%02x", b & 0xFF));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] b64u(String s) {
        return Base64.getUrlDecoder().decode(s.trim().replace("=", ""));
    }

    /** Contenu (JSON) de la licence si sa signature est valable et qu'elle concerne ce téléphone, sinon null. */
    public static String verifier(String licence, String signature, String clePublique, String machine) {
        if (licence != null && licence.startsWith(PREFIXE_HL)) {
            return HorsLigne.verifierEnregistre(licence.substring(PREFIXE_HL.length()), machine, clePublique);
        }
        if (licence == null || signature == null || licence.isEmpty() || signature.isEmpty()) {
            return null;
        }
        try {
            byte[] contenu = b64u(licence);
            if (!Ed25519.verifier(Base64.getDecoder().decode(clePublique), contenu, b64u(signature))) {
                return null;
            }
            String json = new String(contenu, StandardCharsets.UTF_8);
            return machine.equals(Protocole.champTexte(json, "machine")) ? json : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    static Instant date(String iso) {
        if (iso == null || iso.isEmpty()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(iso).toInstant();
        } catch (DateTimeParseException e) {
            try {
                return Instant.parse(iso);
            } catch (DateTimeParseException e2) {
                return null;
            }
        }
    }

    /**
     * État de la licence, en JSON : statut (active | essai | essai_termine | expiree | horloge), type,
     * expire_le, jours_restants, utilisable, message.
     *
     * @param essaiDebut   premier usage du téléphone seul (ms), 0 = pas encore commencé
     * @param derniereVue  date la plus récente vue par l'application (ms) : une horloge reculée est refusée
     */
    public static String etat(String licence, String signature, String clePublique, String machine, long essaiDebut,
                              long derniereVue, long maintenant) {
        if (derniereVue > maintenant + JOUR_MS) {
            return json("horloge", null, null, null, false,
                    "La date du téléphone semble avoir été reculée : corrigez-la (Paramètres › Date et heure) pour continuer.");
        }
        String c = verifier(licence, signature, clePublique, machine);
        if (c != null) {
            String type = Protocole.champTexte(c, "type");
            Instant exp = date(Protocole.champTexte(c, "expire_le"));
            if (exp == null) {
                return json("active", type, null, null, true, "Licence à vie activée.");
            }
            long jours = Math.max(0, Math.floorDiv(exp.toEpochMilli() - maintenant, JOUR_MS));
            if (maintenant <= exp.toEpochMilli()) {
                return json("active", type, exp.toString(), jours, true, "Licence valable jusqu'au "
                        + jjmmaaaa(exp) + " (" + jours + " jour(s)).");
            }
            return json("expiree", type, exp.toString(), 0L, false,
                    "Licence expirée : activez un nouveau code pour accéder à vos données (elles sont conservées).");
        }
        long debut = essaiDebut > 0 ? essaiDebut : maintenant;
        long reste = ESSAI_JOURS - Math.floorDiv(maintenant - debut, JOUR_MS);
        if (reste > 0) {
            return json("essai", null, Instant.ofEpochMilli(debut + ESSAI_JOURS * JOUR_MS).toString(), reste, true,
                    "Version d'essai : " + reste + " jour(s) restant(s).");
        }
        return json("essai_termine", null, null, 0L, false,
                "Période d'essai terminée : activez un code pour accéder à vos données (elles sont conservées).");
    }

    private static String jjmmaaaa(Instant i) {
        String s = i.toString();
        return s.substring(8, 10) + "/" + s.substring(5, 7) + "/" + s.substring(0, 4);
    }

    private static String json(String statut, String type, String expire, Long jours, boolean utilisable, String msg) {
        return "{\"statut\":" + Protocole.jsonTexte(statut) + ",\"type\":" + (type == null ? "null" : Protocole.jsonTexte(type))
                + ",\"expire_le\":" + (expire == null ? "null" : Protocole.jsonTexte(expire)) + ",\"jours_restants\":"
                + (jours == null ? "null" : jours) + ",\"utilisable\":" + utilisable + ",\"message\":"
                + Protocole.jsonTexte(msg) + "}";
    }

    // ------------------------------------------------------------------ contrôle a posteriori des codes hors ligne
    public static final long CONTROLE_MS = 7 * JOUR_MS;
    public static final long DELAI_REGISTRE_MS = 30 * JOUR_MS;

    /** État renvoyé quand le contrôle en ligne a refusé le code hors ligne (statut « inconnu » ou « revoque »). */
    public static String refus(String statut) {
        return json("expiree", null, null, 0L, false, "revoque".equals(statut)
                ? "Code de licence annulé par le fournisseur : contactez-le ou activez un nouveau code (vos données "
                + "sont conservées)."
                : "Code de licence non reconnu par le fournisseur : activez un code authentique pour accéder à vos "
                + "données (elles sont conservées).");
    }

    static String sha256Hex(String s) {
        try {
            StringBuilder sb = new StringBuilder();
            for (byte b : MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8))) {
                sb.append(String.format("%02x", b & 0xFF));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * Compare le code hors ligne au registre du fournisseur (Internet nécessaire) : « connu », « inconnu » (code
     * pirate) ou « revoque » ; null hors connexion ou si la réponse n'est pas signée par le service.
     */
    public static String controlerHorsLigne(String url, String code, String machine, String clePublique) {
        String h = sha256Hex(HorsLigne.nettoyer(code));
        String corps = "{\"h\":" + Protocole.jsonTexte(h) + ",\"machine\":" + Protocole.jsonTexte(machine) + "}";
        try {
            Client.Reponse r = Client.post(url.replaceAll("/+$", "") + "/api/hors-ligne/controle",
                    corps.getBytes(StandardCharsets.UTF_8), "application/json", null);
            if (r.statut != 200) {
                return null;
            }
            String t = r.texte(), rep = Protocole.champTexte(t, "reponse"), sig = Protocole.champTexte(t, "signature");
            if (rep == null || sig == null
                    || !Ed25519.verifier(Base64.getDecoder().decode(clePublique), b64u(rep), b64u(sig))) {
                return null;
            }
            String c = new String(b64u(rep), StandardCharsets.UTF_8);
            String statut = Protocole.champTexte(c, "statut");
            return h.equals(Protocole.champTexte(c, "h")) && machine.equals(Protocole.champTexte(c, "machine"))
                    && ("connu".equals(statut) || "inconnu".equals(statut) || "revoque".equals(statut)) ? statut : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Résultat d'une activation réussie : licence et signature à enregistrer. */
    public static final class Activation {
        public final String licence;
        public final String signature;

        Activation(String licence, String signature) {
            this.licence = licence;
            this.signature = signature;
        }
    }

    /** Active un code auprès du service en ligne (Internet nécessaire à ce moment seulement). */
    public static Activation activer(String url, String code, String machine, String ecole, String version,
                                     String licenceActuelle, String signatureActuelle) throws Client.Erreur {
        return activer(url, code, machine, ecole, version, licenceActuelle, signatureActuelle, "ecole");
    }

    /** {@code espace} : « ecole » ou « enseignant » (espace enseignant seul, seul à accepter les codes enseignant). */
    public static Activation activer(String url, String code, String machine, String ecole, String version,
                                     String licenceActuelle, String signatureActuelle, String espace)
            throws Client.Erreur {
        String corps = "{\"code\":" + Protocole.jsonTexte(code == null ? "" : code.trim()) + ",\"machine\":"
                + Protocole.jsonTexte(machine) + ",\"ecole\":" + Protocole.jsonTexte(ecole) + ",\"version\":"
                + Protocole.jsonTexte(version) + ",\"espace\":" + Protocole.jsonTexte(espace) + ",\"licence_actuelle\":"
                + (licenceActuelle == null ? "null" : Protocole.jsonTexte(licenceActuelle)) + ",\"signature_actuelle\":"
                + (signatureActuelle == null ? "null" : Protocole.jsonTexte(signatureActuelle)) + "}";
        Client.Reponse r = Client.post(url.replaceAll("/+$", "") + "/api/activer",
                corps.getBytes(StandardCharsets.UTF_8), "application/json", null);
        if (r.statut == 0) {
            throw new Client.Erreur(0, "Impossible de joindre le service d'activation. Vérifiez la connexion Internet "
                    + "du téléphone et réessayez.", null);
        }
        String texte = r.texte();
        if (r.statut != 200) {
            String m = Protocole.champTexte(texte, "erreur");
            throw new Client.Erreur(r.statut, m != null ? m.replace("ordinateur", "appareil")
                    : "Le service d'activation a répondu par une erreur (" + r.statut + ").", texte);
        }
        String lic = Protocole.champTexte(texte, "licence"), sig = Protocole.champTexte(texte, "signature");
        if (verifier(lic, sig, CLE_PUBLIQUE, machine) == null) {
            throw new Client.Erreur(0, "La réponse du service d'activation n'est pas authentique.", null);
        }
        return new Activation(lic, sig);
    }
}
