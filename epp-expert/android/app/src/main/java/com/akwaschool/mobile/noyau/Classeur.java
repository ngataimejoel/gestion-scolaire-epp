package com.akwaschool.mobile.noyau;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Classeur Excel (.xlsx) produit sur le téléphone, avec la présentation de l'application Windows :
 * <ul>
 *   <li>style « national » (export ELEVES, epp/io/import_eleves19._ecrire) : feuille ELEVES, en-tête blanc sur
 *   vert, toutes les cellules au format texte (les matricules gardent leurs zéros), volet figé sous l'en-tête ;</li>
 *   <li>style « rapport » (epp/reports/render_xlsx.py) : en-tête officiel, titre bleu, en-têtes de colonnes blancs
 *   sur bleu, bordures fines, noms en gras à gauche, nombres au format 0,00, dates jj/mm/aaaa.</li>
 * </ul>
 * Décrit en JSON par l'interface : {"feuilles": [{"nom", "style", "entete": [..], "droite": [..], "titre",
 * "sous_titre", "colonnes": [{"titre", "type": texte|nombre|entier|date|centre, "nom": bool, "largeur"}],
 * "lignes": [[..]], "paysage": bool}]}.
 */
public final class Classeur {
    private static final LocalDate ORIGINE = LocalDate.of(1899, 12, 30);
    // index des styles (cellXfs de styles.xml)
    private static final int S_ENTETE = 1, S_TITRE = 2, S_SOUS_TITRE = 3, S_COLONNE = 4, S_TEXTE = 5, S_NOM = 6,
            S_NOMBRE = 7, S_ENTIER = 8, S_DATE = 9, S_NAT_ENTETE = 10, S_NAT_TEXTE = 11, S_DROITE = 12, S_CENTRE = 13;

    private Classeur() {
    }

    @SuppressWarnings("unchecked")
    public static byte[] depuisJson(String json) throws IOException {
        Object o = Json.lire(json);
        if (!(o instanceof Map) || !(((Map<String, Object>) o).get("feuilles") instanceof List)) {
            throw new IllegalArgumentException("Description du classeur invalide.");
        }
        List<Map<String, Object>> feuilles = new ArrayList<>();
        for (Object f : (List<Object>) ((Map<String, Object>) o).get("feuilles")) {
            feuilles.add((Map<String, Object>) f);
        }
        if (feuilles.isEmpty()) {
            throw new IllegalArgumentException("Classeur sans feuille.");
        }
        return ecrire(feuilles);
    }

    static String xml(Object v) {
        String s = v == null ? "" : String.valueOf(v);
        StringBuilder b = new StringBuilder(s.length() + 8);
        for (int k = 0; k < s.length(); k++) {
            char c = s.charAt(k);
            switch (c) {
                case '&': b.append("&amp;"); break;
                case '<': b.append("&lt;"); break;
                case '>': b.append("&gt;"); break;
                case '"': b.append("&quot;"); break;
                default:
                    if (c >= 0x20 || c == '\n' || c == '\t') {
                        b.append(c);
                    }
            }
        }
        return b.toString();
    }

    static String colonne(int n) {             // 0 -> A, 26 -> AA
        StringBuilder b = new StringBuilder();
        for (n++; n > 0; n = (n - 1) / 26) {
            b.insert(0, (char) ('A' + (n - 1) % 26));
        }
        return b.toString();
    }

    private static String texte(Object v) {
        if (v == null) {
            return "";
        }
        if (v instanceof Double) {
            double d = (Double) v;
            return d == Math.rint(d) && Math.abs(d) < 1e15 ? String.valueOf((long) d) : String.valueOf(d);
        }
        return String.valueOf(v);
    }

    private static String nom(Map<String, Object> f, int i) {
        String n = texte(f.get("nom")).replaceAll("[\\\\/?*\\[\\]:]", "-").trim();
        if (n.length() > 31) {
            n = n.substring(0, 31);
        }
        return n.isEmpty() ? "Feuille" + (i + 1) : n;
    }

    private static final class Feuille {
        final StringBuilder lignes = new StringBuilder();
        final List<Double> largeurs = new ArrayList<>();
        int ligne;                 // dernière ligne écrite (1 = première)
        int figer;                 // lignes figées en haut
        int titresImpression;      // ligne des en-têtes répétée à l'impression (0 : aucune)

        void largeur(int col, double l) {
            while (largeurs.size() <= col) {
                largeurs.add(0.0);
            }
            largeurs.set(col, Math.max(largeurs.get(col), l));
        }

        StringBuilder nouvelleLigne() {
            ligne++;
            return lignes.append("<row r=\"").append(ligne).append("\">");
        }

        void cellule(int col, Object v, int style, boolean nombre) {
            String ref = colonne(col) + ligne;
            if (v == null || (v instanceof String && ((String) v).isEmpty())) {
                lignes.append("<c r=\"").append(ref).append("\" s=\"").append(style).append("\"/>");
            } else if (nombre) {
                lignes.append("<c r=\"").append(ref).append("\" s=\"").append(style).append("\"><v>")
                        .append(texte(v)).append("</v></c>");
            } else {
                lignes.append("<c r=\"").append(ref).append("\" s=\"").append(style)
                        .append("\" t=\"inlineStr\"><is><t xml:space=\"preserve\">").append(xml(texte(v)))
                        .append("</t></is></c>");
            }
        }
    }

    /** Valeur numérique d'une cellule (nombre, ou texte « 12,5 »), sinon null. */
    private static Double nombre(Object v) {
        if (v instanceof Double) {
            return (Double) v;
        }
        if (v instanceof String && ((String) v).trim().matches("-?\\d+([.,]\\d+)?")) {
            return Double.valueOf(((String) v).trim().replace(',', '.'));
        }
        return null;
    }

    private static Long serieDate(Object v) {
        if (!(v instanceof String) || ((String) v).length() < 10) {
            return null;
        }
        try {
            return ChronoUnit.DAYS.between(ORIGINE, LocalDate.parse(((String) v).substring(0, 10)));
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private static Feuille feuille(Map<String, Object> f) {
        Feuille x = new Feuille();
        boolean national = "national".equals(f.get("style"));
        List<Map<String, Object>> cols = new ArrayList<>();
        if (f.get("colonnes") instanceof List) {
            for (Object c : (List<Object>) f.get("colonnes")) {
                cols.add(c instanceof Map ? (Map<String, Object>) c : Collections.singletonMap("titre", (Object) texte(c)));
            }
        }
        List<Object> lignes = f.get("lignes") instanceof List ? (List<Object>) f.get("lignes") : Collections.emptyList();
        int ncol = Math.max(cols.size(), 1);
        if (!national) {
            List<Object> gauche = f.get("entete") instanceof List ? (List<Object>) f.get("entete") : Collections.emptyList();
            List<Object> droite = f.get("droite") instanceof List ? (List<Object>) f.get("droite") : Collections.emptyList();
            int dcol = Math.max(ncol - 1, 3);
            for (int k = 0; k < Math.max(gauche.size(), droite.size()); k++) {
                x.nouvelleLigne();
                if (k < gauche.size()) {
                    x.cellule(0, gauche.get(k), S_ENTETE, false);
                }
                if (k < droite.size()) {
                    x.cellule(dcol, droite.get(k), S_DROITE, false);
                }
                x.lignes.append("</row>");
            }
            if (x.ligne > 0) {
                x.nouvelleLigne().append("</row>");
            }
            if (f.get("titre") != null) {
                x.nouvelleLigne();
                x.cellule(0, f.get("titre"), S_TITRE, false);
                x.lignes.append("</row>");
            }
            if (f.get("sous_titre") != null) {
                x.nouvelleLigne();
                x.cellule(0, f.get("sous_titre"), S_SOUS_TITRE, false);
                x.lignes.append("</row>");
            }
            if (f.get("titre") != null || f.get("sous_titre") != null) {
                x.nouvelleLigne().append("</row>");
            }
        }
        // en-têtes de colonnes
        x.nouvelleLigne();
        for (int c = 0; c < cols.size(); c++) {
            String t = texte(cols.get(c).get("titre"));
            x.cellule(c, t, national ? S_NAT_ENTETE : S_COLONNE, false);
            x.largeur(c, national ? Math.max(9, Math.min(28, t.length() + 4)) : Math.min(t.length() + 2, 30));
        }
        x.lignes.append("</row>");
        x.figer = x.ligne;
        x.titresImpression = national ? 0 : x.ligne;
        for (Object l : lignes) {
            List<Object> cel = l instanceof List ? (List<Object>) l : Collections.emptyList();
            x.nouvelleLigne();
            for (int c = 0; c < Math.max(cel.size(), cols.size()); c++) {
                Object v = c < cel.size() ? cel.get(c) : null;
                Map<String, Object> col = c < cols.size() ? cols.get(c) : Collections.emptyMap();
                String type = texte(col.get("type"));
                if (national) {
                    x.cellule(c, texte(v), S_NAT_TEXTE, false);
                    continue;
                }
                Double n = nombre(v);
                Long d = "date".equals(type) ? serieDate(v) : null;
                if (d != null) {
                    x.cellule(c, (double) d, S_DATE, true);
                } else if (("nombre".equals(type) || "entier".equals(type)) && n != null) {
                    x.cellule(c, n, "entier".equals(type) ? S_ENTIER : S_NOMBRE, true);
                } else {
                    boolean estNom = Boolean.TRUE.equals(col.get("nom"));
                    x.cellule(c, v, estNom ? S_NOM : "texte".equals(type) || type.isEmpty() ? S_TEXTE : S_CENTRE, false);
                }
                x.largeur(c, Math.min(texte(v).length() + 2, estLarge(col) ? 40 : 30));
            }
            x.lignes.append("</row>");
        }
        for (int c = 0; c < cols.size(); c++) {
            Object l = cols.get(c).get("largeur");
            if (l instanceof Double) {
                x.largeurs.set(c, (Double) l);
            } else if (!national) {
                x.largeurs.set(c, Math.max(6, x.largeurs.get(c)));
            }
        }
        return x;
    }

    private static boolean estLarge(Map<String, Object> col) {
        return Boolean.TRUE.equals(col.get("nom"));
    }

    private static String feuilleXml(Feuille x, boolean paysage) {
        StringBuilder b = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n")
                .append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
                        + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">")
                .append("<sheetPr><pageSetUpPr fitToPage=\"1\"/></sheetPr><sheetViews><sheetView workbookViewId=\"0\">");
        if (x.figer > 0) {
            String cel = "A" + (x.figer + 1);
            b.append("<pane ySplit=\"").append(x.figer).append("\" topLeftCell=\"").append(cel)
                    .append("\" activePane=\"bottomLeft\" state=\"frozen\"/><selection pane=\"bottomLeft\" activeCell=\"")
                    .append(cel).append("\" sqref=\"").append(cel).append("\"/>");
        }
        b.append("</sheetView></sheetViews><sheetFormatPr defaultRowHeight=\"15\"/>");
        if (!x.largeurs.isEmpty()) {
            b.append("<cols>");
            for (int c = 0; c < x.largeurs.size(); c++) {
                double l = Math.max(4, x.largeurs.get(c) + 1);
                b.append("<col min=\"").append(c + 1).append("\" max=\"").append(c + 1).append("\" width=\"")
                        .append(Math.round(l * 100) / 100.0).append("\" customWidth=\"1\"/>");
            }
            b.append("</cols>");
        }
        b.append("<sheetData>").append(x.lignes).append("</sheetData>")
                .append("<printOptions horizontalCentered=\"1\"/>")
                .append("<pageMargins left=\"0.4\" right=\"0.4\" top=\"0.5\" bottom=\"0.5\" header=\"0.3\" footer=\"0.3\"/>")
                .append("<pageSetup paperSize=\"9\" orientation=\"").append(paysage ? "landscape" : "portrait")
                .append("\" fitToWidth=\"1\" fitToHeight=\"0\"/></worksheet>");
        return b.toString();
    }

    private static final String STYLES = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
            + "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
            + "<numFmts count=\"1\"><numFmt numFmtId=\"164\" formatCode=\"dd/mm/yyyy\"/></numFmts>"
            + "<fonts count=\"6\">"
            + "<font><sz val=\"11\"/><name val=\"Calibri\"/><family val=\"2\"/></font>"
            + "<font><b/><sz val=\"9\"/><name val=\"Calibri\"/><family val=\"2\"/></font>"
            + "<font><b/><sz val=\"13\"/><color rgb=\"FF1F4E79\"/><name val=\"Calibri\"/><family val=\"2\"/></font>"
            + "<font><i/><sz val=\"11\"/><name val=\"Calibri\"/><family val=\"2\"/></font>"
            + "<font><b/><sz val=\"11\"/><color rgb=\"FFFFFFFF\"/><name val=\"Calibri\"/><family val=\"2\"/></font>"
            + "<font><b/><sz val=\"11\"/><name val=\"Calibri\"/><family val=\"2\"/></font></fonts>"
            + "<fills count=\"4\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill>"
            + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF1F4E79\"/><bgColor indexed=\"64\"/></patternFill></fill>"
            + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF0E6646\"/><bgColor indexed=\"64\"/></patternFill></fill></fills>"
            + "<borders count=\"2\"><border><left/><right/><top/><bottom/><diagonal/></border>"
            + "<border><left style=\"thin\"><color rgb=\"FF808080\"/></left><right style=\"thin\"><color rgb=\"FF808080\"/></right>"
            + "<top style=\"thin\"><color rgb=\"FF808080\"/></top><bottom style=\"thin\"><color rgb=\"FF808080\"/></bottom><diagonal/></border></borders>"
            + "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
            + "<cellXfs count=\"14\">"
            + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>"                                    // 0
            + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>"                   // 1 en-tête officiel
            + "<xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>"                   // 2 titre
            + "<xf numFmtId=\"0\" fontId=\"3\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>"                   // 3 sous-titre
            + "<xf numFmtId=\"0\" fontId=\"4\" fillId=\"2\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\">"
            + "<alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf>"                                    // 4 en-tête de colonne
            + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyBorder=\"1\" applyAlignment=\"1\">"
            + "<alignment horizontal=\"left\" vertical=\"center\" wrapText=\"1\"/></xf>"                                      // 5 texte
            + "<xf numFmtId=\"0\" fontId=\"5\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyBorder=\"1\" applyAlignment=\"1\">"
            + "<alignment horizontal=\"left\" vertical=\"center\" wrapText=\"1\"/></xf>"                                      // 6 nom
            + "<xf numFmtId=\"2\" fontId=\"0\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" applyBorder=\"1\" applyAlignment=\"1\">"
            + "<alignment horizontal=\"center\" vertical=\"center\"/></xf>"                                                   // 7 nombre 0,00
            + "<xf numFmtId=\"1\" fontId=\"0\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" applyBorder=\"1\" applyAlignment=\"1\">"
            + "<alignment horizontal=\"center\" vertical=\"center\"/></xf>"                                                   // 8 entier
            + "<xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyNumberFormat=\"1\" applyBorder=\"1\" applyAlignment=\"1\">"
            + "<alignment horizontal=\"center\" vertical=\"center\"/></xf>"                                                   // 9 date
            + "<xf numFmtId=\"49\" fontId=\"4\" fillId=\"3\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\"/>" // 10 national en-tête
            + "<xf numFmtId=\"49\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>"          // 11 national texte
            + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyAlignment=\"1\">"
            + "<alignment horizontal=\"right\"/></xf>"                                                                        // 12 en-tête droite
            + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"1\" xfId=\"0\" applyBorder=\"1\" applyAlignment=\"1\">"
            + "<alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf>"                                    // 13 texte centré
            + "</cellXfs><cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles></styleSheet>";

    static byte[] ecrire(List<Map<String, Object>> feuilles) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        StringBuilder types = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
                + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>");
        StringBuilder classeur = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                + "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
                + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>");
        StringBuilder liens = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
        StringBuilder noms = new StringBuilder();
        List<String> vus = new ArrayList<>();
        try (ZipOutputStream z = new ZipOutputStream(out)) {
            for (int i = 0; i < feuilles.size(); i++) {
                Map<String, Object> f = feuilles.get(i);
                String nom = nom(f, i);
                for (int k = 2; vus.contains(nom.toLowerCase()); k++) {
                    String suffixe = " (" + k + ")";
                    nom = nom(f, i).substring(0, Math.min(nom(f, i).length(), 31 - suffixe.length())) + suffixe;
                }
                vus.add(nom.toLowerCase());
                Feuille x = feuille(f);
                entree(z, "xl/worksheets/sheet" + (i + 1) + ".xml", feuilleXml(x, Boolean.TRUE.equals(f.get("paysage"))));
                types.append("<Override PartName=\"/xl/worksheets/sheet").append(i + 1)
                        .append(".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
                classeur.append("<sheet name=\"").append(xml(nom)).append("\" sheetId=\"").append(i + 1)
                        .append("\" r:id=\"rId").append(i + 1).append("\"/>");
                liens.append("<Relationship Id=\"rId").append(i + 1)
                        .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet")
                        .append(i + 1).append(".xml\"/>");
                if (x.titresImpression > 0) {
                    noms.append("<definedName name=\"_xlnm.Print_Titles\" localSheetId=\"").append(i).append("\">'")
                            .append(xml(nom.replace("'", "''"))).append("'!$").append(x.titresImpression).append(":$")
                            .append(x.titresImpression).append("</definedName>");
                }
            }
            classeur.append("</sheets>");
            if (noms.length() > 0) {
                classeur.append("<definedNames>").append(noms).append("</definedNames>");
            }
            classeur.append("</workbook>");
            liens.append("<Relationship Id=\"rId").append(feuilles.size() + 1)
                    .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>")
                    .append("</Relationships>");
            entree(z, "[Content_Types].xml", types.append("</Types>").toString());
            entree(z, "_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                    + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" "
                    + "Target=\"xl/workbook.xml\"/></Relationships>");
            entree(z, "xl/workbook.xml", classeur.toString());
            entree(z, "xl/_rels/workbook.xml.rels", liens.toString());
            entree(z, "xl/styles.xml", STYLES);
        }
        return out.toByteArray();
    }

    private static void entree(ZipOutputStream z, String nom, String contenu) throws IOException {
        z.putNextEntry(new ZipEntry(nom));
        z.write(contenu.getBytes(StandardCharsets.UTF_8));
        z.closeEntry();
    }
}
