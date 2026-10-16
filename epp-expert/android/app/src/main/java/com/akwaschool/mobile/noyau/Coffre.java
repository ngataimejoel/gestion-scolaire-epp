package com.akwaschool.mobile.noyau;

import com.akwaschool.mobile.synchro.Protocole;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Arrays;

/**
 * Sauvegarde chiffrée des données du téléphone (fichier .akwa) : AES-256-GCM, clé tirée du mot de passe
 * administrateur par PBKDF2-HMAC-SHA256 (150 000 itérations, sel aléatoire). Le fichier peut être envoyé par
 * WhatsApp ou copié sur une clé : sans le mot de passe, il est illisible et toute modification est détectée.
 * Format : « AKWA1 » + sel (16 octets) + nonce (12 octets) + texte chiffré. Java pur.
 */
public final class Coffre {
    static final byte[] MAGIQUE = "AKWA1".getBytes(StandardCharsets.US_ASCII);
    static final byte[] AAD = "akwa/sauvegarde".getBytes(StandardCharsets.US_ASCII);

    private Coffre() {
    }

    public static byte[] sceller(String motDePasse, byte[] donnees) throws GeneralSecurityException {
        byte[] sel = Protocole.aleatoire(16);
        byte[] cle = Protocole.pbkdf2(motDePasse.toCharArray(), sel, Protocole.ITERATIONS);
        byte[] c = Protocole.sceller(cle, donnees, AAD);
        byte[] out = new byte[MAGIQUE.length + sel.length + c.length];
        System.arraycopy(MAGIQUE, 0, out, 0, MAGIQUE.length);
        System.arraycopy(sel, 0, out, MAGIQUE.length, sel.length);
        System.arraycopy(c, 0, out, MAGIQUE.length + sel.length, c.length);
        return out;
    }

    public static boolean estUneSauvegarde(byte[] f) {
        return f != null && f.length > MAGIQUE.length + 16 + 28
                && Arrays.equals(Arrays.copyOf(f, MAGIQUE.length), MAGIQUE);
    }

    /** Contenu déchiffré ; GeneralSecurityException si le mot de passe est faux ou le fichier modifié. */
    public static byte[] ouvrir(String motDePasse, byte[] f) throws GeneralSecurityException {
        if (!estUneSauvegarde(f)) {
            throw new GeneralSecurityException("Ce fichier n'est pas une sauvegarde AKWA SCHOOL.");
        }
        byte[] sel = Arrays.copyOfRange(f, MAGIQUE.length, MAGIQUE.length + 16);
        byte[] cle = Protocole.pbkdf2(motDePasse.toCharArray(), sel, Protocole.ITERATIONS);
        return Protocole.ouvrir(cle, Arrays.copyOfRange(f, MAGIQUE.length + 16, f.length), AAD);
    }
}
