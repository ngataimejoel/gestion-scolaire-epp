package com.akwaschool.mobile.noyau;

import java.math.BigInteger;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Vérification de signatures Ed25519 (RFC 8032), en Java pur : Android ne la propose qu'à partir de la
 * version 13 et l'application fonctionne dès Android 8. Seule la vérification est utile (licences signées par
 * le service d'activation) ; elle n'a pas besoin d'être en temps constant (aucun secret n'est manipulé).
 */
public final class Ed25519 {
    private static final BigInteger P = BigInteger.ONE.shiftLeft(255).subtract(BigInteger.valueOf(19));
    private static final BigInteger L = BigInteger.ONE.shiftLeft(252)
            .add(new BigInteger("27742317777372353535851937790883648493"));
    private static final BigInteger D = BigInteger.valueOf(-121665)
            .multiply(BigInteger.valueOf(121666).modInverse(P)).mod(P);
    private static final BigInteger D2 = D.shiftLeft(1).mod(P);
    private static final BigInteger RACINE_MOINS_UN = BigInteger.valueOf(2)
            .modPow(P.subtract(BigInteger.ONE).shiftRight(2), P);
    private static final BigInteger[] B;

    static {
        BigInteger y = BigInteger.valueOf(4).multiply(BigInteger.valueOf(5).modInverse(P)).mod(P);
        BigInteger x = abscisse(y, 0);
        B = new BigInteger[]{x, y, BigInteger.ONE, x.multiply(y).mod(P)};
    }

    private Ed25519() {
    }

    /** Coordonnée x du point d'ordonnée y (bit de signe donné), ou null si y n'est pas sur la courbe. */
    private static BigInteger abscisse(BigInteger y, int signe) {
        if (y.compareTo(P) >= 0) {
            return null;
        }
        BigInteger y2 = y.multiply(y);
        BigInteger x2 = y2.subtract(BigInteger.ONE).multiply(D.multiply(y2).add(BigInteger.ONE).modInverse(P)).mod(P);
        if (x2.signum() == 0) {
            return signe == 1 ? null : BigInteger.ZERO;
        }
        BigInteger x = x2.modPow(P.add(BigInteger.valueOf(3)).shiftRight(3), P);
        if (x.multiply(x).subtract(x2).mod(P).signum() != 0) {
            x = x.multiply(RACINE_MOINS_UN).mod(P);
        }
        if (x.multiply(x).subtract(x2).mod(P).signum() != 0) {
            return null;
        }
        if (x.testBit(0) != (signe == 1)) {
            x = P.subtract(x);
        }
        return x;
    }

    /** Coordonnées étendues (X, Y, Z, T). */
    private static BigInteger[] ajouter(BigInteger[] p, BigInteger[] q) {
        BigInteger a = p[1].subtract(p[0]).multiply(q[1].subtract(q[0])).mod(P);
        BigInteger b = p[1].add(p[0]).multiply(q[1].add(q[0])).mod(P);
        BigInteger c = p[3].multiply(D2).multiply(q[3]).mod(P);
        BigInteger d = p[2].shiftLeft(1).multiply(q[2]).mod(P);
        BigInteger e = b.subtract(a), f = d.subtract(c), g = d.add(c), h = b.add(a);
        return new BigInteger[]{e.multiply(f).mod(P), g.multiply(h).mod(P), f.multiply(g).mod(P), e.multiply(h).mod(P)};
    }

    private static BigInteger[] multiplier(BigInteger s, BigInteger[] p) {
        BigInteger[] r = {BigInteger.ZERO, BigInteger.ONE, BigInteger.ONE, BigInteger.ZERO};
        for (int i = s.bitLength() - 1; i >= 0; i--) {
            r = ajouter(r, r);
            if (s.testBit(i)) {
                r = ajouter(r, p);
            }
        }
        return r;
    }

    private static boolean egaux(BigInteger[] p, BigInteger[] q) {
        return p[0].multiply(q[2]).subtract(q[0].multiply(p[2])).mod(P).signum() == 0
                && p[1].multiply(q[2]).subtract(q[1].multiply(p[2])).mod(P).signum() == 0;
    }

    private static BigInteger petitBoutiste(byte[] b, int debut, int n) {
        byte[] g = new byte[n + 1];                     // octet de tête nul : nombre positif
        for (int i = 0; i < n; i++) {
            g[n - i] = b[debut + i];
        }
        return new BigInteger(g);
    }

    private static BigInteger[] point(byte[] b, int debut) {
        byte[] c = new byte[32];
        System.arraycopy(b, debut, c, 0, 32);
        int signe = (c[31] >> 7) & 1;
        c[31] &= 0x7F;
        BigInteger y = petitBoutiste(c, 0, 32);
        BigInteger x = abscisse(y, signe);
        return x == null ? null : new BigInteger[]{x, y, BigInteger.ONE, x.multiply(y).mod(P)};
    }

    /** Vrai si la signature (64 octets) du message est valable pour la clé publique (32 octets). */
    public static boolean verifier(byte[] clePublique, byte[] message, byte[] signature) {
        if (clePublique == null || signature == null || clePublique.length != 32 || signature.length != 64) {
            return false;
        }
        BigInteger[] a = point(clePublique, 0);
        BigInteger[] r = point(signature, 0);
        if (a == null || r == null) {
            return false;
        }
        BigInteger s = petitBoutiste(signature, 32, 32);
        if (s.compareTo(L) >= 0) {
            return false;
        }
        byte[] h;
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-512");
            md.update(signature, 0, 32);
            md.update(clePublique);
            md.update(message);
            h = md.digest();
        } catch (NoSuchAlgorithmException e) {
            return false;
        }
        BigInteger k = petitBoutiste(h, 0, 64).mod(L);
        return egaux(multiplier(s, B), ajouter(r, multiplier(k, a)));
    }
}
