# Application Android AKWA SCHOOL et synchronisation par le Wi-Fi

## Principe

- Le téléphone garde une copie de l'année en cours (élèves, classes, notes, résultats, personnel, absences),
  limitée aux droits du compte choisi à l'association. Il fonctionne sans réseau.
- Les saisies du téléphone (notes, absences aux évaluations, absences et retards des élèves et du personnel)
  attendent sur le téléphone, puis partent à la synchronisation.
- La synchronisation passe par le réseau local (Wi-Fi de l'école ou partage de connexion d'un téléphone) :
  aucun serveur sur Internet, aucun abonnement. L'ordinateur doit être allumé, AKWA SCHOOL ouvert et la
  synchronisation démarrée (Rapports & administration › Téléphones).

## Règles appliquées par l'ordinateur (il a toujours le dernier mot)

- Droits du rôle du compte associé (un compte Secrétariat ne saisit pas de notes, etc.).
- Licence : si l'essai ou la licence de l'ordinateur est échu, le téléphone ne reçoit plus aucune donnée et
  affiche « Données verrouillées ». Le téléphone se verrouille aussi seul à la date de fin de l'essai ou de la
  licence, même sans synchronisation.
- Corriger ou effacer une note déjà enregistrée, noter absent un élève qui a des notes, supprimer une absence
  enregistrée : mot de passe d'un administrateur (demandé sur le téléphone, envoyé chiffré, jamais conservé,
  chaque tentative inscrite au journal de l'ordinateur).
- Note modifiée sur l'ordinateur depuis la dernière synchronisation du téléphone : conflit signalé, rien n'est
  écrasé. Année clôturée : lecture seule. Fiches des élèves et du personnel : modifiables sur l'ordinateur seulement.
- Une saisie renvoyée (réponse perdue) n'est jamais appliquée deux fois (identifiant unique, table `synchro_op`).

## Sécurité

- Association : code de 8 caractères affiché par l'ordinateur, valable 10 minutes, une seule fois, annulé après
  5 essais faux. Le code ne circule pas : le téléphone prouve qu'il le connaît (PBKDF2-SHA256, 150 000 itérations).
- Chaque message est chiffré et authentifié (AES-256-GCM) avec une clé propre au téléphone, et porte un compteur
  anti-rejeu. Rien de lisible ne passe sur le Wi-Fi.
- Téléphone protégé par un code PIN ; données exclues des sauvegardes Android. Un téléphone perdu se retire sur
  l'ordinateur (page Téléphones) : il ne reçoit plus rien.

## Code

| Partie | Fichiers |
|---|---|
| Protocole (ordinateur) | `epp/synchro/protocole.py`, `serveur.py` (HTTP 8765, découverte UDP 8766), `donnees.py` |
| Page Téléphones | `epp/ui/pages/telephones.py`, `epp/ui/synchro.py` |
| Téléphone | `android/` : interface `app/src/main/assets/www/` (reprise du prototype v7), pont Java `Pont.java`, protocole `synchro/` (Java pur) |
| Tests | `tests/test_synchro.py`, `android/test-jvm/TestSynchro.java` (client Java contre le vrai serveur, en CI) |

## Construction et publication

La CI (`.github/workflows/epp-expert-windows.yml`, tâche `android`) teste le client Java contre le serveur Python,
construit `AkwaSchool.apk` et le joint à la version publiée (étiquette `expert-vX.Y.Z`), à côté de l'installateur
Windows. Lien permanent : https://github.com/ngataimejoel/gestion-scolaire-epp/releases/latest/download/AkwaSchool.apk

Signature : par défaut la clé du dépôt (`android/signature/akwa-school.p12`), pour que chaque nouvelle version
s'installe par-dessus la précédente. Le dépôt étant public, une clé privée est préférable : créer une clé PKCS12 et
renseigner les secrets GitHub `ANDROID_KEYSTORE_B64` (fichier en base64), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Après ce changement, désinstaller une fois l'ancienne application sur
chaque téléphone (puis l'associer de nouveau).
