package com.akwaschool.mobile.synchro;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.Locale;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Protocole de synchronisation avec l'application Windows (même algorithme que epp/synchro/protocole.py).
 *
 * <p>Association : clé K = PBKDF2-HMAC-SHA256(code, "AKWA-SCHOOL/appairage/" + sel, 150 000, 32 octets) ;
 * le téléphone n'envoie que le sel et la preuve HMAC-SHA256(K, "preuve") ; l'ordinateur renvoie la clé de
 * l'appareil chiffrée par K. Ensuite chaque message est chiffré et authentifié par AES-256-GCM
 * (nonce de 12 octets en tête).</p>
 *
 * <p>Java pur (aucune classe Android) : testé sur l'ordinateur contre le serveur Python.</p>
 */
public final class Protocole {
    public static final int VERSION = 1;
    public static final int PORT_HTTP = 8765;
    public static final int PORT_DECOUVERTE = 8766;
    public static final byte[] QUESTION_DECOUVERTE = "AKWA-SCHOOL?".getBytes(StandardCharsets.US_ASCII);
    public static final int ITERATIONS = 150_000;
    static final byte[] SEL_APPAIRAGE = "AKWA-SCHOOL/appairage/".getBytes(StandardCharsets.US_ASCII);
    static final byte[] AAD_APPAIRAGE = "akwa/appairage".getBytes(StandardCharsets.US_ASCII);

    private static final SecureRandom ALEA = new SecureRandom();

    private Protocole() {
    }

    public static byte[] aleatoire(int n) {
        byte[] b = new byte[n];
        ALEA.nextBytes(b);
        return b;
    }

    public static String b64(byte[] b) {
        return Base64.getEncoder().encodeToString(b);
    }

    public static byte[] unb64(String s) {
        return Base64.getDecoder().decode(s.trim());
    }

    /** « abcd-efgh » ou « ABCD EFGH » → « ABCDEFGH ». */
    public static String normaliserCode(String code) {
        StringBuilder sb = new StringBuilder();
        for (char c : (code == null ? "" : code).toUpperCase(Locale.ROOT).toCharArray()) {
            if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    public static byte[] pbkdf2(char[] secret, byte[] sel, int iterations) throws GeneralSecurityException {
        SecretKeyFactory f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        return f.generateSecret(new PBEKeySpec(secret, sel, iterations, 256)).getEncoded();
    }

    public static byte[] cleAppairage(String code, byte[] sel) throws GeneralSecurityException {
        byte[] s = new byte[SEL_APPAIRAGE.length + sel.length];
        System.arraycopy(SEL_APPAIRAGE, 0, s, 0, SEL_APPAIRAGE.length);
        System.arraycopy(sel, 0, s, SEL_APPAIRAGE.length, sel.length);
        return pbkdf2(normaliserCode(code).toCharArray(), s, ITERATIONS);
    }

    public static byte[] hmac(byte[] cle, byte[] donnees) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(cle, "HmacSHA256"));
        return mac.doFinal(donnees);
    }

    public static byte[] preuve(byte[] cle) throws GeneralSecurityException {
        return hmac(cle, "preuve".getBytes(StandardCharsets.US_ASCII));
    }

    public static boolean egaux(byte[] a, byte[] b) {
        return MessageDigest.isEqual(a, b);
    }

    /** nonce (12 octets) + texte chiffré + étiquette d'authentification (16 octets). */
    public static byte[] sceller(byte[] cle, byte[] donnees, byte[] aad) throws GeneralSecurityException {
        byte[] nonce = aleatoire(12);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(cle, "AES"), new GCMParameterSpec(128, nonce));
        c.updateAAD(aad);
        byte[] chiffre = c.doFinal(donnees);
        byte[] out = new byte[12 + chiffre.length];
        System.arraycopy(nonce, 0, out, 0, 12);
        System.arraycopy(chiffre, 0, out, 12, chiffre.length);
        return out;
    }

    public static byte[] ouvrir(byte[] cle, byte[] message, byte[] aad) throws GeneralSecurityException {
        if (message.length < 12 + 16) {
            throw new GeneralSecurityException("message trop court");
        }
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cle, "AES"),
                new GCMParameterSpec(128, Arrays.copyOfRange(message, 0, 12)));
        c.updateAAD(aad);
        return c.doFinal(message, 12, message.length - 12);
    }

    public static byte[] aadRequete(long appareilId) {
        return ("akwa/requete/" + appareilId).getBytes(StandardCharsets.US_ASCII);
    }

    public static byte[] aadReponse(long appareilId, long seq) {
        return ("akwa/reponse/" + appareilId + "/" + seq).getBytes(StandardCharsets.US_ASCII);
    }

    /** Chaîne JSON entre guillemets (échappement minimal mais complet). */
    public static String jsonTexte(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : (s == null ? "" : s).toCharArray()) {
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append('"').toString();
    }

    /** Valeur d'un champ texte simple d'un objet JSON produit par le serveur (base64, identifiants). */
    public static String champTexte(String json, String nom) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"" + java.util.regex.Pattern.quote(nom) + "\"\\s*:\\s*\"([^\"\\\\]*)\"").matcher(json);
        return m.find() ? m.group(1) : null;
    }

    /** Valeur d'un champ entier d'un objet JSON produit par le serveur. */
    public static Long champEntier(String json, String nom) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"" + java.util.regex.Pattern.quote(nom) + "\"\\s*:\\s*(-?\\d+)").matcher(json);
        return m.find() ? Long.valueOf(m.group(1)) : null;
    }
}
