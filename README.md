# GESTION SCOLAIRE EPP

Plateforme web de gestion des écoles primaires (EPP) de Côte d'Ivoire, qui remplace le classeur
`GESTION_SCOLAIRE_EPP_MODELE_EXPERT_10.xlsm`. Le classeur reste la source fonctionnelle : chaque règle
de calcul du site reproduit une formule du fichier, et les tests le vérifient sur ses 64 élèves.

Utilisateurs : directeur, enseignants, parents (consultation sans mot de passe). Plusieurs écoles
peuvent utiliser la même installation ; leurs données sont strictement isolées.

## État d'avancement

| Étape | Contenu | État |
|---|---|---|
| 1-2 | Analyse du classeur, correspondance feuilles → modules, architecture | Fait (`docs/dossier-conception.html`) |
| 3 | Squelette, schéma de base de données, moteur de calcul testé | Fait |
| 4 | Comptes : inscription directeur + SMS, comptes enseignants, accès parents | Fait |
| 5 | Établissement et paramètres | Fait |
| 6 | Registre des élèves, personnel | Fait |
| 7 | Classes et notes (validation, verrouillage) | Fait |
| 8 | Résultats, tableau de bord, statistiques, bulletins | Fait |
| 9 | Absences, rapports (PDF, Excel, impression) | Fait |
| 10 | Abonnement et paiement | Fait |
| 11 | Notifications, historique, assistant | Fait |
| 11 bis | Import et export du classeur Excel, sauvegarde et restauration | Fait |
| 12 | Tests complets, documentation de déploiement | À faire |

## Pile technique

- Next.js 16 (App Router) + TypeScript, Tailwind CSS
- PostgreSQL 16 + Prisma 7 (adaptateur `@prisma/adapter-pg`)
- Mots de passe hachés en Argon2id, validation serveur avec zod
- Exports Excel avec exceljs ; tests avec vitest
- SMS et paiement via des connecteurs interchangeables, avec un mode « simulation » pour le développement

## Installation (développement)

Prérequis : Node.js 20 ou plus, Docker (ou un PostgreSQL 16 local).

```bash
cp .env.example .env          # puis remplir SESSION_SECRET
docker compose up -d          # base PostgreSQL locale
npm install                   # génère aussi le client Prisma
npx prisma migrate dev        # crée les tables
npm run dev                   # http://localhost:3000
npm run db:seed               # facultatif : école de démonstration du classeur (EPP LIGUIYO)
```

L'école de démonstration reprend les 64 élèves, le personnel, les notes et les absences du classeur.
Directeur : `07 30 90 80 35`, mot de passe `Demo2026` (modifiables avec `DEMO_TELEPHONE` et `DEMO_MOT_DE_PASSE`).

## Comptes et connexion

| Qui | Comment |
|---|---|
| Directeur | Inscrit son école (`/inscription`) : numéro + mot de passe, validé par un code SMS. Code SMS demandé à chaque connexion. |
| Enseignant | Compte créé quand le directeur l'enregistre dans **Personnel** : identifiant = numéro, mot de passe provisoire = 4 derniers chiffres + 4 caractères aléatoires, envoyé par SMS et à changer à la 1re connexion. Code SMS à la connexion en option (réglage de l'école). |
| Parent | Aucun compte (`/parents`) : matricule école ou DESPS de l'élève + date de naissance. Lecture seule, 30 minutes. |

Règles de sécurité : codes SMS à 6 chiffres valables 5 minutes, 3 essais, 1 minute entre deux envois et 5 envois par heure ;
compte bloqué 15 minutes après 5 mauvais mots de passe ; 10 échecs par adresse IP en 15 minutes ; 5 essais ratés d'accès parent
par adresse IP en 15 minutes. Mots de passe en Argon2id, codes SMS et jetons de session stockés uniquement sous forme d'empreinte.

**Mode simulation des SMS** (`SMS_PROVIDER="simulation"`) : aucun SMS n'est envoyé, le code s'affiche à l'écran en
développement et dans les journaux du serveur. En production, il n'est affiché que si `AFFICHER_SMS_SIMULES=oui`
(à n'utiliser que pour une démonstration) : branchez un vrai fournisseur avant l'ouverture aux écoles.

## Abonnement et paiement

- Les offres (essai, Standard, Premium) sont **en base** : prix, durée, nombre maximum d'élèves et de comptes enseignants,
  fonctions incluses. Elles se modifient dans l'espace administrateur `/admin`. `prisma/offres-initiales.json` ne sert
  qu'à remplir une table vide (`npm run db:offres`) ; ses prix sont indicatifs.
- Compte administrateur : `ADMIN_TELEPHONE=… ADMIN_MOT_DE_PASSE=… npm run admin:creer`, puis connexion normale (code SMS).
- Une école reçoit l'essai à son inscription. À l'échéance, le site passe en **lecture seule** (consultation, impression
  et exports restent possibles, aucune donnée n'est supprimée) jusqu'au paiement.
- Parcours : choix de l'offre → paiement en attente → confirmation du fournisseur → activation. Le montant vient toujours
  de l'offre en base et il est recontrôlé à la confirmation. Un renouvellement payé à l'avance s'ajoute après la période
  en cours ; un paiement pendant l'essai démarre l'offre immédiatement.
- Fournisseurs (`PAYMENT_PROVIDERS`) : `simulation`, `cinetpay` (Orange Money, MTN, Moov, Wave, cartes), `wave`.
  Adresse de notification à déclarer chez le fournisseur : `https://<votre-domaine>/api/paiement/cinetpay` ou `/api/paiement/wave`.
  La notification n'est jamais crue seule : signature vérifiée, puis statut et montant relus auprès du fournisseur.
- L'administrateur peut activer un abonnement payé hors ligne (espèces, virement) avec la référence du reçu ; c'est tracé.
- Rappels J-15, J-7 et J-1 (dans l'application et par SMS) : appeler chaque jour
  `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<votre-domaine>/api/taches`.

## Notifications, historique, assistant

- **Notifications** (menu Notifications, pastille du nombre non lu) : feuille validée par l'enseignant (directeur),
  feuille rouverte par le directeur (enseignant), évaluation dans 3 jours (directeur et enseignants concernés), notes non
  validées 7 jours après l'évaluation (enseignants de la classe), paiement reçu, rappels d'abonnement. Par SMS en plus
  quand l'offre inclut « Notifications par SMS ». E-mail : `EMAIL_PROVIDER` (`simulation` ou `resend`).
  Les alertes datées partent avec la tâche quotidienne `POST /api/taches` ; chaque message n'est envoyé qu'une fois.
- **Historique** (directeur) : journal d'audit de l'école, filtrable par données, auteur et période, avec les valeurs avant/après.
- **Assistant du directeur** (offres qui l'incluent) : 13 questions fréquentes, reconnues aussi en texte libre, dont les
  réponses sont calculées sur les données de l'école (effectifs, réussite, classes, premiers, élèves en difficulté,
  absences du mois, feuilles à valider, prochaine évaluation, abandons, extraits, sur-âge, orphelins, abonnement).
  Aucun service d'IA externe : aucune donnée ne quitte la plateforme.

## Import, export et sauvegarde (menu « Import et sauvegarde », directeur)

- **Import du classeur** (.xlsm ou .xlsx, 8 Mo au plus) : le fichier est lu feuille par feuille (PARAMETRES,
  REGISTRE ELEVES, PERSONNEL, NOTES CP / CE1 / CE2-CM1 / CM2, ABSENCES ELEVES, ABSENCES PERSONNEL), sans exécuter
  ses macros. L'aperçu montre les élèves et agents nouveaux, les doublons (même matricule DESPS, ou même nom et même
  date de naissance ; pour le personnel, même matricule, téléphone ou nom), les erreurs ligne par ligne et les réglages
  différents de ceux de l'école. Rien n'est écrit avant la confirmation, puis tout est écrit en une seule transaction.
- **Jamais d'écrasement** : un élève ou un agent déjà présent est ignoré ; les notes ne sont importées que pour les
  nouveaux élèves et pas dans une feuille verrouillée ; les réglages de l'école ne sont remplacés que si le directeur
  coche l'option. Un matricule école déjà pris est remplacé par le suivant libre (signalé dans le rapport).
- **Rapport** : nombres importés, et comparaison des MGA, décisions et rangs recalculés par le site avec ceux du fichier.
- **Comptes enseignants** : créés à l'import seulement si le directeur coche l'option (identifiants par SMS).
- Le contenu du fichier n'est gardé que jusqu'à la confirmation ou l'annulation.
- **Export au format du classeur** : sauvegarde complète (toutes les feuilles, valeurs sans formules ni macros) ou
  registre des élèves, personnel, résultats. La sauvegarde complète reste disponible quand l'abonnement a expiré.
  Réimportée dans une école vide, elle redonne exactement les mêmes données (vérifié par les tests).

Décision signalée : un matricule DESPS mal formé est importé avec un avertissement (le classeur l'accepte en le
signalant ; le formulaire du site, lui, le refuse).

## Tests

```bash
npm test            # moteur de calcul + comptes (base de test TEST_DATABASE_URL)
npm run typecheck
npm run lint
```

`tests/fixtures/` contient les données extraites du classeur (`donnees-classeur.json`) et les valeurs
qu'il calcule (`attendu-classeur.json` : résultats des 64 élèves, fréquentation d'octobre, synthèse de fin
d'année, tableau de bord).

## Organisation du code

```
prisma/schema.prisma      schéma de la base (écoles, années, classes, élèves, notes, abonnements, audit…)
prisma/migrations/        migrations SQL
src/lib/regles/           moteur de calcul (moyennes, MGA, décisions, rangs, fréquentation, effectifs)
src/app/                  pages et routes de l'application
docs/                     dossier de conception (correspondance classeur → modules, ambiguïtés)
tests/                    tests automatisés
```

## Règles métier reprises du classeur

- Moyennes par évaluation : CP (8 matières /10, coefficients), CE1 (/140), CE2-CM1 (/170), CM2 (/170, /190 aux examens blancs).
- Élève absent à une évaluation : 0 pour celle-ci. Aucune note : moyenne vide.
- MGA CP1 à CM1 = (moyenne des compositions 1 à 3 + 2 × passage) ÷ 3 ; admis si MGA ≥ 5/10.
- MGA CM2 = (C1 + C2 + EB1 + EB2) ÷ 4, seulement si les quatre existent ; admis si MGA ≥ 10/20.
- Rang = 1 + nombre d'élèves présents de la classe ayant une MGA strictement supérieure.
- Fréquentation = 1 − jours d'absence ÷ (effectif × jours de classe du mois).
- Effectif probable = redoublants + admis de la classe précédente ; CP1 = redoublants + moitié des nouveaux attendus.

Écarts volontaires, signalés dans le dossier de conception : l'alerte « sur-âge » utilise l'âge (le classeur
compare par erreur la date de naissance) ; le matricule école est figé à l'inscription.

## Sécurité

- Aucun secret dans le code ni dans le navigateur : tout passe par les variables d'environnement (voir `.env.example`).
- Mots de passe et codes SMS stockés uniquement sous forme hachée.
- Chaque requête est filtrée par école ; journal d'audit des modifications.
