package com.akwaschool.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.IntentSender;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.media.ExifInterface;
import android.net.Uri;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;

/**
 * Scan d'une feuille de notes ou d'un extrait de naissance : prise de vue avec le scanner de documents d'Android
 * (bords détectés, page redressée, nettoyée), sinon une photo de la galerie ; l'image est encore retravaillée
 * (orientation, gris, contraste) puis lue sur le téléphone, sans Internet (ML Kit). Le texte est renvoyé ligne par
 * ligne avec sa position : l'interface le remet en ordre (tableau de notes, champs de l'extrait).
 */
final class Scan {
    static final int SCANNER = 43;
    static final int GALERIE = 44;
    private static final int COTE_MAX = 2400;

    interface Retour {
        void fini(String json);
    }

    private Scan() {
    }

    /** Ouvre le scanner de documents ; s'il n'existe pas sur ce téléphone, la galerie. */
    static void lancer(Activity a, boolean galerie, Retour echec) {
        if (galerie) {
            ouvrirGalerie(a, echec);
            return;
        }
        GmsDocumentScannerOptions o = new GmsDocumentScannerOptions.Builder()
                .setGalleryImportAllowed(true)
                .setPageLimit(1)
                .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
                .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
                .build();
        GmsDocumentScanning.getClient(o).getStartScanIntent(a)
                .addOnSuccessListener(envoi -> {
                    try {
                        a.startIntentSenderForResult(envoi, SCANNER, null, 0, 0, 0);
                    } catch (IntentSender.SendIntentException e) {
                        ouvrirGalerie(a, echec);
                    }
                })
                .addOnFailureListener(e -> ouvrirGalerie(a, echec));
    }

    private static void ouvrirGalerie(Activity a, Retour echec) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
        try {
            a.startActivityForResult(i, GALERIE);
        } catch (RuntimeException e) {
            echec.fini(Pont.erreurJson("Aucune application ne permet de choisir une photo sur ce téléphone."));
        }
    }

    /** Image choisie : celle du scanner (première page) ou de la galerie. */
    static Uri image(int demande, Intent donnees) {
        if (donnees == null) {
            return null;
        }
        if (demande == SCANNER) {
            GmsDocumentScanningResult r = GmsDocumentScanningResult.fromActivityResultIntent(donnees);
            if (r == null || r.getPages() == null || r.getPages().isEmpty()) {
                return null;
            }
            return r.getPages().get(0).getImageUri();
        }
        return donnees.getData();
    }

    /** Lit l'image (hors du fil de l'interface), la retravaille et renvoie le texte reconnu. */
    static void lire(Activity a, Uri uri, Retour retour) {
        Bitmap b;
        try {
            b = preparer(a, uri);
        } catch (IOException | RuntimeException e) {
            retour.fini(Pont.erreurJson("Photo illisible : " + e.getMessage()));
            return;
        }
        final Bitmap image = b;
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).process(InputImage.fromBitmap(image, 0))
                .addOnSuccessListener(t -> {
                    try {
                        retour.fini(versJson(t, image.getWidth(), image.getHeight()));
                    } catch (JSONException e) {
                        retour.fini(Pont.erreurJson("Lecture impossible."));
                    }
                })
                .addOnFailureListener(e -> retour.fini(Pont.erreurJson(
                        "Lecture du texte impossible sur ce téléphone : " + e.getMessage())));
    }

    /** Image réduite, remise droite (EXIF), en niveaux de gris et au contraste étiré (2 % – 98 %). */
    static Bitmap preparer(Activity a, Uri uri) throws IOException {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        try (InputStream in = a.getContentResolver().openInputStream(uri)) {
            BitmapFactory.decodeStream(in, null, o);
        }
        int cote = Math.max(o.outWidth, o.outHeight), echant = 1;
        while (cote / (echant * 2) >= COTE_MAX) {
            echant *= 2;
        }
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = echant;
        Bitmap b;
        try (InputStream in = a.getContentResolver().openInputStream(uri)) {
            b = BitmapFactory.decodeStream(in, null, o2);
        }
        if (b == null) {
            throw new IOException("format d'image inconnu");
        }
        int rotation = 0;
        try (InputStream in = a.getContentResolver().openInputStream(uri)) {
            if (in != null) {
                int or = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION,
                        ExifInterface.ORIENTATION_NORMAL);
                rotation = or == ExifInterface.ORIENTATION_ROTATE_90 ? 90 : or == ExifInterface.ORIENTATION_ROTATE_180
                        ? 180 : or == ExifInterface.ORIENTATION_ROTATE_270 ? 270 : 0;
            }
        } catch (IOException | RuntimeException ignore) {
            // pas d'EXIF : image laissée telle quelle
        }
        float f = Math.min(1f, (float) COTE_MAX / Math.max(b.getWidth(), b.getHeight()));
        if (rotation != 0 || f < 1f) {
            Matrix m = new Matrix();
            m.postScale(f, f);
            m.postRotate(rotation);
            b = Bitmap.createBitmap(b, 0, 0, b.getWidth(), b.getHeight(), m, true);
        }
        return contraste(b);
    }

    private static Bitmap contraste(Bitmap b) {
        int w = b.getWidth(), h = b.getHeight();
        int[] px = new int[w * h];
        b.getPixels(px, 0, w, 0, 0, w, h);
        int[] histo = new int[256];
        for (int i = 0; i < px.length; i++) {
            int c = px[i];
            int g = (((c >> 16) & 255) * 299 + ((c >> 8) & 255) * 587 + (c & 255) * 114) / 1000;
            px[i] = g;
            histo[g]++;
        }
        int bas = 0, haut = 255, cumul = 0, seuil = px.length / 50;
        while (bas < 254 && (cumul += histo[bas]) < seuil) {
            bas++;
        }
        cumul = 0;
        while (haut > bas + 1 && (cumul += histo[haut]) < seuil) {
            haut--;
        }
        float k = 255f / Math.max(1, haut - bas);
        for (int i = 0; i < px.length; i++) {
            int g = Math.max(0, Math.min(255, Math.round((px[i] - bas) * k)));
            px[i] = 0xFF000000 | (g << 16) | (g << 8) | g;
        }
        Bitmap r = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        r.setPixels(px, 0, w, 0, 0, w, h);
        return r;
    }

    private static JSONObject boite(String t, Rect r) throws JSONException {
        JSONObject o = new JSONObject().put("t", t);
        if (r != null) {
            o.put("x", r.left).put("y", r.top).put("w", r.width()).put("h", r.height());
        }
        return o;
    }

    private static String versJson(Text t, int largeur, int hauteur) throws JSONException {
        JSONArray lignes = new JSONArray();
        for (Text.TextBlock bloc : t.getTextBlocks()) {
            for (Text.Line l : bloc.getLines()) {
                JSONObject o = boite(l.getText(), l.getBoundingBox());
                JSONArray mots = new JSONArray();
                for (Text.Element e : l.getElements()) {
                    mots.put(boite(e.getText(), e.getBoundingBox()));
                }
                lignes.put(o.put("mots", mots));
            }
        }
        return new JSONObject().put("ok", true).put("largeur", largeur).put("hauteur", hauteur)
                .put("lignes", lignes).toString();
    }
}
