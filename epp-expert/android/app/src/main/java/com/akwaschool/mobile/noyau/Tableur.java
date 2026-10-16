package com.akwaschool.mobile.noyau;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;

/**
 * Lecture de la première feuille d'un tableau importé sur le téléphone : Excel 97-2003 (.xls, comme l'export
 * national des élèves), Excel (.xlsx) ou CSV (séparateur ; ou ,). Le format est reconnu au contenu.
 * Chaque cellule est rendue en texte ; un nombre entier s'écrit sans décimale (12, pas 12.0) ; une date reste
 * le numéro de série d'Excel (converti par l'interface selon la colonne). Lignes entièrement vides retirées.
 * Même résultat que epp/io/import_eleves19.lire_fichier (lecture .xls reprise de epp/io/lecture_xls.py).
 * Java pur : testé sur l'ordinateur.
 */
public final class Tableur {
    private static final int MAX_OCTETS = 20 * 1024 * 1024;

    private Tableur() {
    }

    /** Fichier illisible : message destiné à l'utilisateur. */
    public static final class Illisible extends Exception {
        public Illisible(String message) {
            super(message);
        }
    }

    public static byte[] tout(InputStream in) throws IOException, Illisible {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) {
            o.write(buf, 0, n);
            if (o.size() > MAX_OCTETS) {
                throw new Illisible("Fichier trop volumineux (plus de 20 Mo).");
            }
        }
        return o.toByteArray();
    }

    public static List<List<String>> lire(byte[] data) throws Illisible {
        List<List<String>> brut;
        if (data.length >= 4 && (data[0] & 0xFF) == 0xD0 && (data[1] & 0xFF) == 0xCF && data[2] == 0x11
                && (data[3] & 0xFF) == 0xE0) {
            brut = Xls.lire(data);
        } else if (data.length >= 2 && data[0] == 'P' && data[1] == 'K') {
            brut = xlsx(data);
        } else {
            brut = csv(data);
        }
        List<List<String>> out = new ArrayList<>();
        for (List<String> r : brut) {
            List<String> l = new ArrayList<>(r);
            while (!l.isEmpty() && l.get(l.size() - 1).isEmpty()) {
                l.remove(l.size() - 1);
            }
            if (!l.isEmpty()) {
                out.add(l);
            }
        }
        return out;
    }

    /** 12.0 → « 12 » ; 9.25 → « 9.25 » (comme _texte côté Python). */
    static String nombre(double x) {
        if (x == Math.rint(x) && Math.abs(x) < 1e15) {
            return Long.toString((long) x);
        }
        return new java.math.BigDecimal(x).setScale(6, java.math.RoundingMode.HALF_EVEN).stripTrailingZeros()
                .toPlainString();
    }

    // ================================================================== CSV
    static List<List<String>> csv(byte[] data) {
        String t;
        try {
            t = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(data)).toString();
        } catch (CharacterCodingException e) {
            t = new String(data, Charset.forName("windows-1252"));
        }
        if (t.startsWith("﻿")) {
            t = t.substring(1);
        }
        int fin = t.indexOf('\n');
        String premiere = fin < 0 ? t : t.substring(0, fin);
        char sep = compter(premiere, ';') >= compter(premiere, ',') ? ';' : ',';
        if (compter(premiere, '\t') > Math.max(compter(premiere, ';'), compter(premiere, ','))) {
            sep = '\t';
        }
        List<List<String>> out = new ArrayList<>();
        List<String> ligne = new ArrayList<>();
        StringBuilder cel = new StringBuilder();
        boolean guillemets = false;
        for (int i = 0; i < t.length(); i++) {
            char c = t.charAt(i);
            if (guillemets) {
                if (c == '"') {
                    if (i + 1 < t.length() && t.charAt(i + 1) == '"') {
                        cel.append('"');
                        i++;
                    } else {
                        guillemets = false;
                    }
                } else {
                    cel.append(c);
                }
            } else if (c == '"' && cel.length() == 0) {
                guillemets = true;
            } else if (c == sep) {
                ligne.add(cel.toString().trim());
                cel.setLength(0);
            } else if (c == '\n' || c == '\r') {
                if (c == '\r' && i + 1 < t.length() && t.charAt(i + 1) == '\n') {
                    i++;
                }
                ligne.add(cel.toString().trim());
                cel.setLength(0);
                out.add(ligne);
                ligne = new ArrayList<>();
            } else {
                cel.append(c);
            }
        }
        if (cel.length() > 0 || !ligne.isEmpty()) {
            ligne.add(cel.toString().trim());
            out.add(ligne);
        }
        return out;
    }

    private static int compter(String s, char c) {
        int n = 0;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) == c) {
                n++;
            }
        }
        return n;
    }

    // ================================================================== XLSX
    static List<List<String>> xlsx(byte[] data) throws Illisible {
        Map<String, byte[]> parties = new HashMap<>();
        try (ZipInputStream z = new ZipInputStream(new ByteArrayInputStream(data))) {
            ZipEntry e;
            while ((e = z.getNextEntry()) != null) {
                String n = e.getName();
                if (n.equals("xl/sharedStrings.xml") || n.equals("xl/workbook.xml")
                        || n.equals("xl/_rels/workbook.xml.rels") || n.equals("xl/styles.xml")
                        || n.startsWith("xl/worksheets/sheet")) {
                    parties.put(n, tout(z));
                }
            }
        } catch (IOException e) {
            throw new Illisible("Fichier Excel (.xlsx) illisible ou endommagé.");
        }
        try {
            DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
            f.setNamespaceAware(false);
            f.setExpandEntityReferences(false);
            DocumentBuilder b = f.newDocumentBuilder();
            List<String> partagees = new ArrayList<>();
            if (parties.containsKey("xl/sharedStrings.xml")) {
                NodeList si = b.parse(new ByteArrayInputStream(parties.get("xl/sharedStrings.xml")))
                        .getElementsByTagName("si");
                for (int i = 0; i < si.getLength(); i++) {
                    partagees.add(texteRiche((Element) si.item(i)));
                }
            }
            Set<Integer> stylesDate = stylesDate(b, parties.get("xl/styles.xml"));
            String chemin = premiereFeuille(b, parties);
            byte[] feuille = parties.get(chemin);
            if (feuille == null) {
                throw new Illisible("Aucune feuille dans le fichier Excel.");
            }
            Document d = b.parse(new ByteArrayInputStream(feuille));
            TreeMap<Integer, TreeMap<Integer, String>> lignes = new TreeMap<>();
            NodeList cs = d.getElementsByTagName("c");
            for (int i = 0; i < cs.getLength(); i++) {
                Element c = (Element) cs.item(i);
                String ref = c.getAttribute("r");
                int[] rc = reference(ref);
                if (rc == null) {
                    continue;
                }
                String type = c.getAttribute("t");
                String v = enfant(c, "v");
                String val;
                if ("s".equals(type)) {
                    int k = v == null ? -1 : Integer.parseInt(v.trim());
                    val = k >= 0 && k < partagees.size() ? partagees.get(k) : "";
                } else if ("inlineStr".equals(type)) {
                    NodeList is = c.getElementsByTagName("is");
                    val = is.getLength() > 0 ? texteRiche((Element) is.item(0)) : "";
                } else if ("b".equals(type)) {
                    val = "1".equals(v) ? "1" : "0";
                } else if ("str".equals(type) || "e".equals(type)) {
                    val = v == null ? "" : v;
                } else if (v != null && !c.getAttribute("s").isEmpty()
                        && stylesDate.contains(Integer.parseInt(c.getAttribute("s").trim()))) {
                    val = dateSerie(v);
                } else {
                    val = v == null ? "" : nombreTexte(v);
                }
                lignes.computeIfAbsent(rc[0], k -> new TreeMap<>()).put(rc[1], val.trim());
            }
            List<List<String>> out = new ArrayList<>();
            for (TreeMap<Integer, String> cells : lignes.values()) {
                List<String> l = new ArrayList<>();
                int max = cells.lastKey();
                for (int c = 0; c <= max; c++) {
                    l.add(cells.getOrDefault(c, ""));
                }
                out.add(l);
            }
            return out;
        } catch (Illisible e) {
            throw e;
        } catch (Exception e) {
            throw new Illisible("Fichier Excel (.xlsx) illisible : " + e.getMessage());
        }
    }

    /** Numéro de série Excel (calendrier 1900) → « AAAA-MM-JJ », comme openpyxl côté ordinateur. */
    static String dateSerie(String v) {
        try {
            double x = Double.parseDouble(v.trim());
            long jours = (long) Math.floor(x);
            java.time.LocalDate d = java.time.LocalDate.of(1899, 12, 30).plusDays(jours);
            return d.toString();
        } catch (NumberFormatException e) {
            return v.trim();
        }
    }

    /** Index (cellXfs) des styles qui affichent une date : formats intégrés 14-22, 45-47, ou format personnalisé
     * contenant j/m/a hors texte entre guillemets. */
    private static Set<Integer> stylesDate(DocumentBuilder b, byte[] styles) {
        Set<Integer> out = new HashSet<>();
        if (styles == null) {
            return out;
        }
        try {
            Document d = b.parse(new ByteArrayInputStream(styles));
            Set<Integer> formats = new HashSet<>();
            for (int i = 14; i <= 22; i++) {
                formats.add(i);
            }
            formats.add(45);
            formats.add(46);
            formats.add(47);
            NodeList nf = d.getElementsByTagName("numFmt");
            for (int i = 0; i < nf.getLength(); i++) {
                Element e = (Element) nf.item(i);
                String code = e.getAttribute("formatCode").replaceAll("\"[^\"]*\"", "").replaceAll("\\[[^\\]]*\\]", "")
                        .toLowerCase(java.util.Locale.ROOT);
                if (code.matches(".*[dy].*") || (code.contains("m") && !code.contains("h") && !code.contains("s"))) {
                    formats.add(Integer.parseInt(e.getAttribute("numFmtId")));
                }
            }
            NodeList xfs = d.getElementsByTagName("cellXfs");
            if (xfs.getLength() > 0) {
                int k = 0;
                for (Node n = xfs.item(0).getFirstChild(); n != null; n = n.getNextSibling()) {
                    if (n.getNodeType() == Node.ELEMENT_NODE && n.getNodeName().equals("xf")) {
                        String id = ((Element) n).getAttribute("numFmtId");
                        if (!id.isEmpty() && formats.contains(Integer.parseInt(id))) {
                            out.add(k);
                        }
                        k++;
                    }
                }
            }
        } catch (Exception ignored) {
            // styles illisibles : les dates restent des numéros de série
        }
        return out;
    }

    private static String nombreTexte(String v) {
        try {
            return nombre(Double.parseDouble(v.trim()));
        } catch (NumberFormatException e) {
            return v.trim();
        }
    }

    private static String premiereFeuille(DocumentBuilder b, Map<String, byte[]> parties) throws Exception {
        if (parties.containsKey("xl/workbook.xml") && parties.containsKey("xl/_rels/workbook.xml.rels")) {
            NodeList s = b.parse(new ByteArrayInputStream(parties.get("xl/workbook.xml"))).getElementsByTagName("sheet");
            if (s.getLength() > 0) {
                String rid = ((Element) s.item(0)).getAttribute("r:id");
                NodeList rels = b.parse(new ByteArrayInputStream(parties.get("xl/_rels/workbook.xml.rels")))
                        .getElementsByTagName("Relationship");
                for (int i = 0; i < rels.getLength(); i++) {
                    Element r = (Element) rels.item(i);
                    if (r.getAttribute("Id").equals(rid)) {
                        String t = r.getAttribute("Target");
                        return t.startsWith("/") ? t.substring(1) : "xl/" + t;
                    }
                }
            }
        }
        return "xl/worksheets/sheet1.xml";
    }

    private static String enfant(Element e, String nom) {
        for (Node n = e.getFirstChild(); n != null; n = n.getNextSibling()) {
            if (n.getNodeType() == Node.ELEMENT_NODE && n.getNodeName().equals(nom)) {
                return n.getTextContent();
            }
        }
        return null;
    }

    /** Texte d'un élément si / is : ses t, sans les annotations phonétiques (rPh). */
    private static String texteRiche(Element e) {
        StringBuilder sb = new StringBuilder();
        NodeList ts = e.getElementsByTagName("t");
        for (int i = 0; i < ts.getLength(); i++) {
            Node p = ts.item(i).getParentNode();
            if (p != null && "rPh".equals(p.getNodeName())) {
                continue;
            }
            sb.append(ts.item(i).getTextContent());
        }
        return sb.toString();
    }

    /** « C12 » → {11, 2}. */
    static int[] reference(String ref) {
        if (ref == null || ref.isEmpty()) {
            return null;
        }
        int col = 0, i = 0;
        while (i < ref.length() && Character.isLetter(ref.charAt(i))) {
            col = col * 26 + (Character.toUpperCase(ref.charAt(i)) - 'A' + 1);
            i++;
        }
        try {
            return new int[]{Integer.parseInt(ref.substring(i)) - 1, col - 1};
        } catch (NumberFormatException e) {
            return null;
        }
    }

    // ================================================================== XLS (BIFF8 dans un fichier composé OLE2)
    static final class Xls {
        private static final long FIN_CHAINE = 0xFFFFFFFAL;

        private Xls() {
        }

        private static int u16(byte[] b, int o) {
            return (b[o] & 0xFF) | ((b[o + 1] & 0xFF) << 8);
        }

        private static long u32(byte[] b, int o) {
            return (u16(b, o) | ((long) u16(b, o + 2) << 16)) & 0xFFFFFFFFL;
        }

        private static double f64(byte[] b, int o) {
            return ByteBuffer.wrap(b, o, 8).order(ByteOrder.LITTLE_ENDIAN).getDouble();
        }

        static byte[] fluxWorkbook(byte[] d) throws Illisible {
            if (d.length < 512) {
                throw new Illisible("Fichier .xls tronqué ou endommagé.");
            }
            int ss = 1 << u16(d, 30), mss = 1 << u16(d, 32);
            long nFat = u32(d, 44), dir0 = u32(d, 48), miniCut = u32(d, 56), mfat0 = u32(d, 60);
            long difat0 = u32(d, 68), nDifat = u32(d, 72);
            List<Long> difat = new ArrayList<>();
            for (int i = 0; i < 109; i++) {
                difat.add(u32(d, 76 + i * 4));
            }
            long s = difat0;
            for (int k = 0; k < nDifat && s < FIN_CHAINE; k++) {
                int o = secteur(d, s, ss);
                for (int i = 0; i < ss / 4 - 1; i++) {
                    difat.add(u32(d, o + i * 4));
                }
                s = u32(d, o + ss - 4);
            }
            List<Long> fat = new ArrayList<>();
            for (int i = 0; i < nFat && i < difat.size(); i++) {
                int o = secteur(d, difat.get(i), ss);
                for (int j = 0; j < ss / 4; j++) {
                    fat.add(u32(d, o + j * 4));
                }
            }
            byte[] rep = gros(d, dir0, fat, ss);
            String nomRacine = null;
            long racineDebut = 0, debut = -1, taille = 0;
            for (int p = 0; p + 128 <= rep.length; p += 128) {
                int nl = u16(rep, p + 64);
                String nom = new String(rep, p, Math.max(0, Math.min(64, nl - 2)), StandardCharsets.UTF_16LE);
                int type = rep[p + 66] & 0xFF;
                if (nomRacine == null) {
                    nomRacine = nom;
                    racineDebut = u32(rep, p + 116);
                    continue;
                }
                if (debut < 0 && type == 2 && (nom.equals("Workbook") || nom.equals("Book"))) {
                    debut = u32(rep, p + 116);
                    taille = u32(rep, p + 120);
                }
            }
            if (nomRacine == null) {
                throw new Illisible("Fichier .xls sans répertoire.");
            }
            if (debut < 0) {
                throw new Illisible("Classeur introuvable dans le fichier .xls.");
            }
            byte[] flux;
            if (taille < miniCut) {
                byte[] mini = gros(d, racineDebut, fat, ss);
                List<Long> mfat = new ArrayList<>();
                for (long x : chaine(mfat0, fat)) {
                    int o = secteur(d, x, ss);
                    for (int j = 0; j < ss / 4; j++) {
                        mfat.add(u32(d, o + j * 4));
                    }
                }
                ByteArrayOutputStream o = new ByteArrayOutputStream();
                for (long x : chaine(debut, mfat)) {
                    int a = (int) (x * mss);
                    if (a + mss > mini.length) {
                        throw new Illisible("Fichier .xls tronqué ou endommagé.");
                    }
                    o.write(mini, a, mss);
                }
                flux = o.toByteArray();
            } else {
                flux = gros(d, debut, fat, ss);
            }
            if (taille > flux.length) {
                throw new Illisible("Fichier .xls tronqué ou endommagé.");
            }
            byte[] out = new byte[(int) taille];
            System.arraycopy(flux, 0, out, 0, out.length);
            return out;
        }

        private static int secteur(byte[] d, long s, int ss) throws Illisible {
            long o = (s + 1) * ss;
            if (o + ss > d.length) {
                throw new Illisible("Fichier .xls tronqué ou endommagé.");
            }
            return (int) o;
        }

        private static List<Long> chaine(long s, List<Long> table) throws Illisible {
            List<Long> out = new ArrayList<>();
            Set<Long> vus = new HashSet<>();
            while (s < FIN_CHAINE) {
                if (!vus.add(s) || s >= table.size()) {
                    throw new Illisible("Chaîne de secteurs invalide dans le fichier .xls.");
                }
                out.add(s);
                s = table.get((int) s);
            }
            return out;
        }

        private static byte[] gros(byte[] d, long s, List<Long> fat, int ss) throws Illisible {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            for (long x : chaine(s, fat)) {
                o.write(d, secteur(d, x, ss), ss);
            }
            return o.toByteArray();
        }

        private static double rk(long v) {
            double x;
            if ((v & 2) != 0) {
                long i = v >> 2;
                if ((i & (1L << 29)) != 0) {
                    i -= 1L << 30;
                }
                x = i;
            } else {
                x = Double.longBitsToDouble((v & 0xFFFFFFFCL) << 32);
            }
            return (v & 1) != 0 ? x / 100 : x;
        }

        private static String courte(byte[] b, int p) {
            int n = u16(b, p), fl = b[p + 2] & 0xFF;
            p += 3;
            if ((fl & 1) != 0) {
                return new String(b, p, Math.min(2 * n, b.length - p), StandardCharsets.UTF_16LE);
            }
            return new String(b, p, Math.min(n, b.length - p), StandardCharsets.ISO_8859_1);
        }

        /** Table des chaînes partagées (SST + CONTINUE). */
        private static List<String> sst(List<byte[]> morceaux) {
            List<String> out = new ArrayList<>();
            if (morceaux.isEmpty() || morceaux.get(0).length < 8) {
                return out;
            }
            long total = u32(morceaux.get(0), 4);
            int[] mi = {0};
            byte[][] b = {morceaux.get(0)};
            int[] p = {8};
            java.util.function.BooleanSupplier suivant = () -> {
                if (mi[0] + 1 >= morceaux.size()) {
                    return false;
                }
                mi[0]++;
                b[0] = morceaux.get(mi[0]);
                p[0] = 0;
                return true;
            };
            for (long z = 0; z < total; z++) {
                if (p[0] + 3 > b[0].length && !suivant.getAsBoolean()) {
                    break;
                }
                int n = u16(b[0], p[0]);
                int fl = b[0][p[0] + 2] & 0xFF;
                p[0] += 3;
                int rt = 0;
                long sz = 0;
                if ((fl & 8) != 0) {
                    rt = u16(b[0], p[0]);
                    p[0] += 2;
                }
                if ((fl & 4) != 0) {
                    sz = u32(b[0], p[0]);
                    p[0] += 4;
                }
                StringBuilder sb = new StringBuilder();
                int reste = n;
                while (reste > 0) {
                    if (p[0] >= b[0].length) {
                        if (!suivant.getAsBoolean()) {
                            break;
                        }
                        fl = b[0][p[0]] & 0xFF;
                        p[0]++;
                    }
                    boolean large = (fl & 1) != 0;
                    int k = Math.min(reste, (b[0].length - p[0]) / (large ? 2 : 1));
                    if (large) {
                        sb.append(new String(b[0], p[0], 2 * k, StandardCharsets.UTF_16LE));
                        p[0] += 2 * k;
                    } else {
                        sb.append(new String(b[0], p[0], k, StandardCharsets.ISO_8859_1));
                        p[0] += k;
                    }
                    reste -= k;
                    if (k == 0 && p[0] < b[0].length) {
                        break;                      // caractère large coupé : fichier anormal
                    }
                }
                long saut = rt * 4L + sz;
                while (saut > 0) {
                    if (p[0] >= b[0].length && !suivant.getAsBoolean()) {
                        break;
                    }
                    long t = Math.min(saut, b[0].length - p[0]);
                    p[0] += (int) t;
                    saut -= t;
                }
                out.add(sb.toString());
            }
            return out;
        }

        static List<List<String>> lire(byte[] data) throws Illisible {
            byte[] flux = fluxWorkbook(data);
            List<int[]> recs = new ArrayList<>();          // {type, position, longueur}
            for (int p = 0; p + 4 <= flux.length; ) {
                int t = u16(flux, p), l = u16(flux, p + 2);
                recs.add(new int[]{t, p, Math.min(l, flux.length - p - 4)});
                p += 4 + l;
            }
            List<String> sst = new ArrayList<>();
            List<Long> feuilles = new ArrayList<>();
            for (int i = 0; i < recs.size(); ) {
                int[] r = recs.get(i);
                if (r[0] == 0x00FC) {
                    List<byte[]> m = new ArrayList<>();
                    m.add(corps(flux, r));
                    int j = i + 1;
                    while (j < recs.size() && recs.get(j)[0] == 0x003C) {
                        m.add(corps(flux, recs.get(j)));
                        j++;
                    }
                    sst = sst(m);
                    i = j;
                    continue;
                }
                if (r[0] == 0x0085 && r[2] >= 6 && flux[r[1] + 4 + 5] == 0) {
                    feuilles.add(u32(flux, r[1] + 4));
                }
                if (r[0] == 0x000A) {
                    break;
                }
                i++;
            }
            if (feuilles.isEmpty()) {
                throw new Illisible("Aucune feuille de calcul dans le fichier .xls.");
            }
            long debut = feuilles.get(0);
            int k = -1;
            for (int i = 0; i < recs.size(); i++) {
                if (recs.get(i)[1] == debut) {
                    k = i;
                    break;
                }
            }
            if (k < 0) {
                throw new Illisible("Feuille introuvable dans le fichier .xls.");
            }
            TreeMap<Integer, TreeMap<Integer, String>> lignes = new TreeMap<>();
            int niveau = 0;
            while (k < recs.size()) {
                int[] r = recs.get(k);
                byte[] b = corps(flux, r);
                k++;
                int t = r[0];
                if (t == 0x0809) {
                    niveau++;
                    continue;
                }
                if (t == 0x000A) {
                    niveau--;
                    if (niveau <= 0) {
                        break;
                    }
                    continue;
                }
                if (niveau != 1 || b.length < 6) {
                    continue;
                }
                int row = u16(b, 0), col = u16(b, 2);
                if (t == 0x00FD && b.length >= 10) {
                    long idx = u32(b, 6);
                    poser(lignes, row, col, idx < sst.size() ? sst.get((int) idx) : "");
                } else if ((t == 0x0204 || t == 0x00D6) && b.length >= 9) {
                    poser(lignes, row, col, courte(b, 6));
                } else if (t == 0x0203 && b.length >= 14) {
                    poser(lignes, row, col, nombre(f64(b, 6)));
                } else if (t == 0x027E && b.length >= 10) {
                    poser(lignes, row, col, nombre(rk(u32(b, 6))));
                } else if (t == 0x00BD) {
                    int n = (b.length - 6) / 6;
                    for (int j = 0; j < n; j++) {
                        poser(lignes, row, col + j, nombre(rk(u32(b, 4 + j * 6 + 2))));
                    }
                } else if (t == 0x0205 && b.length >= 8) {
                    if (b[7] == 0) {
                        poser(lignes, row, col, b[6] != 0 ? "1" : "0");
                    }
                } else if (t == 0x0006 && b.length >= 14) {
                    if (!((b[12] & 0xFF) == 0xFF && (b[13] & 0xFF) == 0xFF)) {
                        poser(lignes, row, col, nombre(f64(b, 6)));
                    } else if (b[6] == 0 && k < recs.size() && recs.get(k)[0] == 0x0207) {
                        poser(lignes, row, col, courte(corps(flux, recs.get(k)), 0));
                    } else if (b[6] == 1) {
                        poser(lignes, row, col, b[8] != 0 ? "1" : "0");
                    }
                }
            }
            List<List<String>> out = new ArrayList<>();
            if (lignes.isEmpty()) {
                return out;
            }
            for (int r = 0; r <= lignes.lastKey(); r++) {
                TreeMap<Integer, String> cells = lignes.get(r);
                List<String> l = new ArrayList<>();
                if (cells != null) {
                    for (int c = 0; c <= cells.lastKey(); c++) {
                        l.add(cells.getOrDefault(c, ""));
                    }
                }
                out.add(l);
            }
            return out;
        }

        private static byte[] corps(byte[] flux, int[] r) {
            byte[] b = new byte[r[2]];
            System.arraycopy(flux, r[1] + 4, b, 0, r[2]);
            return b;
        }

        private static void poser(TreeMap<Integer, TreeMap<Integer, String>> l, int r, int c, String v) {
            l.computeIfAbsent(r, k -> new TreeMap<>()).put(c, v.trim());
        }
    }

    /** Lignes en JSON (tableau de tableaux de chaînes), pour l'interface. */
    public static String json(List<List<String>> lignes) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < lignes.size(); i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append('[');
            List<String> r = lignes.get(i);
            for (int j = 0; j < r.size(); j++) {
                if (j > 0) {
                    sb.append(',');
                }
                sb.append(com.akwaschool.mobile.synchro.Protocole.jsonTexte(r.get(j)));
            }
            sb.append(']');
        }
        return sb.append(']').toString();
    }
}
