# AKWA SCHOOL 2 — application Android (APK)

L’application Android existante du dépôt (`epp-expert/android`, paquet `com.akwaschool.mobile`)
expose déjà à sa page le pont Java **`AkwaNative`** (`Pont.java`). AKWA SCHOOL 2 le reconnaît
directement (`src/js/data/host.js`, hôte « android ») : **aucune modification Java n’est
indispensable**.

> **Statut : APK non construit dans l’environnement de développement** (Gradle et le SDK Android n’y
> sont pas disponibles). Le comportement de la page avec ce pont est testé avec une imitation fidèle de
> `Pont.java` (`tests/e2e/hotes.test.cjs` : stockage, copies, images, fichiers, impression, reprise des
> données 1.x du téléphone). Vérifiez sur un vrai téléphone avant diffusion.

## Intégration

1. Construire la page : `node akwa-school/tools/build.mjs` → `akwa-school/dist/AKWA_SCHOOL.html`.
2. Remplacer `epp-expert/android/app/src/main/assets/www/index.html` par ce fichier (même nom
   `index.html`). `pont_android.js` (adaptateur de l’ancienne interface v8) n’est plus chargé ; il peut
   rester dans le dossier ou être retiré.
3. Augmenter `versionCode` / `versionName` dans `app/build.gradle`.
4. Construire et **signer avec la clé AKWA SCHOOL habituelle** : `Integrite.java` refuse de démarrer
   une application signée par une autre clé.

## Comportement sur le téléphone

| Fonction | Réalisation |
|---|---|
| Données | fichiers privés de l’application : `akwa2_etat.json`, images `i_*.json` (une par photo, écrites une fois), copies de sécurité `akwa2_c_*.json` (14 quotidiennes + 10 avant opération) — écriture atomique côté Java |
| Données de l’ancienne application (`etat_v8.json`) | proposées à la reprise au premier lancement, **jamais effacées** ; le mot de passe du directeur (gardé par l’ancienne application) est redemandé |
| Enregistrer un fichier | sélecteur d’Android (Téléchargements, Drive, carte SD…) ; annulation sans erreur |
| Imprimer / PDF | service d’impression d’Android, qui propose « Enregistrer au format PDF » |
| Importer un fichier, une photo | sélecteur de fichiers déjà géré par `MainActivity` |

## Caméra pour la vérification des QR codes (facultatif)

La page sait lire un QR depuis une **photo importée** (sélecteur de fichiers). Pour le scan en direct,
il faut autoriser la caméra dans la WebView :

1. `AndroidManifest.xml` : `<uses-permission android:name="android.permission.CAMERA" />`
2. Dans le `WebChromeClient` de `MainActivity` :

```java
@Override
public void onPermissionRequest(final android.webkit.PermissionRequest r) {
    runOnUiThread(() -> {
        if (java.util.Arrays.asList(r.getResources()).contains(android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                && checkSelfPermission(android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            r.grant(new String[]{android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            requestPermissions(new String[]{android.Manifest.permission.CAMERA}, 46);
            r.deny();   // la page propose alors l’import d’une photo
        }
    });
}
```

Sans cette modification, le bouton « Scanner avec la caméra » affiche un message clair et
l’import de photo reste disponible.
