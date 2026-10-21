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
