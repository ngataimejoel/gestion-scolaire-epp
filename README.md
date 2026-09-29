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
| 8 | Résultats, tableau de bord, statistiques | À faire |
| 9 | Absences, rapports (PDF, Excel, impression) | À faire |
| 10 | Abonnement et paiement | À faire |
| 11 | Notifications, historique, import/export Excel, assistant | À faire |
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
