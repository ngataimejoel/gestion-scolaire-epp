import com.akwaschool.mobile.noyau.Classeur;
import com.akwaschool.mobile.noyau.Coffre;
import com.akwaschool.mobile.noyau.Comptes;
import com.akwaschool.mobile.noyau.Ed25519;
import com.akwaschool.mobile.noyau.HorsLigne;
import com.akwaschool.mobile.noyau.Licence;
import com.akwaschool.mobile.noyau.Tableur;
import com.akwaschool.mobile.synchro.FichierSynchro;
import com.akwaschool.mobile.synchro.Protocole;

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

    interface Action {
        void faire() throws Exception;
    }

    private static String refus(Action a) {
        try {
            a.faire();
            return "";
        } catch (Exception e) {
            return String.valueOf(e.getMessage());
        }
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

        // ------------------------------------------------------------ signature (générateur hors ligne) : RFC 8032
        byte[] graine1 = hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
        verifie(java.util.Arrays.equals(Ed25519.clePublique(graine1), pk1), "RFC 8032 test 1 : clé publique");
        verifie(java.util.Arrays.equals(Ed25519.signer(graine1, new byte[0]), sg1), "RFC 8032 test 1 : signature");

        // ------------------------------------------------------------ activation sans Internet
        List<String> h = Files.readAllLines(dossier.resolve("hors_ligne.txt"), StandardCharsets.UTF_8);
        String hp = h.get(0), hm = h.get(1);
        long hn = Long.parseLong(h.get(2));
        verifie(HorsLigne.demande(hm).equals(h.get(3)), "code de demande identique à Python : " + h.get(3));
        String a1 = Licence.etat(Licence.PREFIXE_HL + h.get(5), "hl", hp, hm, 0, 0, hn);
        verifie(statut(a1).equals("active") && a1.contains("\"type\":\"1an\"") && a1.contains("15/10/2027"),
                "code hors ligne 1 an signé par Python : " + a1);
        String a2 = HorsLigne.verifier(h.get(6).toLowerCase().replace("-", " "), hm, HorsLigne.cles(hp));
        verifie(a2 != null && a2.contains("\"ensvie\"") && a2.contains("\"expire_le\":null") && a2.contains("HL-000007"),
                "code hors ligne enseignant à vie : " + a2);
        verifie(Licence.verifier(Licence.PREFIXE_HL + h.get(7), "hl", hp, hm) == null, "code d'un autre appareil refusé");
        verifie(Licence.verifier(Licence.PREFIXE_HL + h.get(5), "hl", Licence.CLE_PUBLIQUE, hm) == null,
                "code signé par une clé inconnue refusé");
        String hAbime = h.get(5).substring(0, 20) + (h.get(5).charAt(20) == '2' ? '3' : '2') + h.get(5).substring(21);
        verifie(HorsLigne.verifier(hAbime, hm, HorsLigne.cles(hp)) == null, "code hors ligne modifié refusé");
        byte[] hg = hex(h.get(4));
        verifie(Ed25519.clePublique(hg).length == 32 && java.util.Base64.getEncoder().encodeToString(Ed25519.clePublique(hg))
                .equals(hp), "clé publique du générateur identique à Python");
        String parJava = HorsLigne.signer(hg, h.get(3), "vie", 0, 123456);
        verifie(HorsLigne.verifier(parJava, hm, HorsLigne.cles(hp)) != null, "code signé par le générateur Android");
        Files.write(dossier.resolve("hors_ligne.java.txt"), parJava.getBytes(StandardCharsets.UTF_8));
        HorsLigne.clesCourtes = HorsLigne.lireClesCourtes(h.get(8), true);
        verifie(java.util.Arrays.equals(HorsLigne.clesCourtes.get(1), HorsLigne.secretCourt(hg, 1)),
                "secret des codes courts : démasqué comme en Python");
        String c1 = Licence.etat(Licence.PREFIXE_HL + HorsLigne.nettoyer(h.get(9)), "hl", hp, hm, 0, 0, hn);
        verifie(statut(c1).equals("active") && c1.contains("\"type\":\"1an\"") && c1.contains("15/10/2027"),
                "code court 1 an fait par Python : " + h.get(9) + " → " + c1);
        verifie(Licence.verifier(Licence.PREFIXE_HL + h.get(10), "hl", hp, hm) == null, "code court d'un autre appareil refusé");
        String c9 = h.get(9), cAbime = c9.substring(0, 7) + (c9.charAt(7) == '2' ? '3' : '2') + c9.substring(8);
        verifie(HorsLigne.verifierCourt(cAbime, hm, HorsLigne.clesCourtes) == null, "code court modifié refusé");
        verifie(HorsLigne.verifierCourt(h.get(9), hm, HorsLigne.lireClesCourtes("2:" + h.get(8).substring(2), true)) == null,
                "code court d'un numéro de clé retiré refusé");
        String court = HorsLigne.coderCourt(HorsLigne.secretCourt(hg, 1), 1, h.get(3), "ensvie", 300);
        verifie(court.length() == 29 && HorsLigne.estCode(court.toLowerCase()), "code court du générateur Android : " + court);
        Files.write(dossier.resolve("hors_ligne_court.java.txt"), court.getBytes(StandardCharsets.UTF_8));

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

        // ------------------------------------------------------------ classeur Excel (présentation du .exe)
        String spec = new String(Files.readAllBytes(dossier.resolve("classeur.json")), StandardCharsets.UTF_8);
        byte[] xlsx = Classeur.depuisJson(spec);
        Files.write(dossier.resolve("classeur.xlsx"), xlsx);
        List<List<String>> relu = Tableur.lire(xlsx);
        verifie(relu.size() == 3 && relu.get(0).get(0).equals("codedren") && relu.get(1).get(5).equals("00012345A"),
                "classeur Excel relu par le téléphone (" + relu.size() + " lignes)");

        // ------------------------------------------------------------ synchronisation par fichier
        List<String> sy = Files.readAllLines(dossier.resolve("synchro.txt"), StandardCharsets.UTF_8);
        byte[] cleSync = Protocole.unb64(sy.get(0));
        long aid = Long.parseLong(sy.get(1));
        String sid = sy.get(2);
        byte[] rep = Files.readAllBytes(dossier.resolve("reponse.akwasync"));
        FichierSynchro.Reponse r = FichierSynchro.ouvrirReponse(rep, aid, sid, cleSync, 6);
        Files.write(dossier.resolve("reponse.java.json"), r.json.getBytes(StandardCharsets.UTF_8));
        verifie(r.seq == 7 && r.json.contains("\"instantane\""), "réponse de l'ordinateur ouverte");
        verifie(refus(() -> FichierSynchro.ouvrirReponse(rep, aid, sid, cleSync, 7)).contains("plus ancienne"),
                "réponse déjà reçue ignorée");
        verifie(refus(() -> FichierSynchro.ouvrirReponse(rep, aid + 1, sid, cleSync, 0)).contains("autre téléphone"),
                "réponse d'un autre téléphone refusée");
        byte[] abime = new String(rep, StandardCharsets.UTF_8).replace("\"seq\": 7", "\"seq\": 8")
                .getBytes(StandardCharsets.UTF_8);
        verifie(refus(() -> FichierSynchro.ouvrirReponse(abime, aid, sid, cleSync, 0)).contains("modifié"),
                "réponse modifiée refusée");
        byte[] rejeu = Files.readAllBytes(dossier.resolve("reponse_rejeu.akwasync"));
        verifie(refus(() -> FichierSynchro.ouvrirReponse(rejeu, aid, sid, cleSync, 0)).contains("déjà reçu"),
                "refus de l'ordinateur expliqué");
        String dem = FichierSynchro.demande(aid, sid, cleSync, 8, "{\"ops\":[{\"uid\":\"t1\",\"op\":\"note\",\"valeur\":7.5}]}",
                "TECNO « Spark »", "2026-10-16T08:00:00");
        Files.write(dossier.resolve("demande.akwasync"), dem.getBytes(StandardCharsets.UTF_8));
        verifie(refus(() -> FichierSynchro.ouvrirReponse(dem.getBytes(StandardCharsets.UTF_8), aid, sid, cleSync, 0))
                .contains("demande"), "demande prise pour une réponse : expliqué");

        // comptes des enseignants du téléphone
        Comptes cp = new Comptes(null, 1000);
        String prov = cp.creer("t3", " AKouassi ");
        verifie(prov.matches("Prov-[2-9A-Z]{6}"), "compte créé : mot de passe provisoire");
        verifie(cp.verifier("akouassi", prov) != null && cp.verifier("akouassi", prov).provisoire(), "connexion provisoire");
        verifie(cp.verifier("akouassi", "faux") == null, "mauvais mot de passe refusé");
        verifie(refus(() -> cp.creer("t4", "akouassi")).contains("déjà"), "identifiant en double refusé");
        verifie(refus(() -> cp.creer("t3", "autre")).contains("déjà un compte"), "deuxième compte du même enseignant refusé");
        verifie(refus(() -> cp.creer("t5", "admin")).contains("invalide"), "identifiant admin réservé");
        String sec = cp.definir("akouassi", "monmotdepasse");
        Comptes cr = new Comptes(cp.texte(), 1000);
        verifie(cr.verifier("akouassi", "monmotdepasse") != null && !cr.verifier("akouassi", "monmotdepasse").provisoire(),
                "mot de passe personnel gardé après relecture");
        verifie(refus(() -> cr.recuperer("akouassi", "AAAA-BBBB-CCCC", "nouveau123")).contains("incorrect"), "mauvais code de secours refusé");
        String sec2 = cr.recuperer("akouassi", sec.toLowerCase(), "nouveau123");
        verifie(cr.verifier("akouassi", "nouveau123") != null && !sec2.equals(sec), "mot de passe oublié : code de secours, puis nouveau code");
        verifie(refus(() -> cr.recuperer("akouassi", sec, "x123456")).contains("incorrect"), "code de secours à usage unique");
        String prov2 = cr.reinitialiser("t3");
        verifie(cr.verifier("akouassi", prov2).provisoire() && cr.verifier("akouassi", "nouveau123") == null, "réinitialisation par le directeur");
        cr.supprimer("t3");
        verifie(cr.tous().isEmpty(), "compte supprimé");

        if (echecs > 0) {
            System.out.println(echecs + " échec(s)");
            System.exit(1);
        }
        System.out.println("noyau du téléphone : tout est correct");
    }
}
