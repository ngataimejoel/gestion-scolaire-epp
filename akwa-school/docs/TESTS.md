# Rapport de tests — AKWA SCHOOL 2.0.0

Tous les résultats ci-dessous proviennent d’**exécutions réelles** sur la construction finale
`dist/AKWA_SCHOOL.html` (Chromium sans tête piloté par Playwright 1.56, ouverture en `file://`,
Node.js 22), le 21 octobre 2026. Rien n’est déclaré testé sur la seule lecture du code.

## 1. Résumé

| Suite | Ce qui est vérifié | Résultat |
|---|---|---|
| `tests/unit/calc.test.cjs` | moyennes de chaque grille, MGA (deux règles), rangs ex aequo, mentions, décisions, âges, jours de classe | **42 / 42** |
| `tests/unit/notes-metier.test.cjs` | saisie, correction, absences, validation, passage d’année | **42 / 42** |
| `tests/unit/schema.test.cjs` | migration 1.x sans perte, secrets retirés, assainissement, idempotence, contrôle d’intégrité | **21 / 21** |
| `tests/unit/validation.test.cjs` | références et clé de contrôle (toutes les substitutions), notes, noms, téléphones, dates, arrondis | **64 / 64** |
| `tests/unit/qr.test.cjs` | format AKS1, lecture tolérante, empreintes, SVG, capacité maximale, relecture | **33 / 33** |
| `tests/unit/crypto-verification.test.cjs` | PBKDF2, AES-GCM, ECDSA P-256, chaque branche du verdict de vérification | **23 / 23** |
| `tests/e2e/routes.test.cjs` (directeur) | les 42 écrans : affichage, aucune erreur JS, aucune requête réseau | **42 / 42** |
| `tests/e2e/routes.test.cjs` (`PROFIL=ens`) | les 42 adresses avec un compte enseignant : écran ou refus propre, aucune erreur | **42 / 42** |
| `tests/e2e/qr.test.cjs` | lecteur QR hors ligne : 6 contenus × 9 déformations, correction Reed-Solomon | **54 / 54** + RS 4 / 4 |
| `tests/e2e/documents.test.cjs` | inscription, doublon, brouillon, émission signée, vérification, falsification, annulation, carte, duplicata | **26 / 26** |
| `tests/e2e/droits.test.cjs` | enseignant : périmètre, 12 actions réservées refusées par le métier, correction de note, appel | **25 / 25** |
| `tests/e2e/hotes.test.cjs` | Android (pont `AkwaNative` simulé), emballage `AkwaNatif`, Windows PySide6 (pont simulé) | **26 / 26** |
| `tests/e2e/donnees.test.cjs` | sauvegarde, restauration, copies locales, intégrité, rattachement, 9 exports CSV, journal, corbeille | **98 / 98** |
| `tests/e2e/parametres-modeles-securite.test.cjs` | éditeur de modèles, aperçu en direct, refus du HTML, clés de signature, verrouillage | **105 / 105** |
| `tests/e2e/vie.test.cjs` | emploi du temps, cahier, discipline, infirmerie, calendrier, droits enseignant, 390 px | **98 / 98** |
| `tests/e2e/verificateur.test.cjs` | outil de vérification autonome produit par l’application et ouvert seul | **63 / 63** |
| `tests/e2e/services-parametres.test.cjs` | bibliothèque, CEPE, parents, paramètres de l’école, calendrier, apparence, diagnostic | **28 / 28** |
| `tests/e2e/finances-rapports.test.cjs` | versements et reçus, annulation, dépenses, cantine, rapports, générateur, transmission IEPP | **20 / 20** |

**Total : 225 tests unitaires et 653 vérifications de bout en bout réussis, 0 échec.**

Défauts trouvés **par les tests** puis corrigés (voir `CHANGELOG.md`) : note 8,7 / 10 refusée (contrôle
binaire des décimales), arrondi au centième inexact, « -0 F », niveau suivant d’un niveau inconnu,
données importées abîmées bloquant l’ouverture, correction d’une note validée possible par un
enseignant en contournant l’écran, conflit de nom `depense` dans les finances, journal non enregistré
immédiatement, filigrane de statut débordant de la feuille, planche de cartes à 8 au lieu de 10,
zone d’impression vidée trop tôt.

Les tests unitaires des calculs, de la migration, de la validation et des QR ont été écrits par des
agents distincts de l’auteur du code, avec des valeurs attendues calculées à la main.

## 2. Matrice de tests (A à W)

| | Domaine | Couvert par | État |
|---|---|---|---|
| A | Démarrage | `routes`, `hotes` (assistant, démonstration, reprise 1.x, redémarrage avec données) | réussi |
| B | Navigation | `routes` (42 adresses, deux profils), recherche globale (`droits`) | réussi |
| C | Formulaires | erreurs sous le champ sans perte de saisie (`documents`, `services-parametres`, `donnees`, `parametres-modeles-securite`) | réussi |
| D | Création | élèves, ouvrages, prêts, annonces, versements, dépenses, congés, documents, cartes, rapports | réussi |
| E | Modification | paramètres de l’école, modèles, notes, décisions, identité déverrouillée | réussi |
| F | Suppression | corbeille (élève, personnel), dépense, annonce, ouvrage (refus si prêté), annulation de reçu et de document | réussi |
| G | Recherche | tableaux, recherche globale limitée au profil, journal sans accents | réussi |
| H | Tri | tableaux (`donnees`, `vie`) | réussi |
| I | Pagination | registre et tableaux (`donnees`) ; pagination des documents longs (registre paysage sur 3 pages) | réussi |
| J | Import | Excel/CSV avec doublons et erreurs (aperçu), rattachement d’un espace enseignant | réussi (import Excel : par l’écran `eleves/import` et `donnees`) |
| K | Export | sauvegarde, 9 CSV (BOM, « ; », accents, guillemets), format 1.x, outil de vérification, transmission IEPP, diagnostic | réussi |
| L | Sauvegarde | fichier avec empreinte SHA-256, sans secret en clair ; copies locales | réussi |
| M | Restauration | aperçu, refus d’un fichier altéré, mot de passe, copie préalable, reconnexion | réussi |
| N | Génération documentaire | certificat, bulletin, listes, rapports, reçu, journal de caisse, cartes ; brouillon sans inscription | réussi |
| O | Impression A4 | PDF produits par le moteur d’impression de Chromium : A4 portrait et paysage, A5, planche de 10 cartes ID-1 avec traits de coupe et versos | réussi (contrôle visuel des PDF) |
| P | Génération QR | contenu minimal, signature, capacité, brouillon réservé | réussi |
| Q | Vérification QR | référence, QR signé, falsifié, clé inconnue/retirée/compromise, annulé, remplacé, version ancienne, photo du QR, douchette AZERTY, outil autonome | réussi |
| R | Filigranes | SPÉCIMEN entier sur A4 et cartes, COPIE, ANNULÉ ; réglages bornés (`parametres-modeles-securite`) | réussi |
| S | Permissions | enseignant : 12 fonctions métier refusées, écrans interdits, périmètre de classe | réussi |
| T | Hors ligne | aucune requête réseau sur les 42 écrans (toute requête autre que `file:`, `data:`, `blob:` fait échouer le test) | réussi |
| U | Erreurs | stockage en échec signalé, saisies invalides, fichiers refusés, sujet de document manquant | réussi |
| V | Compatibilité | Chromium (moteur de Chrome et d’Edge) ; ponts Android et Windows simulés | partiel (voir § 4) |
| W | Données anciennes | migration 1.x (unitaires), reprise des données du navigateur et du fichier Android `etat_v8.json`, restauration d’une sauvegarde 1.x | réussi |

## 3. Cas limites vérifiés

Champs vides, valeurs invalides (notes, années, téléphones, montants nuls), doublons (élèves, cotes,
dépenses), chaînes longues, accents et apostrophes (« Sainte-Thérèse d’Anyama », « KONÉ »), élève sans
photo (cartes : cadre vide signalé), logo absent, documents annulés et remplacés, QR inconnu ou falsifié,
documents de plusieurs pages, changement de format de page (A4/A5, portrait/paysage, cartes), restauration
d’une ancienne sauvegarde, largeur de téléphone (390 × 844) sans débordement, thème sombre.

## 4. Non exécuté (et pourquoi)

| Élément | Raison | Ce qui le remplace |
|---|---|---|
| **APK Android** (construction et essai sur téléphone) | Gradle et le SDK Android absents de l’environnement | pont `AkwaNative` imité d’après `Pont.java` (`hotes`) ; liste de recette dans `packaging/android/README.md` |
| **Installateur Windows** (Electron) | registre npm inaccessible depuis l’environnement | contrat `AkwaNatif` simulé (`hotes`) ; liste de recette dans `packaging/windows-electron/README.md` |
| Application Windows PySide6 | PySide6 indisponible | pont `QWebChannel` simulé (`hotes`) |
| Firefox et Safari | seul Chromium est installé | aucun ; fonctions utilisées standard (IndexedDB, WebCrypto, `<dialog>`) |
| Impression sur une **vraie imprimante** et à la **vraie caméra** | matériel absent | PDF du moteur d’impression contrôlés ; lecture de QR sur images déformées |
| Mesure physique d’une carte imprimée | matériel absent | dimensions CSS en millimètres vérifiées dans les PDF |
| Lecteurs d’écran | non disponibles | libellés, rôles ARIA et navigation clavier contrôlés dans les tests |

## 5. Relancer les tests

```
node tools/build.mjs
node --test tests/unit/*.test.cjs
for t in routes qr documents droits hotes donnees parametres-modeles-securite vie verificateur services-parametres finances-rapports; do node tests/e2e/$t.test.cjs; done
PROFIL=ens node tests/e2e/routes.test.cjs
```

Playwright est cherché dans `node_modules`, puis dans `/opt/node22/lib/node_modules`, puis via `NODE_PATH`.
`AKWA_FICHIER=<chemin>` permet de tester une autre construction.
