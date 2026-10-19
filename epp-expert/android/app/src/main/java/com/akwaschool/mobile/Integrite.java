package com.akwaschool.mobile;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import java.security.MessageDigest;

/**
 * Vérifie que l'application est bien celle signée par N'GATTA : une copie modifiée puis signée avec une autre clé
 * (reprise du code, revente) refuse de s'ouvrir. La version de mise au point (débogable) n'est pas contrôlée.
 */
final class Integrite {
    /** Empreinte SHA-256 du certificat de la clé de publication AKWA SCHOOL (clé privée, hors du dépôt). */
    static final String EMPREINTE = "1DFAAB8680BD9AEE36502C4A555B5B6E7C9D0CAC569B02AFC6AD04E55187D02F";

    private Integrite() {}

    static boolean conforme(Context c) {
        if ((c.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) return true;
        try {
            for (Signature s : certificats(c)) {
                if (EMPREINTE.equals(hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())))) return true;
            }
        } catch (Exception e) {
            return false;
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    private static Signature[] certificats(Context c) throws PackageManager.NameNotFoundException {
        PackageManager pm = c.getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageInfo p = pm.getPackageInfo(c.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
            return p.signingInfo.hasMultipleSigners()
                    ? p.signingInfo.getApkContentsSigners() : p.signingInfo.getSigningCertificateHistory();
        }
        return pm.getPackageInfo(c.getPackageName(), PackageManager.GET_SIGNATURES).signatures;
    }

    private static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02X", x));
        return s.toString();
    }
}
