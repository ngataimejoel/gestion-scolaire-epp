# AKWA SCHOOL 2

Gestion scolaire de l’école primaire (EPP, Côte d’Ivoire), **hors ligne**, dans un seul fichier HTML :
élèves, personnel, notes et bulletins, absences, vie scolaire, finances, services, documents officiels
avec registre et QR codes vérifiables, cartes d’identification, rapports, sauvegarde.

## Utiliser

1. Ouvrir `dist/AKWA_SCHOOL.html` (double-clic) avec Chrome, Edge ou Firefox récent.
2. Au premier lancement : créer l’école, reprendre les données d’AKWA SCHOOL 1.x, restaurer une
   sauvegarde ou découvrir l’école de démonstration (directeur : `Demo2026`, enseignants : `Classe2026`).
3. Noter le **code de secours** affiché une seule fois.
4. Exporter régulièrement une sauvegarde sur clé USB (Données › Sauvegarde).

Guide d’utilisation : [`docs/GUIDE.md`](docs/GUIDE.md).

## Construire

Node.js 18 ou plus récent, aucune dépendance :

```
node tools/build.mjs        # → dist/AKWA_SCHOOL.html et dist/AKWA_SCHOOL_verification_modele.html
```

Installateur Windows et application Android : [`packaging/README.md`](packaging/README.md).

## Tester

```
node --test tests/unit/*.test.cjs           # modules purs (calculs, validation, QR, signature, migration)
node tests/e2e/routes.test.cjs              # tous les écrans (Playwright + Chromium)
node tests/e2e/documents.test.cjs           # chaîne documentaire complète
node tests/e2e/qr.test.cjs                  # lecteur de QR codes hors ligne
node tests/e2e/hotes.test.cjs               # Android, Windows, emballage générique (ponts simulés)
```

Résultats et périmètre : [`docs/TESTS.md`](docs/TESTS.md).

## Documentation

| Document | Contenu |
|---|---|
| [`docs/AUDIT.md`](docs/AUDIT.md) | audit de la version 1.7.0 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | couches, données, flux, construction |
| [`docs/SECURITE.md`](docs/SECURITE.md) | protections réelles et limites |
| [`docs/MODELES.md`](docs/MODELES.md) | modèles de documents, champs dynamiques, filigranes |
| [`docs/GUIDE.md`](docs/GUIDE.md) | guide d’utilisation |
| [`docs/TESTS.md`](docs/TESTS.md) | rapport de tests |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | conservé, corrigé, amélioré, remplacé, retiré |

## Structure

```
src/
  index.html            coque minimale
  manifest.json         ordre d’assemblage des scripts et styles
  styles/               jetons de couleur, composants, écrans, documents, cartes, impression
  js/core/              espace de noms, utilitaires, configuration, validation, diagnostic
  js/data/              schéma et migration, stockage, état, hôtes, sauvegarde
  js/security/          chiffrement, comptes, droits, clés de signature
  js/domain/            règles métier
  js/docs/              moteur documentaire, QR, registre, vérification, modèles
  js/ui/                composants, tableaux, fenêtres, coque, démarrage
  js/screens/           écrans
  verifier/             outil de vérification autonome
  vendor/               qrcode-generator (Kazuhiko Arase, licence MIT)
tools/build.mjs         assemblage du fichier unique
tests/                  tests unitaires (node:test) et de bout en bout (Playwright)
packaging/              emballages Windows et Android
```
