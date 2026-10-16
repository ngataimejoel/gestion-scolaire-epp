package com.akwaschool.mobile.noyau;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Lecture d'un texte JSON en objets Java (Map, List, String, Double, Boolean, null), sans dépendance : le
 * noyau reste testable sur l'ordinateur, où org.json (Android) n'existe pas.
 */
public final class Json {
    private final String s;
    private int i;

    private Json(String s) {
        this.s = s;
    }

    public static Object lire(String texte) {
        Json j = new Json(texte);
        j.blancs();
        Object v = j.valeur();
        j.blancs();
        if (j.i != j.s.length()) {
            throw j.erreur("caractères en trop");
        }
        return v;
    }

    private IllegalArgumentException erreur(String m) {
        return new IllegalArgumentException("JSON invalide (" + m + ", position " + i + ")");
    }

    private void blancs() {
        while (i < s.length() && " \t\r\n".indexOf(s.charAt(i)) >= 0) {
            i++;
        }
    }

    private Object valeur() {
        if (i >= s.length()) {
            throw erreur("fin inattendue");
        }
        char c = s.charAt(i);
        switch (c) {
            case '{': return objet();
            case '[': return liste();
            case '"': return texte();
            case 't': mot("true"); return Boolean.TRUE;
            case 'f': mot("false"); return Boolean.FALSE;
            case 'n': mot("null"); return null;
            default: return nombre();
        }
    }

    private void mot(String m) {
        if (!s.startsWith(m, i)) {
            throw erreur("valeur inconnue");
        }
        i += m.length();
    }

    private Map<String, Object> objet() {
        Map<String, Object> m = new LinkedHashMap<>();
        i++;
        blancs();
        if (i < s.length() && s.charAt(i) == '}') {
            i++;
            return m;
        }
        while (true) {
            blancs();
            if (i >= s.length() || s.charAt(i) != '"') {
                throw erreur("clé attendue");
            }
            String k = texte();
            blancs();
            if (i >= s.length() || s.charAt(i) != ':') {
                throw erreur("« : » attendu");
            }
            i++;
            blancs();
            m.put(k, valeur());
            blancs();
            if (i < s.length() && s.charAt(i) == ',') {
                i++;
            } else if (i < s.length() && s.charAt(i) == '}') {
                i++;
                return m;
            } else {
                throw erreur("« , » ou « } » attendu");
            }
        }
    }

    private List<Object> liste() {
        List<Object> l = new ArrayList<>();
        i++;
        blancs();
        if (i < s.length() && s.charAt(i) == ']') {
            i++;
            return l;
        }
        while (true) {
            blancs();
            l.add(valeur());
            blancs();
            if (i < s.length() && s.charAt(i) == ',') {
                i++;
            } else if (i < s.length() && s.charAt(i) == ']') {
                i++;
                return l;
            } else {
                throw erreur("« , » ou « ] » attendu");
            }
        }
    }

    private String texte() {
        StringBuilder b = new StringBuilder();
        i++;
        while (i < s.length()) {
            char c = s.charAt(i++);
            if (c == '"') {
                return b.toString();
            }
            if (c != '\\') {
                b.append(c);
                continue;
            }
            if (i >= s.length()) {
                break;
            }
            char e = s.charAt(i++);
            switch (e) {
                case 'n': b.append('\n'); break;
                case 'r': b.append('\r'); break;
                case 't': b.append('\t'); break;
                case 'b': b.append('\b'); break;
                case 'f': b.append('\f'); break;
                case 'u':
                    if (i + 4 > s.length()) {
                        throw erreur("\\u incomplet");
                    }
                    b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                    i += 4;
                    break;
                default: b.append(e);
            }
        }
        throw erreur("texte non terminé");
    }

    private Double nombre() {
        int d = i;
        while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) {
            i++;
        }
        if (d == i) {
            throw erreur("valeur attendue");
        }
        try {
            return Double.valueOf(s.substring(d, i));
        } catch (NumberFormatException e) {
            throw erreur("nombre illisible");
        }
    }
}
