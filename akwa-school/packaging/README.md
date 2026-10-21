# Emballages d’AKWA SCHOOL 2

La même page (`dist/AKWA_SCHOOL.html`) fonctionne dans quatre environnements ; elle détecte
seule le sien (`src/js/data/host.js`) :

| Environnement | Détection | Données | Dossier |
|---|---|---|---|
| Navigateur (double-clic sur le fichier) | par défaut | IndexedDB du navigateur | — |
| **Windows .exe (Electron)** | `window.AkwaNatif` | IndexedDB du profil de l’application | `windows-electron/` |
| **Android (APK existant)** | `window.AkwaNative` | fichiers privés de l’application | `android/` |
| Windows (application PySide6 v8 existante) | `QWebChannel` + `APP_DATA` | base de l’application Windows | `windows-pyside6.md` |

Contrat minimal d’un nouvel emballage (`AkwaNatif`) : `enregistrerFichier(nom, base64, mime)`
obligatoire ; `imprimer(paysage)`, `exporterPdf(nom, paysage)`, `version()` facultatifs.

## Construction automatique (.exe et .apk)

Le workflow GitHub Actions **« AKWA SCHOOL 2 - Windows (.exe) et Android (.apk) »**
(`.github/workflows/akwa-school-2.yml`) se lance à chaque envoi qui touche `akwa-school/`, ou à la main
(onglet *Actions › Run workflow*). Il produit, dans les **Artifacts** de l’exécution :

- `AKWA-SCHOOL-2-Windows` : installateur `AKWA-SCHOOL-Setup-2.0.0.exe` et version portable
  `AKWA-SCHOOL-Portable-2.0.0.exe` (non signés : Windows SmartScreen demandera « Exécuter quand même ») ;
  l’exécutable est auto-testé sur Windows (`--auto-test` : démarrage, contrat `AkwaNatif`, vrai PDF) ;
- `AKWA-SCHOOL-2-Android` : APK construit dans la coquille Android du dépôt (`epp-expert/android`),
  signé avec la clé de publication (secrets `ANDROID_KEYSTORE_*`), sous l’identifiant
  `com.akwaschool.ecole2` et le nom « AKWA SCHOOL 2 » : il s’installe **à côté** de l’application v8
  sans la remplacer. Pour qu’il la remplace (et reprenne son fichier `etat_v8.json`), retirer du workflow
  les lignes qui changent l’identifiant et l’autorité de partage — l’application v8 perdrait alors sa
  synchronisation Wi-Fi, sa licence et son code PIN, que la version 2 ne reprend pas ;
- `AKWA-SCHOOL-2-HTML` : la page seule et l’outil de vérification autonome.

Les tests unitaires et de bout en bout (Chromium) tournent dans la même exécution.
Limite connue de la coquille Android : elle n’autorise pas la caméra dans la page ; la vérification
d’un QR code s’y fait en important une photo du QR (bouton « Importer une photo du QR »).
