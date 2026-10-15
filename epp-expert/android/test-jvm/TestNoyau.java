import com.akwaschool.mobile.noyau.Coffre;
import com.akwaschool.mobile.noyau.Ed25519;
import com.akwaschool.mobile.noyau.Licence;
import com.akwaschool.mobile.noyau.Tableur;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.GeneralSecurityException;
import java.util.List;

/**
 * Noyau Java du téléphone (sans Android) : signatures Ed25519 (RFC 8032 et licences signées par Python),
 * état de la licence, sauvegarde chiffrée, lecture des tableaux (.xls, .xlsx, .csv). Les lignes lues sont
 * écrites à côté des fichiers pour être comparées à la lecture Python (outils/fixtures_noyau.py verifier).
 */
public final class TestNoyau {
    private static int echecs = 0;

    private static void verifie(boolean ok, String quoi) {
        System.out.println((ok ? "ok    " : "ÉCHEC ") + quoi);
        if (!ok) {
            echecs++;
        }
    }

    private static byte[] hex(String h) {
        byte[] b = new byte[h.length() / 2];
        for (int i = 0; i < b.length; i++) {
            b[i] = (byte) Integer.parseInt(h.substring(2 * i, 2 * i + 2), 16);
        }
        return b;
    }

    private static String statut(String json) {
        return json.replaceAll(".*\"statut\":\"([a-z_]+)\".*", "$1");
    }

    public static void main(String[] args) throws Exception {
        Path dossier = Paths.get(args[0]);

        // ------------------------------------------------------------ Ed25519 : vecteurs de la RFC 8032
        byte[] pk1 = hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
        byte[] sg1 = hex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
        verifie(Ed25519.verifier(pk1, new byte[0], sg1), "RFC 8032 test 1");
        byte[] pk2 = hex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c");
        byte[] sg2 = hex("92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00");
        verifie(Ed25519.verifier(pk2, hex("72"), sg2), "RFC 8032 test 2");
        verifie(!Ed25519.verifier(pk2, hex("73"), sg2), "message modifié refusé");
        sg2[63] ^= 1;
        verifie(!Ed25519.verifier(pk2, hex("72"), sg2), "signature modifiée refusée");

        // ------------------------------------------------------------ licences signées par Python
        List<String> l = Files.readAllLines(dossier.resolve("licence.txt"), StandardCharsets.UTF_8);
        String pub = l.get(0), machine = l.get(1);
        long maintenant = Long.parseLong(l.get(2));
        long jour = 86_400_000L;
        verifie(machine.equals(Licence.empreinte("identifiant-android-test")), "empreinte du téléphone identique à Python");
        verifie(Licence.verifier(l.get(3), l.get(4), pub, machine) != null, "licence 1 an authentique");
        verifie(Licence.verifier(l.get(9), l.get(10), pub, machine) == null, "licence d'un autre appareil refusée");
        verifie(Licence.verifier(l.get(11), l.get(12), pub, machine) == null, "licence falsifiée refusée");
        verifie(Licence.verifier(l.get(3), l.get(4), Licence.CLE_PUBLIQUE, machine) == null, "autre clé publique refusée");
        String e1 = Licence.etat(l.get(3), l.get(4), pub, machine, 0, 0, maintenant);
        verifie(statut(e1).equals("active") && e1.contains("\"jours_restants\":365") && e1.contains("15/10/2027"),
                "licence 1 an active : " + e1);
        verifie(statut(Licence.etat(l.get(5), l.get(6), pub, machine, 0, 0, maintenant)).equals("active"), "licence à vie");
        verifie(statut(Licence.etat(l.get(7), l.get(8), pub, machine, 0, 0, maintenant)).equals("expiree"), "licence échue");
        String essai = Licence.etat(null, null, pub, machine, maintenant - 2 * jour, maintenant, maintenant);
        verifie(statut(essai).equals("essai") && essai.contains("\"jours_restants\":5"), "essai : 5 jours restants");
        verifie(statut(Licence.etat(null, null, pub, machine, maintenant - 7 * jour, maintenant, maintenant))
                .equals("essai_termine"), "essai terminé au 7e jour");
        verifie(statut(Licence.etat(l.get(5), l.get(6), pub, machine, 0, maintenant + 3 * jour, maintenant))
                .equals("horloge"), "horloge reculée refusée");

        // ------------------------------------------------------------ sauvegarde chiffrée
        byte[] donnees = "{\"ecole\":\"EPP « ESSAI »\"}".getBytes(StandardCharsets.UTF_8);
        byte[] f = Coffre.sceller("Admin!2026", donnees);
        verifie(Coffre.estUneSauvegarde(f) && new String(Coffre.ouvrir("Admin!2026", f), StandardCharsets.UTF_8)
                .equals("{\"ecole\":\"EPP « ESSAI »\"}"), "sauvegarde chiffrée relue");
        boolean refuse = false;
        try {
            Coffre.ouvrir("mauvais", f);
        } catch (GeneralSecurityException e) {
            refuse = true;
        }
        verifie(refuse, "sauvegarde : mauvais mot de passe refusé");
        verifie(!Coffre.estUneSauvegarde(donnees), "fichier ordinaire non pris pour une sauvegarde");

        // ------------------------------------------------------------ tableaux
        for (String nom : new String[]{"essai.xlsx", "essai_utf8.csv", "essai_cp1252.csv", "eleves_essai.xls"}) {
            List<List<String>> lignes = Tableur.lire(Files.readAllBytes(dossier.resolve(nom)));
            Files.write(dossier.resolve(nom + ".java.json"), Tableur.json(lignes).getBytes(StandardCharsets.UTF_8));
            verifie(!lignes.isEmpty(), nom + " : " + lignes.size() + " lignes lues");
        }
        boolean illisible = false;
        try {
            Tableur.lire(hex("d0cf11e0a1b11ae1"));
        } catch (Tableur.Illisible e) {
            illisible = true;
        }
        verifie(illisible, ".xls tronqué : message d'erreur");

        if (echecs > 0) {
            System.out.println(echecs + " échec(s)");
            System.exit(1);
        }
        System.out.println("noyau du téléphone : tout est correct");
    }
}
