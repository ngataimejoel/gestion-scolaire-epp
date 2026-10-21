package com.akwaschool.codes;

import com.akwaschool.mobile.noyau.Ed25519;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Clé de signature du générateur, gardée chiffrée par un mot de passe (PBKDF2-SHA256 puis AES-256-GCM), comme le
 * générateur Windows (outils/generateur_hors_ligne.py). Java pur.
 */
public final class Cle {
    public static final int ITERATIONS = 300_000;
    private static final byte[] AAD = "akwa/cle-hors-ligne".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] PKCS8 = {0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
            0x22, 0x04, 0x20};

    /** Clé enregistrée : sel, nonce et graine chiffrée, en base64. */
    public static final class Scellee {
        public final String sel;
        public final String nonce;
        public final String chiffre;

        public Scellee(String sel, String nonce, String chiffre) {
            this.sel = sel;
            this.nonce = nonce;
            this.chiffre = chiffre;
        }
    }

    private Cle() {
    }

    /** Clé privée collée : PKCS8 en base64 (variable EPP_LICENCE_CLE_PRIVEE du service) ou graine de 32 octets. */
    public static byte[] graineDepuisTexte(String texte) {
        byte[] b;
        try {
            b = Base64.getDecoder().decode(texte.replaceAll("\\s", ""));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Clé illisible : collez la clé privée en base64.");
        }
        if (b.length == 48 && Arrays.equals(Arrays.copyOf(b, 16), PKCS8)) {
            return Arrays.copyOfRange(b, 16, 48);
        }
        if (b.length == 32) {
            return b;
        }
        throw new IllegalArgumentException("Ce n'est pas une clé privée Ed25519.");
    }

    public static String publique(byte[] graine) {
        return Base64.getEncoder().encodeToString(Ed25519.clePublique(graine));
    }

    private static byte[] cleMdp(String mdp, byte[] sel) throws GeneralSecurityException {
        PBEKeySpec spec = new PBEKeySpec(mdp.toCharArray(), sel, ITERATIONS, 256);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } finally {
            spec.clearPassword();
        }
    }

    public static Scellee sceller(byte[] graine, String mdp) throws GeneralSecurityException {
        if (mdp.length() < 8) {
            throw new IllegalArgumentException("Le mot de passe doit compter 8 caractères au moins.");
        }
        SecureRandom r = new SecureRandom();
        byte[] sel = new byte[16], nonce = new byte[12];
        r.nextBytes(sel);
        r.nextBytes(nonce);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(cleMdp(mdp, sel), "AES"), new GCMParameterSpec(128, nonce));
        c.updateAAD(AAD);
        Base64.Encoder e = Base64.getEncoder();
        return new Scellee(e.encodeToString(sel), e.encodeToString(nonce), e.encodeToString(c.doFinal(graine)));
    }

    /** Graine de la clé, ou GeneralSecurityException si le mot de passe est faux. */
    public static byte[] ouvrir(Scellee s, String mdp) throws GeneralSecurityException {
        Base64.Decoder d = Base64.getDecoder();
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cleMdp(mdp, d.decode(s.sel)), "AES"),
                new GCMParameterSpec(128, d.decode(s.nonce)));
        c.updateAAD(AAD);
        return c.doFinal(d.decode(s.chiffre));
    }
}
