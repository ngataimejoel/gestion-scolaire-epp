package com.akwaschool.mobile.synchro;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;

/**
 * Synchronisation par fichier (téléphone hors du Wi-Fi de l'école), même format que epp/synchro/fichier.py :
 * le téléphone crée une demande (.akwasync) envoyée par WhatsApp ou e-mail, l'ordinateur l'importe et répond
 * par un fichier que le téléphone ouvre. Seule l'enveloppe JSON est lisible ; le contenu est chiffré et
 * authentifié avec la clé de l'appareil et le même compteur anti-rejeu que le Wi-Fi.
 */
public final class FichierSynchro {
    public static final String FORMAT = "AKWA-SCHOOL/synchro";
    public static final String EXTENSION = ".akwasync";

    private FichierSynchro() {
    }

    /** Fichier de demande (texte JSON) pour la requête donnée (même contenu qu'une synchronisation Wi-Fi). */
    public static String demande(long appareilId, String serveurId, byte[] cle, long seq, String requete,
                                 String appareil, String creeLe) throws GeneralSecurityException, Client.Erreur {
        String json = Client.avecSeq(requete, seq);
        byte[] msg = Protocole.sceller(cle, json.getBytes(StandardCharsets.UTF_8), Protocole.aadRequete(appareilId));
        return "{\"format\":" + Protocole.jsonTexte(FORMAT) + ",\"v\":1,\"sens\":\"demande\",\"serveur_id\":"
                + Protocole.jsonTexte(serveurId) + ",\"appareil_id\":" + appareilId + ",\"seq\":" + seq
                + ",\"cree_le\":" + Protocole.jsonTexte(creeLe) + ",\"appareil\":" + Protocole.jsonTexte(appareil)
                + ",\"message\":" + Protocole.jsonTexte(Protocole.b64(msg)) + "}";
    }

    /** Réponse de l'ordinateur ouverte sur le téléphone. */
    public static final class Reponse {
        public final long seq;
        /** Réponse déchiffrée (même JSON qu'une synchronisation Wi-Fi). */
        public final String json;

        Reponse(long seq, String json) {
            this.seq = seq;
            this.json = json;
        }
    }

    /**
     * Ouvre un fichier de réponse. Refuse un fichier d'un autre format, destiné à un autre téléphone ou à un
     * autre ordinateur, déjà ouvert (numéro &lt;= dejaRecu) ou modifié.
     */
    public static Reponse ouvrirReponse(byte[] fichier, long appareilId, String serveurId, byte[] cle, long dejaRecu)
            throws Client.Erreur {
        String t = new String(fichier, StandardCharsets.UTF_8).trim();
        if (t.startsWith("﻿")) {
            t = t.substring(1);
        }
        if (!t.startsWith("{") || !FORMAT.equals(Protocole.champTexte(t, "format"))) {
            throw new Client.Erreur(0, "Ce fichier n'est pas un fichier de synchronisation AKWA SCHOOL (.akwasync).", null);
        }
        if ("demande".equals(Protocole.champTexte(t, "sens"))) {
            throw new Client.Erreur(0, "Ce fichier est la demande créée par le téléphone : envoyez-la à l'ordinateur "
                    + "de l'école, puis ouvrez ici le fichier de réponse qu'il produit.", null);
        }
        Long aid = Protocole.champEntier(t, "appareil_id"), seq = Protocole.champEntier(t, "seq");
        String sid = Protocole.champTexte(t, "serveur_id");
        if (!"reponse".equals(Protocole.champTexte(t, "sens")) || aid == null || seq == null) {
            throw new Client.Erreur(0, "Fichier de synchronisation incomplet.", null);
        }
        if (aid != appareilId || (sid != null && serveurId != null && !serveurId.isEmpty() && !sid.equals(serveurId))) {
            throw new Client.Erreur(0, "Ce fichier de réponse est destiné à un autre téléphone.", null);
        }
        if (t.contains("\"erreur\"") && Protocole.champTexte(t, "message") == null) {
            String code = Protocole.champTexte(t, "code");
            throw new Client.Erreur(0, "REJEU".equals(code)
                    ? "L'ordinateur avait déjà reçu cette demande, ou une plus récente : les saisies sont déjà envoyées. "
                      + "Si des saisies restent en attente, créez un nouveau fichier."
                    : "L'ordinateur a refusé la demande : " + messageErreur(t), t);
        }
        if (seq <= dejaRecu) {
            throw new Client.Erreur(0, "Cette réponse est plus ancienne que les données déjà reçues : elle est ignorée.", null);
        }
        String msg = Protocole.champTexte(t, "message");
        if (msg == null) {
            throw new Client.Erreur(0, "Fichier de synchronisation incomplet.", null);
        }
        try {
            byte[] clair = Protocole.ouvrir(cle, Protocole.unb64(msg), Protocole.aadReponse(appareilId, seq));
            return new Reponse(seq, new String(clair, StandardCharsets.UTF_8));
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new Client.Erreur(0, "Fichier de réponse modifié ou illisible.", null);
        }
    }

    /** Message d'erreur de l'enveloppe (accents et guillemets échappés compris). */
    private static String messageErreur(String t) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"erreur\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(t);
        if (!m.find()) {
            return "erreur inconnue.";
        }
        String s = m.group(1);
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && i + 1 < s.length()) {
                char e = s.charAt(++i);
                if (e == 'u' && i + 4 < s.length()) {
                    b.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16));
                    i += 4;
                } else {
                    b.append(e == 'n' ? '\n' : e);
                }
            } else {
                b.append(c);
            }
        }
        return b.toString();
    }
}
