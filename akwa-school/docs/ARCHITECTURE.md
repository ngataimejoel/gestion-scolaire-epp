# Architecture d’AKWA SCHOOL 2

## Principes

- **Hors ligne, sans serveur, sans CDN** : tout le code, les styles, les polices système et les images sont
  dans un seul fichier `dist/AKWA_SCHOOL.html`, ouvrable par double-clic (`file://`).
- **Sources modulaires** (`src/`), assemblées par `tools/build.mjs` (Node 18+, aucune dépendance) dans
  l’ordre du manifeste `src/manifest.json`. Les scripts sont des IIFE classiques qui enrichissent
  `window.AK` : les modules ES ne fonctionnent pas en `file://`.
- **Une seule source de vérité pour chaque règle** : les règles métier et les droits sont vérifiés dans
  les fonctions métier, jamais seulement dans l’interface.
- **HTML sûr par construction** : gabarit étiqueté `u.html` qui échappe toute valeur ; `u.raw` est réservé
  au balisage produit par le code.

## Couches (A à K)

| Couche | Rôle | Fichiers |
|---|---|---|
| A. Interface | composants, tableaux, fenêtres, notifications, écrans | `src/js/ui/composants.js`, `tableau.js`, `dialogues.js`, `src/js/screens/*.js`, `src/styles/*.css` |
| B. Navigation | menu, onglets, adresse `#section/onglet?param=…`, recherche globale, tiroir de fiche | `src/js/ui/shell.js`, `src/js/ui/app.js` (démarrage, assistant, connexion, verrouillage) |
| C. Logique métier | élèves, personnel, notes, absences, vie scolaire, finances, services | `src/js/domain/*.js`, `src/js/domain/calc.js` (calculs purs) |
| D. Validation | noms, matricules, dates, classes, années, téléphones, notes, références (clé de contrôle) | `src/js/core/validate.js` |
| E. Utilisateurs et droits | session, comptes, mots de passe (PBKDF2), droits par action | `src/js/security/auth.js`, `perm.js` |
| F. Persistance | IndexedDB (images à part), repli localStorage / mémoire, fichiers natifs (Android), copies de sécurité | `src/js/data/storage.js`, `store.js`, `host.js` |
| G. Documents | modèles versionnés, champs dynamiques, mise en page A4/A5/paysage, pagination, signatures | `src/js/docs/modeles.js`, `mise-en-page.js`, `generateur.js`, `src/js/docs/modeles/*.js`, `rapports.js` |
| H. Impression / export | aperçu physique, zone d’impression, PDF (natif ou boîte d’impression), cartes et planches | `src/js/docs/impression.js`, `cartes.js`, `src/styles/05-documents.css`, `06-cartes.css`, `07-impression.css` |
| I. QR et vérification | contenu minimal signé, lecture d’images, moteur de vérification, outil autonome | `src/js/docs/qr.js`, `qrdecode.js`, `verification.js`, `registre.js`, `src/js/security/keys.js`, `crypto.js`, `src/verifier/` |
| J. Journal et diagnostic | journal des opérations (sans données inutiles), erreurs techniques, rapport de diagnostic | `src/js/data/store.js` (journaliser), `src/js/core/diag.js` |
| K. Sauvegarde, restauration, migration | sauvegarde avec empreinte SHA-256, analyse avant restauration, migration 1.x → 2 | `src/js/data/backup.js`, `schema.js`, `src/js/domain/import.js` |

Paramètres centralisés : `src/js/core/config.js` (référentiels, grilles, barèmes, listes, sécurité),
`src/js/core/referentiels.js` (sous-préfectures, nationalités).

## Données

État unique `AK.store.etat`, sérialisé en JSON (schéma 6, compatible au-delà avec le format 1.x `v:5`) :

- `school` (identité, en-tête, niveaux, année, réglages), `students`, `teachers`, `grades`
  (`<élève>|<évaluation>|<matière>`), `compAbs`, `att`, `appel`, `auth`, `conges`, `attente`, `saisie`,
  `archives`, `pro` (vie scolaire, finances, services, journal), `messages` ;
- nouveautés : `meta` (schéma, installation, démonstration), `securite` (empreintes des mots de passe,
  jamais de mot de passe en clair), `docs` (registre des documents), `modeles` (personnalisations),
  `cles` (clés publiques et clé privée **chiffrée**), `corbeille`.

Enregistrement : différé de 300 ms après chaque modification (`AK.store.modifier`), écriture
transactionnelle, état visible en haut de l’écran (« Enregistré / Non enregistré ») et bandeau d’erreur
avec « Réessayer » ; copie de sécurité quotidienne (14 conservées) et avant chaque opération risquée
(10 conservées) ; demande de stockage persistant au navigateur.

## Flux d’un document officiel

1. L’écran appelle `AK.docs.ouvrir(modèle, contextes, options)`.
2. L’aperçu est un **brouillon** : référence et QR « attribués à l’impression » ; rien n’est inscrit au
   registre si l’aperçu est fermé.
3. À l’impression (ou à l’export PDF), `AK.registre.emettre` attribue la référence
   `AK-<TYPE>-<ANNÉE>-<NNNNNN>-<clé>`, calcule l’empreinte du titulaire et du contenu, signe le QR
   (ECDSA P-256) si la clé de l’école est déverrouillée, puis les feuilles définitives remplacent
   l’aperçu.
4. Copie, duplicata et annulation passent par le registre (historique, motif, auteur) ; une copie n’est
   possible que si les données n’ont pas changé depuis l’émission (empreinte identique).

## Hôtes d’exécution

`src/js/data/host.js` choisit l’hôte : navigateur, application Windows PySide6 (QWebChannel),
emballage générique `AkwaNatif` (Electron) ou application Android existante (`AkwaNative`).
Voir `packaging/README.md`.

## Construction

```
node tools/build.mjs                    # dist/AKWA_SCHOOL.html (+ modèle de l’outil de vérification)
node tools/build.mjs --verifier         # contrôle de syntaxe seulement
node tools/build.mjs --ajouter js/screens/x.js --css styles/screens/x.css --sortie /tmp/x.html
```

Le script refuse toute séquence `</script` ou `</style` dans les fichiers inclus et vérifie la syntaxe de
chaque script avant l’assemblage.
