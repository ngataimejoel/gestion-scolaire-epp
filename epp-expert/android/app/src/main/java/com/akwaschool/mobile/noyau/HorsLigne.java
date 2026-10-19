package com.akwaschool.mobile.noyau;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;

/**
 * Activation sans Internet (zones sans réseau), mêmes règles que epp/core/hors_ligne.py : le téléphone affiche un
 * code de demande (16 caractères) ; le générateur du fournisseur renvoie un code de licence signé (Ed25519) pour
 * ce téléphone seulement (112 caractères), vérifié ici sans connexion.
 */
public final class HorsLigne {
    public static final String ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    public static final String[] TYPES = {"", "1an", "vie", "ens1an", "ensvie"};
    public static final LocalDate ORIGINE = LocalDate.of(2026, 1, 1);
    public static final int LONGUEUR_CODE = 112;
    /** Clés publiques supplémentaires (générateur hors ligne doté de sa propre clé), en plus de celle du service. */
    public static final String[] CLES_SUPP = {};

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
        return nettoyer(texte).length() >= 100;
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
}
