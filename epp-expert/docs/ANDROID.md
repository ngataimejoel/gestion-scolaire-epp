# Application Android AKWA SCHOOL et synchronisation par le Wi-Fi

## Principe (version 1.1.1)

Le téléphone fonctionne de deux façons, au choix de l'école :

- **Seul**, sans ordinateur ni Internet : « Créer mon école » (nom, IEPP, DRENAET, année, classes avec les
  grilles par défaut de l'application Windows), import du fichier ELEVES national (.xlsx, .xls ; .csv accepté), saisie
  des élèves, des notes, de l'appel et des absences, résultats calculés comme sur l'ordinateur (moyennes, MGA,
  rang, décision), impression (liste de classe, fiche de notes, résultats annuels, bulletins, absences du mois)
  ou PDF par Android, exports Excel (.xlsx), sauvegarde chiffrée (.akwa). Licence propre au téléphone : 7 jours d'essai,
  puis un code d'activation (même service que l'ordinateur, Internet seulement à ce moment-là). Mot de passe
  administrateur local pour corriger une note, supprimer une donnée ou modifier une fiche d'élève enregistrée.
- **Associé** à l'ordinateur de l'école : le téléphone garde une copie de l'année en cours, limitée aux droits
  du compte choisi, et ses saisies attendent sur le téléphone.

La synchronisation n'est jamais automatique : le bouton « Synchroniser maintenant » affiche ce qui sera envoyé
et reçu, puis propose deux chemins :

- **par le Wi-Fi** (réseau de l'école ou partage de connexion d'un téléphone) : l'ordinateur doit être allumé,
  AKWA SCHOOL ouvert et la synchronisation démarrée (Rapports & administration › Téléphones) ;
- **par fichier**, quand le téléphone est ailleurs : il crée un fichier chiffré (.akwasync) envoyé par WhatsApp ou
  e-mail ; sur l'ordinateur, Téléphones › « Importer un fichier du téléphone » applique les saisies (mêmes droits,
  mêmes contrôles, mot de passe administrateur saisi sur l'ordinateur) et crée une réponse à renvoyer ; le
  téléphone l'ouvre (bouton « Ouvrir la réponse », ou « Ouvrir avec AKWA SCHOOL » depuis WhatsApp). Un fichier
  intercepté est illisible, modifié il est refusé, importé deux fois il n'est appliqué qu'une fois ; une réponse
  plus ancienne que les données du téléphone est ignorée. `epp/synchro/fichier.py`, `synchro/FichierSynchro.java`.

L'association reste à faire une fois sur le même réseau (le code ne circule jamais).

Les exports du téléphone sont des classeurs Excel (.xlsx) présentés comme ceux de l'application Windows : ELEVES
au format national (relu par l'import de l'ordinateur), listes de classe, résultats annuels et absences (en-tête
officiel, une feuille par classe). Écrits par `noyau/Classeur.java`, vérifiés en CI avec openpyxl.

Un téléphone utilisé seul puis associé envoie ses données à la première synchronisation (mot de passe d'un
administrateur de l'ordinateur) : `epp/synchro/fusion.py` les ajoute à l'année active sans rien écraser
(élèves reconnus par matricule DESPS ou nom + date de naissance, notes différentes signalées, envoi rejouable
sans doublon). Les données du téléphone sont archivées sur lui. Dissocier permet de repartir seul avec une copie.

## Règles appliquées par l'ordinateur (il a toujours le dernier mot)

- Droits du rôle du compte associé (un compte Secrétariat ne saisit pas de notes, etc.).
- Licence : si l'essai ou la licence de l'ordinateur est échu, le téléphone ne reçoit plus aucune donnée et
  affiche « Données verrouillées ». Le téléphone se verrouille aussi seul à la date de fin de l'essai ou de la
  licence, même sans synchronisation.
- Corriger ou effacer une note déjà enregistrée, noter absent un élève qui a des notes, supprimer une absence
  enregistrée : mot de passe d'un administrateur (demandé sur le téléphone, envoyé chiffré, jamais conservé,
  chaque tentative inscrite au journal de l'ordinateur).
- Note modifiée sur l'ordinateur depuis la dernière synchronisation du téléphone : conflit signalé, rien n'est
  écrasé. Année clôturée : lecture seule. Inscription d'un élève depuis le téléphone : acceptée (pas de doublon) ; correction de sa fiche : mot de passe administrateur.
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
| Téléphone | `android/` : interface v8 `app/src/main/assets/www/index.html` (copie de `epp/resources/web/akwa_v8.html` par `outils/interface_android_v8.py`, identique à AKWA SCHOOL v8), pont `www/pont_android.js` ↔ `Pont.java` (données `etat_v8.json`, mot de passe, licence, fichiers, impression). Échange avec l'ordinateur : sauvegarde v8 (Import, export & sauvegarde) |
| Téléphone seul | `noyau/` (Java pur : licence Ed25519) ; synchronisation Wi-Fi `synchro/` gardée dans le code mais plus utilisée par l'interface v8 |
| Tests | `tests/test_synchro.py`, `android/test-jvm/TestSynchro.java` (client Java contre le vrai serveur), `TestNoyau.java` + `outils/fixtures_noyau.py` (lecture comparée au code Python), en CI |

## Construction et publication

La CI (`.github/workflows/epp-expert-windows.yml`, tâche `android`) teste le client Java contre le serveur Python,
construit `AkwaSchool.apk` et le joint à la version publiée (étiquette `expert-vX.Y.Z`), à côté de l'installateur
Windows. Lien permanent : https://github.com/ngataimejoel/gestion-scolaire-epp/releases/latest/download/AkwaSchool.apk

Signature : par défaut la clé du dépôt (`android/signature/akwa-school.p12`), pour que chaque nouvelle version
s'installe par-dessus la précédente. Le dépôt étant public, une clé privée est préférable : créer une clé PKCS12 et
renseigner les secrets GitHub `ANDROID_KEYSTORE_B64` (fichier en base64), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Après ce changement, désinstaller une fois l'ancienne application sur
chaque téléphone (puis l'associer de nouveau).
