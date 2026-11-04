package com.digitalbrainnk.dimensionnement;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Donne accès en lecture seule aux fichiers exportés (cache/exports) pour les envoyer à une autre application
 * (WhatsApp, e-mail…). Les permissions sont accordées au cas par cas par l'intention de partage.
 */
public class FichiersProvider extends ContentProvider {
    static final String AUTORITE = "com.digitalbrainnk.dimensionnement.fichiers";

    @Override
    public boolean onCreate() {
        return true;
    }

    private File fichier(Uri adresse) throws FileNotFoundException {
        String nom = adresse.getLastPathSegment();
        if (nom == null || nom.isEmpty() || nom.contains("/") || nom.startsWith(".")) {
            throw new FileNotFoundException("nom de fichier invalide");
        }
        File f = new File(new File(getContext().getCacheDir(), "exports"), nom);
        if (!f.isFile()) {
            throw new FileNotFoundException(nom);
        }
        return f;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri adresse, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(fichier(adresse), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri adresse) {
        String nom = adresse.getLastPathSegment();
        if (nom == null) return "application/octet-stream";
        if (nom.endsWith(".html")) return "text/html";
        if (nom.endsWith(".csv")) return "text/csv";
        if (nom.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    @Override
    public Cursor query(Uri adresse, String[] colonnes, String selection, String[] arguments, String tri) {
        File f;
        try {
            f = fichier(adresse);
        } catch (FileNotFoundException e) {
            return null;
        }
        MatrixCursor curseur = new MatrixCursor(new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        curseur.addRow(new Object[] {f.getName(), f.length()});
        return curseur;
    }

    @Override
    public Uri insert(Uri adresse, ContentValues valeurs) {
        throw new UnsupportedOperationException("lecture seule");
    }

    @Override
    public int update(Uri adresse, ContentValues valeurs, String selection, String[] arguments) {
        throw new UnsupportedOperationException("lecture seule");
    }

    @Override
    public int delete(Uri adresse, String selection, String[] arguments) {
        throw new UnsupportedOperationException("lecture seule");
    }
}
