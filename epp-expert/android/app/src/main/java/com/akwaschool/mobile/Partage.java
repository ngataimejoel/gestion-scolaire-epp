package com.akwaschool.mobile;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * Fichiers que l'application confie à une autre (WhatsApp, Gmail…) par « Partager » : seulement ceux du dossier
 * cache/partage, en lecture seule, et seulement pour l'application à qui le lien est donné (non exporté,
 * permission accordée au cas par cas).
 */
public class Partage extends ContentProvider {
    static final String AUTORITE = "com.akwaschool.mobile.partage";

    static File dossier(Context c) {
        File d = new File(c.getCacheDir(), "partage");
        if (!d.isDirectory() && !d.mkdirs()) {
            return c.getCacheDir();
        }
        return d;
    }

    static Uri lien(String nom) {
        return new Uri.Builder().scheme("content").authority(AUTORITE).appendPath(nom).build();
    }

    private File fichier(Uri uri) throws FileNotFoundException {
        String nom = uri.getLastPathSegment();
        if (nom == null || nom.contains("/") || nom.startsWith(".")) {
            throw new FileNotFoundException();
        }
        File f = new File(dossier(getContext()), nom);
        try {
            if (!f.getCanonicalPath().startsWith(dossier(getContext()).getCanonicalPath() + File.separator) || !f.isFile()) {
                throw new FileNotFoundException();
            }
        } catch (IOException e) {
            throw new FileNotFoundException();
        }
        return f;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (mode == null || !mode.startsWith("r") || mode.contains("w")) {
            throw new FileNotFoundException("lecture seule");
        }
        return ParcelFileDescriptor.open(fichier(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] colonnes, String selection, String[] args, String tri) {
        File f;
        try {
            f = fichier(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        c.addRow(new Object[]{f.getName(), f.length()});
        return c;
    }

    @Override
    public String getType(Uri uri) {
        String n = uri.getLastPathSegment() == null ? "" : uri.getLastPathSegment();
        return n.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "application/octet-stream";
    }

    @Override
    public Uri insert(Uri uri, ContentValues valeurs) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues valeurs, String selection, String[] args) {
        return 0;
    }
}
