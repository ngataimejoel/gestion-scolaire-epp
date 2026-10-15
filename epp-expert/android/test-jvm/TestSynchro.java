import com.akwaschool.mobile.synchro.Client;
import com.akwaschool.mobile.synchro.Decouverte;
import com.akwaschool.mobile.synchro.Protocole;

import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.List;

/**
 * Le client Java du téléphone contre le vrai serveur Python (outils/serveur_synchro_test.py) :
 * découverte, association, synchronisation chiffrée, saisie d'une note, rejeu refusé.
 *
 *   javac -d build app/src/main/java/com/akwaschool/mobile/synchro/*.java test-jvm/TestSynchro.java
 *   java -cp build TestSynchro info.json
 */
public class TestSynchro {
    static int echecs = 0;

    static void verifier(boolean ok, String quoi) {
        System.out.println((ok ? "[OK] " : "[ÉCHEC] ") + quoi);
        if (!ok) {
            echecs++;
        }
    }

    public static void main(String[] args) throws Exception {
        String info = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);
        long port = Protocole.champEntier(info, "port");
        long portUdp = Protocole.champEntier(info, "port_decouverte");
        String code = Protocole.champTexte(info, "code");
        String adresse = "127.0.0.1:" + port;

        List<String> trouves = Decouverte.chercher(1500, (int) portUdp,
                Collections.singletonList(InetAddress.getByName("127.0.0.1")));
        verifier(trouves.size() >= 1 && trouves.get(0).contains(Protocole.champTexte(info, "serveur_id")),
                "découverte UDP : " + trouves);

        try {
            Client.appairer(adresse, "ZZZZ-ZZZZ", "Mauvais code");
            verifier(false, "un code faux doit être refusé");
        } catch (Client.Erreur e) {
            verifier(e.statut == 403 && e.getMessage().contains("incorrect"), "code faux refusé : " + e.getMessage());
        }
        Client.Association a = Client.appairer(adresse, code.toLowerCase().substring(0, 4) + "-" + code.substring(4),
                "Téléphone « test » Java");
        verifier(a.cle.length == 32 && a.appareilId > 0 && !a.contenu.contains(Protocole.b64(a.cle)),
                "association : appareil " + a.appareilId + ", clé de 32 octets non exposée");

        String rep = Client.synchroniser(adresse, a.appareilId, a.cle, 1, "{\"ops\":[],\"client\":{\"version\":\"jvm\"}}");
        verifier(rep.contains("\"instantane\"") && rep.contains("\"eleves\""), "copie des données reçue ("
                + rep.length() + " caractères)");

        long iid = Protocole.champEntier(info, "inscription_id");
        long mid = Protocole.champEntier(info, "matiere_id");
        String op = "{\"ops\":[{\"uid\":\"jvm-1\",\"op\":\"note\",\"inscription_id\":" + iid + ",\"matiere_id\":" + mid
                + ",\"valeur\":3,\"avant\":null}]}";
        rep = Client.synchroniser(adresse, a.appareilId, a.cle, 2, op);
        verifier(rep.contains("\"uid\":\"jvm-1\",\"ok\":true"), "note saisie sur le téléphone appliquée");

        try {
            Client.synchroniser(adresse, a.appareilId, a.cle, 2, "{}");
            verifier(false, "un rejeu doit être refusé");
        } catch (Client.Erreur e) {
            verifier(e.statut == 409, "rejeu refusé : " + e.getMessage());
        }
        byte[] autre = Protocole.aleatoire(32);
        try {
            Client.synchroniser(adresse, a.appareilId, autre, 3, "{}");
            verifier(false, "une mauvaise clé doit être refusée");
        } catch (Client.Erreur e) {
            verifier(e.statut == 400, "mauvaise clé refusée : " + e.getMessage());
        }
        String vide = Client.synchroniser(adresse, a.appareilId, a.cle, 4, "{}");
        verifier(vide.contains("\"resultats\":[]"), "requête vide acceptée");
        System.out.println(echecs == 0 ? "Client Java compatible avec le serveur." : echecs + " échec(s).");
        System.exit(echecs == 0 ? 0 : 1);
    }
}
