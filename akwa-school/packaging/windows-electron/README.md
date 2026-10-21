# AKWA SCHOOL 2 — installateur Windows (.exe) avec Electron

> **Statut : non construit ni exécuté dans l’environnement de développement** (le registre npm y est
> inaccessible). La partie page du contrat (`AkwaNatif`) est testée avec un pont simulé
> (`tests/e2e/hotes.test.cjs`, 26/26). Construisez et vérifiez sous Windows avant diffusion.

## Construire

Prérequis : Windows 10/11 64 bits, Node.js 20 LTS ou plus récent.

```powershell
cd akwa-school\packaging\windows-electron
npm install
npm run demarrer      # essai : construit dist\AKWA_SCHOOL.html, le copie dans app\ et ouvre la fenêtre
npm run exe           # installateur : sortie\AKWA-SCHOOL-Setup-2.0.0.exe
```

Signature du code (recommandée pour éviter l’avertissement SmartScreen) : renseignez
`CSC_LINK` et `CSC_KEY_PASSWORD` avant `npm run exe` (certificat de signature de code).

## Ce que fait l’emballage

| Fonction de la page | Réalisation Windows |
|---|---|
| Enregistrer un fichier (sauvegarde, CSV, outil de vérification) | boîte « Enregistrer sous » ; dossier Documents proposé |
| Imprimer | boîte d’impression de Windows (A4, paysage, cartes : formats `@page` de la page) |
| **PDF** | **vrai fichier PDF** produit par `printToPDF` (pas la boîte d’impression) |
| Caméra (lecture des QR codes) | autorisée ; toute autre permission refusée |
| Données | IndexedDB dans `%APPDATA%\AKWA SCHOOL` ; conservées à la mise à jour et à la désinstallation |
| Liens `tel:`, `sms:`, `mailto:`, `https:` | ouverts par Windows, jamais dans la fenêtre de l’application |

Sécurité : `contextIsolation`, `sandbox`, aucune API Node exposée à la page, une seule instance
(deux fenêtres écriraient dans la même base).

## À vérifier sous Windows (liste de recette)

1. Premier lancement : assistant, création de l’école, code de secours.
2. Fermer puis rouvrir : données retrouvées.
3. Sauvegarde exportée puis restaurée sur un autre poste.
4. Impression d’un bulletin (A4), d’un reçu (A5), d’une planche de cartes (vérifier 85,6 × 54 mm à la règle).
5. Bouton PDF : fichier PDF lisible, formats respectés, filigranes présents.
6. Caméra : lecture du QR d’une carte imprimée.
7. Mise à jour par un nouvel installateur : données conservées.
