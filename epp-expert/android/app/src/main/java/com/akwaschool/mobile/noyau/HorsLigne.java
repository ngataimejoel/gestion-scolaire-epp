package com.akwaschool.mobile.noyau;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.security.InvalidKeyException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Activation sans Internet (zones sans réseau), mêmes règles que epp/core/hors_ligne.py : le téléphone affiche un
 * code de demande (16 caractères) ; le générateur du fournisseur renvoie un code de licence signé (Ed25519) pour
 * ce téléphone seulement, vérifié ici sans connexion : code court de 25 caractères (5-5-5-5-5, scellé HMAC par un
 * secret injecté masqué à la compilation, voir hors_ligne.py) ou ancien code long de 112 caractères (Ed25519).
 */
public final class HorsLigne {
    public static final String ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    public static final String[] TYPES = {"", "1an", "vie", "ens1an", "ensvie"};
    public static final LocalDate ORIGINE = LocalDate.of(2026, 1, 1);
    public static final int LONGUEUR_CODE = 112;
    /** Clés publiques supplémentaires (générateur hors ligne doté de sa propre clé), en plus de celle du service. */
    public static final String[] CLES_SUPP = {};
    public static final int LONGUEUR_COURT = 25;
    /** Secrets des codes courts de cette version (numéro → secret), installés au démarrage depuis BuildConfig. */
    public static volatile Map<Integer, byte[]> clesCourtes = new TreeMap<>();

    private HorsLigne() {
    }

    public static String nettoyer(String texte) {
        StringBuilder sb = new StringBuilder();
        for (char c : (texte == null ? "" : texte).toUpperCase().toCharArray()) {
            if (ALPHABET.indexOf(c) >= 0) {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    public static boolean estCode(String texte) {
        int n = nettoyer(texte).length();
        return n == LONGUEUR_COURT || n >= 100;
    }

    static char controle(String c15) {
        int s = 0;
        for (int i = 0; i < c15.length(); i++) {
            s += (i + 1) * ALPHABET.indexOf(c15.charAt(i));
        }
        return ALPHABET.charAt(s % 32);
    }

    static String bits(byte[] octets, int n) {
        BigInteger v = new BigInteger(1, octets);
        int total = octets.length * 8;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            sb.append(ALPHABET.charAt(v.shiftRight(total - 5 * (i + 1)).intValue() & 31));
        }
        return sb.toString();
    }

    public static String grouper(String code) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < code.length(); i += 4) {
            if (i > 0) {
                sb.append('-');
            }
            sb.append(code, i, Math.min(code.length(), i + 4));
        }
        return sb.toString();
    }

    /** Code de demande de cet appareil (« XXXX-XXXX-XXXX-XXXX »). */
    public static String demande(String empreinte) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256")
                    .digest(("AKWA-HL|" + empreinte).getBytes(StandardCharsets.UTF_8));
            String c15 = bits(Arrays.copyOf(h, 10), 15);
            return grouper(c15 + controle(c15));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Les 15 caractères utiles d'un code de demande saisi, ou IllegalArgumentException (faute de frappe). */
    public static String demandeValide(String texte) {
        String c = nettoyer(texte);
        if (c.length() != 16 || controle(c.substring(0, 15)) != c.charAt(15)) {
            throw new IllegalArgumentException("Code de demande incorrect : vérifiez les 16 caractères.");
        }
        return c.substring(0, 15);
    }

    /** {@code expireJour} : jours depuis le 1er janvier 2026 (0 : à vie). */
    public static byte[] chargeUtile(String type, int expireJour, int serie) {
        int t = Arrays.asList(TYPES).indexOf(type);
        if (t < 1 || expireJour < 0 || expireJour > 65535 || serie < 0 || serie >= 1 << 24) {
            throw new IllegalArgumentException("licence hors ligne impossible");
        }
        return new byte[]{(byte) (0x10 | t), (byte) (expireJour >> 8), (byte) expireJour, (byte) (serie >> 16),
                (byte) (serie >> 8), (byte) serie};
    }

    static byte[] message(String demande15, byte[] charge) {
        byte[] a = ("AKWA-HL1|" + demande15).getBytes(StandardCharsets.US_ASCII);
        byte[] m = Arrays.copyOf(a, a.length + charge.length);
        System.arraycopy(charge, 0, m, a.length, charge.length);
        return m;
    }

    static String coder(byte[] octets) {
        return bits(octets, octets.length * 8 / 5);
    }

    static byte[] decoder(String code) {
        String c = nettoyer(code);
        if (c.length() != LONGUEUR_CODE) {
            throw new IllegalArgumentException("Code de licence incomplet : il compte 112 caractères (28 groupes de 4).");
        }
        BigInteger v = BigInteger.ZERO;
        for (char x : c.toCharArray()) {
            v = v.shiftLeft(5).or(BigInteger.valueOf(ALPHABET.indexOf(x)));
        }
        byte[] b = v.toByteArray();
        byte[] r = new byte[70];
        int n = Math.min(b.length, 70);
        System.arraycopy(b, b.length - n, r, 70 - n, n);
        return r;
    }

    /** Clés reconnues : celle du service d'activation et les clés supplémentaires. */
    public static String[] cles(String clePublique) {
        List<String> l = new ArrayList<>();
        l.add(clePublique);
        l.addAll(Arrays.asList(CLES_SUPP));
        return l.toArray(new String[0]);
    }

    /** Contenu JSON {type, expire_le, code} si le code est signé par une des clés pour cet appareil, sinon null. */
    public static String verifier(String code, String empreinte, String[] cles) {
        byte[] brut;
        try {
            brut = decoder(code);
        } catch (IllegalArgumentException e) {
            return null;
        }
        byte[] charge = Arrays.copyOf(brut, 6), sig = Arrays.copyOfRange(brut, 6, 70);
        int t = charge[0] & 15;
        if ((charge[0] & 0xF0) != 0x10 || t < 1 || t >= TYPES.length) {
            return null;
        }
        byte[] m = message(nettoyer(demande(empreinte)).substring(0, 15), charge);
        for (String cle : cles) {
            try {
                if (!Ed25519.verifier(Base64.getDecoder().decode(cle), m, sig)) {
                    continue;
                }
            } catch (IllegalArgumentException e) {
                continue;
            }
            int jours = ((charge[1] & 0xFF) << 8) | (charge[2] & 0xFF);
            int serie = ((charge[3] & 0xFF) << 16) | ((charge[4] & 0xFF) << 8) | (charge[5] & 0xFF);
            String expire = jours == 0 ? "null" : "\"" + ORIGINE.plusDays(jours) + "T23:59:59+00:00\"";
            return "{\"type\":\"" + TYPES[t] + "\",\"expire_le\":" + expire + ",\"code\":\""
                    + String.format("HL-%06d", serie) + "\"}";
        }
        return null;
    }

    /** Code de licence (groupé) pour une demande : utilisé par le générateur hors ligne du fournisseur. */
    public static String signer(byte[] graine, String demande, String type, int expireJour, int serie) {
        byte[] charge = chargeUtile(type, expireJour, serie);
        byte[] sig = Ed25519.signer(graine, message(demandeValide(demande), charge));
        byte[] tout = Arrays.copyOf(charge, 70);
        System.arraycopy(sig, 0, tout, 6, 64);
        return grouper(coder(tout));
    }

    // ------------------------------------------------------------------ code court (25 caractères)
    private static byte[] sha256(byte[]... parties) {
        try {
            MessageDigest d = MessageDigest.getInstance("SHA-256");
            for (byte[] p : parties) {
                d.update(p);
            }
            return d.digest();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] ascii(String s) {
        return s.getBytes(StandardCharsets.US_ASCII);
    }

    /** Secret n° {@code numero}, dérivé à sens unique de la clé maîtresse (générateur du fournisseur). */
    public static byte[] secretCourt(byte[] graine, int numero) {
        return sha256(ascii("AKWA-CODE25|" + numero + "|"), graine);
    }

    private static byte[] xor(byte[] a, byte[] b) {
        byte[] r = new byte[a.length];
        for (int i = 0; i < a.length; i++) {
            r[i] = (byte) (a[i] ^ b[i]);
        }
        return r;
    }

    /** « 1:base64,2:base64 » → secrets ; {@code masquees} : valeurs injectées dans l'application. */
    public static Map<Integer, byte[]> lireClesCourtes(String texte, boolean masquees) {
        Map<Integer, byte[]> cles = new TreeMap<>();
        for (String partie : (texte == null ? "" : texte).replace(';', ',').split(",")) {
            int p = partie.indexOf(':');
            try {
                int n = Integer.parseInt(partie.substring(0, Math.max(p, 0)).trim());
                byte[] b = Base64.getDecoder().decode(partie.substring(p + 1).trim());
                if (n >= 1 && n <= 7 && b.length == 32) {
                    cles.put(n, masquees ? xor(b, sha256(ascii("AKWA-AC|" + n))) : b);
                }
            } catch (IllegalArgumentException | StringIndexOutOfBoundsException e) {
                // partie illisible : ignorée
            }
        }
        return cles;
    }

    private static BigInteger sceau(byte[] secret, String demande15, int charge) {
        try {
            Mac m = Mac.getInstance("HmacSHA256");
            m.init(new SecretKeySpec(secret, "HmacSHA256"));
            m.update(ascii("AKWA-HL25|" + demande15));
            byte[] h = m.doFinal(new byte[]{(byte) (charge >> 16), (byte) (charge >> 8), (byte) charge});
            return new BigInteger(1, Arrays.copyOf(h, 14)).shiftRight(7);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Code court groupé 5-5-5-5-5 ; {@code jourEmission} : jours depuis le 1er janvier 2026. */
    public static String coderCourt(byte[] secret, int numero, String demande, String type, int jourEmission) {
        String d15 = demandeValide(demande);
        int t = Arrays.asList(TYPES).indexOf(type);
        if (numero < 1 || numero > 7 || t < 1 || jourEmission < 0 || jourEmission >= 1 << 14) {
            throw new IllegalArgumentException("licence hors ligne impossible");
        }
        int charge = numero << 17 | t << 14 | jourEmission;
        BigInteger v = BigInteger.valueOf(charge).shiftLeft(105).or(sceau(secret, d15, charge));
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < LONGUEUR_COURT; i++) {
            if (i > 0 && i % 5 == 0) {
                sb.append('-');
            }
            sb.append(ALPHABET.charAt(v.shiftRight(5 * (24 - i)).intValue() & 31));
        }
        return sb.toString();
    }

    /** Contenu JSON {type, expire_le, code} si le code court est scellé pour cet appareil, sinon null. */
    public static String verifierCourt(String code, String empreinte, Map<Integer, byte[]> cles) {
        String c = nettoyer(code);
        if (c.length() != LONGUEUR_COURT) {
            return null;
        }
        BigInteger v = BigInteger.ZERO;
        for (char x : c.toCharArray()) {
            v = v.shiftLeft(5).or(BigInteger.valueOf(ALPHABET.indexOf(x)));
        }
        int charge = v.shiftRight(105).intValue();
        BigInteger lu = v.subtract(BigInteger.valueOf(charge).shiftLeft(105));
        int numero = charge >> 17, t = (charge >> 14) & 7, jour = charge & 0x3FFF;
        byte[] secret = cles.get(numero);
        if (secret == null || t < 1 || t >= TYPES.length) {
            return null;
        }
        BigInteger attendu = sceau(secret, nettoyer(demande(empreinte)).substring(0, 15), charge);
        if (!MessageDigest.isEqual(octets14(attendu), octets14(lu))) {
            return null;
        }
        String expire = TYPES[t].endsWith("1an")
                ? "\"" + ORIGINE.plusDays(jour + 365L) + "T23:59:59+00:00\"" : "null";
        return "{\"type\":\"" + TYPES[t] + "\",\"expire_le\":" + expire + ",\"code\":\""
                + String.format("HC-%07d", lu.shiftRight(85).intValue()) + "\"}";
    }

    /** Numéro d'un code court (pour le registre du générateur), le même que celui que l'appareil affichera. */
    public static String serieCourt(String code) {
        BigInteger v = BigInteger.ZERO;
        for (char x : nettoyer(code).toCharArray()) {
            v = v.shiftLeft(5).or(BigInteger.valueOf(ALPHABET.indexOf(x)));
        }
        return String.format("HC-%07d", v.shiftRight(85).intValue() & 0xFFFFF);
    }

    private static byte[] octets14(BigInteger v) {
        byte[] b = v.toByteArray(), r = new byte[14];
        int n = Math.min(b.length, 14);
        System.arraycopy(b, b.length - n, r, 14 - n, n);
        return r;
    }

    /** Code hors ligne enregistré (court ou long) : contenu JSON s'il est valable pour cet appareil, sinon null. */
    public static String verifierEnregistre(String code, String empreinte, String clePublique) {
        return nettoyer(code).length() == LONGUEUR_COURT ? verifierCourt(code, empreinte, clesCourtes)
                : verifier(code, empreinte, cles(clePublique));
    }
}
