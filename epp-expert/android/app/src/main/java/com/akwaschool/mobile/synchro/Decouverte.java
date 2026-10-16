package com.akwaschool.mobile.synchro;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Recherche de l'ordinateur de l'école sur le Wi-Fi : diffusion UDP « AKWA-SCHOOL? » sur le port 8766, chaque
 * ordinateur dont la synchronisation est démarrée répond (nom de l'école, identifiant, port).
 */
public final class Decouverte {
    private Decouverte() {
    }

    static Set<InetAddress> destinations() {
        Set<InetAddress> out = new LinkedHashSet<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) {
                    continue;
                }
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    if (ia.getBroadcast() != null) {
                        out.add(ia.getBroadcast());
                    }
                }
            }
        } catch (IOException | RuntimeException ignored) {
            // pas d'interface lisible : diffusion générale seulement
        }
        try {
            out.add(InetAddress.getByName("255.255.255.255"));
        } catch (IOException ignored) {
            // impossible en pratique
        }
        return out;
    }

    /**
     * Ordinateurs trouvés, sous forme d'objets JSON (réponse de l'ordinateur + « adresse »).
     *
     * @param autres adresses à interroger directement en plus de la diffusion (ex. 127.0.0.1 pour les tests)
     */
    public static List<String> chercher(int dureeMs, int port, List<InetAddress> autres) {
        Map<String, String> trouves = new LinkedHashMap<>();
        try (DatagramSocket s = new DatagramSocket()) {
            s.setBroadcast(true);
            byte[] q = Protocole.QUESTION_DECOUVERTE;
            List<InetAddress> cibles = new ArrayList<>(destinations());
            if (autres != null) {
                cibles.addAll(autres);
            }
            for (InetAddress a : cibles) {
                try {
                    s.send(new DatagramPacket(q, q.length, a, port));
                } catch (IOException ignored) {
                    // interface sans diffusion : on continue avec les autres
                }
            }
            long fin = System.currentTimeMillis() + dureeMs;
            byte[] buf = new byte[2048];
            while (true) {
                long reste = fin - System.currentTimeMillis();
                if (reste <= 0) {
                    break;
                }
                s.setSoTimeout((int) Math.max(1, reste));
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try {
                    s.receive(p);
                } catch (SocketTimeoutException e) {
                    break;
                }
                String json = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8).trim();
                if (!json.startsWith("{") || !json.contains("\"serveur_id\"")) {
                    continue;
                }
                Long port2 = Protocole.champEntier(json, "port");
                String ip = p.getAddress().getHostAddress();
                String adresse = port2 == null || port2 == Protocole.PORT_HTTP ? ip : ip + ":" + port2;
                String sid = Protocole.champTexte(json, "serveur_id");
                trouves.put(sid == null ? adresse : sid,
                        "{\"adresse\":" + Protocole.jsonTexte(adresse) + "," + json.substring(1));
            }
        } catch (IOException ignored) {
            // réseau indisponible : liste vide
        }
        return new ArrayList<>(trouves.values());
    }
}
