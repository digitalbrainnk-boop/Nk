package com.digitalbrainnk.dimensionnement;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.Collections;

/**
 * Affiche l'application web embarquée (assets/www) dans une WebView.
 *
 * Les fichiers sont servis sous https://appassets.androidplatform.net/ : origine sécurisée et stable, donc les
 * projets enregistrés par la page (localStorage) sont conservés d'une ouverture à l'autre et lors des mises à jour.
 * Tout fonctionne hors connexion ; seul l'assistant IA (clé API facultative) appelle internet.
 */
public class MainActivity extends Activity {
    static final String HOTE = "appassets.androidplatform.net";
    static final String ACCUEIL = "https://" + HOTE + "/index.html";
    private static final int CHOIX_FICHIER = 1;
    private static final int DEMANDE_POSITION = 2;
    private static final Charset UTF8 = Charset.forName("UTF-8");

    private WebView vue;
    private ValueCallback<Uri[]> rappelFichier;
    private GeolocationPermissions.Callback rappelPosition;
    private String originePosition;

    @Override
    protected void onCreate(Bundle etat) {
        super.onCreate(etat);
        vue = new WebView(this);
        setContentView(vue);

        WebSettings reglages = vue.getSettings();
        reglages.setJavaScriptEnabled(true);
        reglages.setDomStorageEnabled(true);
        reglages.setAllowFileAccess(false);
        reglages.setSupportMultipleWindows(false);
        reglages.setTextZoom(100);
        reglages.setCacheMode(WebSettings.LOAD_NO_CACHE);
        reglages.setGeolocationEnabled(true);

        vue.addJavascriptInterface(new Pont(), "AndroidApp");
        vue.setWebViewClient(new Client());
        vue.setWebChromeClient(new Chrome());
        vue.loadUrl(ACCUEIL);
    }

    @Override
    protected void onDestroy() {
        if (vue != null) {
            vue.destroy();
            vue = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int code, int resultat, Intent donnees) {
        if (code == CHOIX_FICHIER) {
            if (rappelFichier != null) {
                rappelFichier.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultat, donnees));
                rappelFichier = null;
            }
            return;
        }
        super.onActivityResult(code, resultat, donnees);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] resultats) {
        if (code == DEMANDE_POSITION && rappelPosition != null) {
            boolean accordee = false;
            for (int r : resultats) {
                if (r == PackageManager.PERMISSION_GRANTED) {
                    accordee = true;
                }
            }
            rappelPosition.invoke(originePosition, accordee, false);
            rappelPosition = null;
            originePosition = null;
        }
    }

    boolean positionAutorisee() {
        return Build.VERSION.SDK_INT < 23
                || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Liens externes (PVGIS, NASA POWER, téléchargements) : navigateur du téléphone. */
    boolean ouvrirExterne(Uri adresse) {
        if (adresse == null || HOTE.equals(adresse.getHost())) {
            return false;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, adresse));
        } catch (ActivityNotFoundException e) {
            // aucune application ne sait ouvrir ce lien : on reste dans l'application
        }
        return true;
    }

    static String typeMime(String chemin) {
        String c = chemin.toLowerCase();
        if (c.endsWith(".html")) return "text/html";
        if (c.endsWith(".js")) return "text/javascript";
        if (c.endsWith(".css")) return "text/css";
        if (c.endsWith(".json") || c.endsWith(".webmanifest")) return "application/json";
        if (c.endsWith(".svg")) return "image/svg+xml";
        if (c.endsWith(".png")) return "image/png";
        if (c.endsWith(".woff2")) return "font/woff2";
        if (c.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest requete) {
            Uri adresse = requete.getUrl();
            if (!HOTE.equals(adresse.getHost())) {
                return null;
            }
            String chemin = adresse.getPath();
            if (chemin == null || chemin.isEmpty() || "/".equals(chemin)) {
                chemin = "/index.html";
            }
            String type = typeMime(chemin);
            String encodage = type.startsWith("text/") || type.equals("application/json") || type.equals("image/svg+xml") ? "utf-8" : null;
            try {
                InputStream flux = getAssets().open("www" + chemin);
                WebResourceResponse reponse = new WebResourceResponse(type, encodage, flux);
                reponse.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-cache"));
                return reponse;
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                        Collections.<String, String>emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest requete) {
            return ouvrirExterne(requete.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView v, String adresse) {
            return ouvrirExterne(Uri.parse(adresse));
        }
    }

    private class Chrome extends WebChromeClient {
        /** « Utiliser ma position » : autorisation Android demandée au premier usage. */
        @Override
        public void onGeolocationPermissionsShowPrompt(String origine, GeolocationPermissions.Callback rappel) {
            if (positionAutorisee()) {
                rappel.invoke(origine, true, false);
                return;
            }
            if (rappelPosition != null) {
                rappelPosition.invoke(originePosition, false, false);
            }
            rappelPosition = rappel;
            originePosition = origine;
            requestPermissions(new String[] {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, DEMANDE_POSITION);
        }

        /** « Importer un projet (.json) » : sélecteur de fichiers du téléphone. */
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> rappel, FileChooserParams parametres) {
            if (rappelFichier != null) {
                rappelFichier.onReceiveValue(null);
            }
            rappelFichier = rappel;
            Intent intention = new Intent(Intent.ACTION_GET_CONTENT);
            intention.addCategory(Intent.CATEGORY_OPENABLE);
            intention.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(intention, "Choisir un projet (.json)"), CHOIX_FICHIER);
                return true;
            } catch (ActivityNotFoundException e) {
                rappelFichier = null;
                return false;
            }
        }
    }

    private void partagerFichier(Uri adresse, String type, String nom) {
        Intent intention = new Intent(Intent.ACTION_SEND);
        intention.setType(type);
        intention.putExtra(Intent.EXTRA_STREAM, adresse);
        intention.putExtra(Intent.EXTRA_SUBJECT, nom);
        intention.setClipData(ClipData.newRawUri(nom, adresse));
        intention.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(intention, "Envoyer « " + nom + " »"));
        } catch (ActivityNotFoundException e) {
            // pas d'application de partage : le fichier reste dans Téléchargements (Android 10 et plus)
        }
    }

    /** Fonctions appelées par la page (window.AndroidApp). */
    public class Pont {
        /** Enregistre un export dans Téléchargements (Android 10 et plus) et propose de l'envoyer. */
        @JavascriptInterface
        public String enregistrer(String nom, String contenu, String type) {
            final String nomSur = nom == null ? "export.txt" : nom.replaceAll("[^A-Za-z0-9._-]", "_");
            final String typeSur = type == null || type.isEmpty() ? "application/octet-stream" : type;
            byte[] octets = (contenu == null ? "" : contenu).getBytes(UTF8);
            boolean dansTelechargements = false;
            try {
                File dossier = new File(getCacheDir(), "exports");
                if (!dossier.isDirectory() && !dossier.mkdirs()) {
                    throw new IOException("dossier d'export impossible à créer");
                }
                FileOutputStream sortie = new FileOutputStream(new File(dossier, nomSur));
                try {
                    sortie.write(octets);
                } finally {
                    sortie.close();
                }
                if (Build.VERSION.SDK_INT >= 29) {
                    dansTelechargements = enregistrerDansTelechargements(nomSur, typeSur, octets);
                }
            } catch (Exception e) {
                return "Enregistrement impossible : " + e.getMessage();
            }
            final Uri adresse = Uri.parse("content://" + FichiersProvider.AUTORITE + "/" + Uri.encode(nomSur));
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    partagerFichier(adresse, typeSur, nomSur);
                }
            });
            return dansTelechargements
                    ? "Fichier « " + nomSur + " » enregistré dans Téléchargements."
                    : "Fichier « " + nomSur + " » prêt à être envoyé.";
        }

        /** Partage d'un texte (message et liens de l'application). */
        @JavascriptInterface
        public void partagerTexte(final String titre, final String texte) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent intention = new Intent(Intent.ACTION_SEND);
                    intention.setType("text/plain");
                    intention.putExtra(Intent.EXTRA_SUBJECT, titre);
                    intention.putExtra(Intent.EXTRA_TEXT, texte);
                    try {
                        startActivity(Intent.createChooser(intention, titre));
                    } catch (ActivityNotFoundException e) {
                        // aucune application de partage
                    }
                }
            });
        }
    }

    private boolean enregistrerDansTelechargements(String nom, String type, byte[] octets) throws IOException {
        ContentResolver resolveur = getContentResolver();
        ContentValues valeurs = new ContentValues();
        valeurs.put(MediaStore.MediaColumns.DISPLAY_NAME, nom);
        valeurs.put(MediaStore.MediaColumns.MIME_TYPE, type);
        valeurs.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        Uri adresse = resolveur.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valeurs);
        if (adresse == null) {
            return false;
        }
        OutputStream sortie = resolveur.openOutputStream(adresse);
        if (sortie == null) {
            return false;
        }
        try {
            sortie.write(octets);
        } finally {
            sortie.close();
        }
        return true;
    }
}
