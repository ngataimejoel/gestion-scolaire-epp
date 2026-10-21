# Audit d’AKWA SCHOOL 1.7.0 (fichier source fourni)

Fichier audité : `AKWA_SCHOOL_v1.7.0_PROFESSIONAL_3.html` — 886 Ko, un seul fichier (HTML, CSS,
JavaScript, images en base64, bibliothèque `qrcode-generator` de Kazuhiko Arase intégrée).

## 1. Méthode

| Étape | Ce qui a été fait réellement |
|---|---|
| Lecture statique | Lecture intégrale du code (styles, cœur, interface v8, couche « PRO », accès enseignants, correctifs successifs ajoutés en fin de fichier) ; cartographie des écrans, actions, données, impressions. |
| Exécution | Ouverture de l’original dans Chromium sans tête (Playwright), école de démonstration, passage sur les **28 écrans**, recensement des gestionnaires d’événements. |
| Sondes ciblées | Lecture du stockage après usage, contenu réel des QR codes, dépassement de quota avec photos, passage d’année avec une école n’ouvrant pas tous les niveaux. |
| Rendu imprimé | Captures d’écran et export PDF de documents de l’original. |

Résultats bruts de l’exécution : chargement ≈ 1,9 s ; 88 actions `data-act` et 31 `data-ch`, **toutes**
reliées à un gestionnaire ; **0 erreur JavaScript** sur les 28 écrans en usage nominal ; données ≈ 55 Ko
dans `localStorage` (clé `akwa_school_v5`).

## 2. Carte fonctionnelle de l’original

| Volet | Écrans | Fonctions principales |
|---|---|---|
| Tableau de bord | accueil | effectifs, appel du jour, notes manquantes, raccourcis |
| Élèves & personnel | liste, classes, personnel, enseignants (comptes, suivi, validation, messages, journal) | inscription (extrait / sans extrait), fiche, départ, affectation des classes, comptes enseignants |
| Notes & bulletins | saisie, résultats, fin d’année | grilles CP/CE/CM, MGA, rangs, mentions, décisions, passage d’année, bulletins |
| Absences | appel, autorisations | appel par classe, demandes d’absence (personnel, élèves), justification |
| Rapports & administration | rapports officiels, générateur, statistiques, données, paramètres | rapports de rentrée, composition, mensuel, fin d’année, CM2, infrastructures, générateur à blocs, sauvegarde JSON, import Excel |
| Vie scolaire (PRO) | emploi du temps, cahier de textes, discipline, infirmerie, calendrier | |
| Finances (PRO) | frais et versements, dépenses, cantine | reçus numérotés |
| Services (PRO) | bibliothèque, CEPE, parents | prêts, dossiers CEPE, annonces et SMS (textes à copier) |
| Liaison IEPP | transmission, journal | fichier JSON de transmission, fiche récapitulative |

Toutes ces fonctions sont conservées dans AKWA SCHOOL 2 (voir `CHANGELOG.md`).

## 3. Constats

### Critiques (perte de données, sécurité)

1. **Perte silencieuse de données** — l’enregistrement (`save()`) avale l’exception
   `QuotaExceededError` de `localStorage` : reproduit avec quelques photos, les modifications suivantes
   ne sont plus enregistrées **sans aucun message**.
2. **Mot de passe administrateur en clair** dans `localStorage` (valeur d’origine « admin »), lisible par
   quiconque ouvre les outils du navigateur ; **code de secours en clair** également.
3. **QR code de la fiche scolaire = données personnelles en clair** : 344 caractères contenant nom,
   date et lieu de naissance, numéro et date de l’acte, nom et profession des deux parents, téléphone.
   Ce QR ne comporte **aucun mécanisme de vérification** : il ne prouve rien et expose des données.
4. **Plantage du passage d’année** pour une école qui n’ouvre pas tous les niveaux : un admis est placé
   dans un niveau non ouvert, et le tableau de bord échoue ensuite
   (`TypeError: Cannot read properties of undefined (reading 'grille')`).
5. **Activation sans protection réelle** : la logique de licence est entièrement dans la page ; elle ne
   protège rien (modifiable par l’utilisateur).

### Majeurs

6. Aucune détection de doublon à l’inscription (même nom, même naissance).
7. Droits des enseignants appliqués en partie par du **CSS qui masque des boutons** et par des
   enveloppes d’actions ; plusieurs chemins (fonctions appelées par d’autres écrans) ne vérifient pas les droits.
8. Aucune référence unique ni registre des documents : une réimpression est indiscernable de l’original,
   impossible d’annuler un document ou de délivrer un duplicata traçable.
9. Sauvegarde = export JSON manuel, **sans empreinte d’intégrité** ; restauration sans contrôle de
   cohérence ni copie de sécurité préalable ; aucune copie automatique.
10. Impression bâtie à partir du HTML des écrans (`window.print`), dimensions de page approximatives ;
    le bouton « PDF » ouvre la boîte d’impression.
11. Type des notifications deviné par expression régulière sur le texte du message.
12. Aucun filigrane de statut (SPÉCIMEN, COPIE, ANNULÉ…).

### Mineurs

13. Validation hétérogène selon les écrans (téléphones, dates, notes à plus de 2 décimales).
14. Plusieurs couches de correctifs successifs en fin de fichier qui redéfinissent des fonctions
    (maintenance difficile, ordre de chargement significatif).
15. Journal limité aux 40 dernières opérations dans les données principales.

## 4. Suites données

Chaque constat est traité dans AKWA SCHOOL 2 ; la correspondance détaillée est dans `CHANGELOG.md`
(rubrique « Corrigé ») et la conception dans `ARCHITECTURE.md` et `SECURITE.md`.
