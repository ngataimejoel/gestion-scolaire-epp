# Sécurité d’AKWA SCHOOL 2 : ce qui est protégé, et ce qui ne l’est pas

Ce document décrit honnêtement les protections réelles et leurs limites. Il s’adresse au directeur,
à l’IEPP et à toute personne chargée de la maintenance.

## 1. Comptes et mots de passe

| Élément | Mise en œuvre |
|---|---|
| Mot de passe du directeur | jamais conservé : seule une empreinte **PBKDF2-SHA-256, 310 000 itérations, sel aléatoire de 16 octets** (WebCrypto) est enregistrée. 8 caractères minimum, lettres et chiffres, mots trop simples refusés. |
| Code de secours | propre à chaque installation (`XXXX-XXXX-XXXX`, alphabet sans caractères ambigus), montré **une seule fois**, conservé en empreinte. L’ancien code universel de la version 1.x est désactivé. |
| Comptes enseignants | identifiant + mot de passe provisoire affiché une fois, changement imposé à la première connexion ; empreintes PBKDF2. Un compte ou une fiche désactivé(e) ne peut plus se connecter. |
| Reprise des données 1.x | le mot de passe en clair de l’ancienne version est converti en empreinte puis effacé ; s’il est faible (dont « admin »), son changement est exigé. |
| Session | verrouillage automatique après inactivité (15 min par défaut) ; opérations sensibles confirmées par le mot de passe (délai de grâce de 3 min). |
| Échecs de connexion | délai volontaire ; même temps de réponse que l’identifiant existe ou non. |

**Limite fondamentale (version navigateur)** : les données sont dans le navigateur de l’ordinateur.
Les mots de passe protègent **l’usage de l’application**, pas les fichiers : une personne qui dispose de la
session Windows et des outils de développement du navigateur peut lire ou modifier les données
(empreintes comprises). Protégez la session Windows (mot de passe, verrouillage) et l’ordinateur.
Dans la version Windows PySide6, les comptes sont gérés par l’application elle-même.

## 2. Droits

Les droits sont définis action par action (`src/js/security/perm.js`) et **vérifiés dans les fonctions
métier** (inscription, notes, documents, finances…), quel que soit l’écran qui les appelle. Masquer un
bouton n’est qu’un confort d’affichage. Un enseignant ne voit et ne modifie que sa ou ses classes ; il ne
peut ni corriger une note validée, ni lever une absence enregistrée, ni émettre un document officiel
(sauf bulletins et fiches de sa classe, sans signature électronique).

## 3. Documents, QR codes et signature

### Contenu du QR code (minimal)

`AKS1;T=<type>;R=<référence>;E=<date d’émission>;X=<fin de validité>;H=<empreinte>;[N=<nom>;M=<matricule>;]K=<clé>;S=<signature>`

- **Jamais** de photo, de téléphone des parents, de donnée médicale ni de détail d’acte de naissance.
- Nom et matricule (déjà imprimés sur le document) seulement pour les cartes, où ils permettent une
  vérification hors ligne.
- `H` : empreinte SHA-256 (80 bits) des données du titulaire **et du contenu variable** (notes, rang,
  dossier) au moment de l’émission.

### Quatre questions distinctes

| Question | Ce qui y répond | Limite |
|---|---|---|
| **Intégrité** : le contenu du QR a-t-il été modifié ? | signature **ECDSA P-256 / SHA-256** (WebCrypto, primitive éprouvée) | ne dit rien du papier lui-même : comparer le document avec le QR |
| **Émetteur** : qui a signé ? | clé publique connue, avec son empreinte lisible et son statut | une clé déclarée compromise rend ses signatures suspectes |
| **Validité administrative** : le document existe-t-il au registre, avec la même empreinte ? | registre des documents de l’école | hors ligne, seulement le registre de cet ordinateur ou la copie datée de l’outil autonome |
| **Statut** : annulé, remplacé, expiré, version dépassée ? | registre | **une annulation postérieure à la copie du registre n’est pas connue hors ligne** |

Une signature valide **ne prouve pas** qu’un document n’a pas été annulé ensuite. L’outil de vérification
autonome affiche toujours la date de sa copie du registre ; redistribuez-le après chaque annulation
importante.

### Clés de signature

- Créées sur l’ordinateur de l’école par le directeur ; la clé privée est **chiffrée (AES-GCM, clé dérivée
  du mot de passe administrateur par PBKDF2)** ; elle n’existe jamais en clair dans les données, les
  sauvegardes ni le code distribué. Pendant une session du directeur, elle est chargée en mémoire sous
  forme **non exportable**.
- Rotation : la nouvelle clé signe ; l’ancienne, « retirée », vérifie toujours les documents émis avant
  son retrait. Clé compromise : déclarée comme telle, ses signatures sont signalées.
- Mot de passe oublié (code de secours) : l’ancienne clé, indéchiffrable, est retirée ; une nouvelle clé
  doit être créée. Les documents déjà émis restent vérifiables.
- Démonstration : aucun document n’est signé ; filigrane SPÉCIMEN.

### Références

`AK-<TYPE>-<ANNÉE>-<NNNNNN>-<C>` : la clé de contrôle (Luhn modulo 36) détecte toute faute de frappe sur
un caractère et la plupart des inversions. Elle **n’empêche pas** la falsification : seule la
vérification au registre ou la signature le fait.

### Ce que ne sont pas les filigranes, cachets et signatures

- Les **filigranes** (SPÉCIMEN, COPIE, DUPLICATA, ANNULÉ, PROVISOIRE, logo, nom de l’école) sont des
  repères visuels : **aucune protection cryptographique**. Ils ne recouvrent jamais les signatures, les
  photos ni les QR codes.
- Les zones de **signature manuscrite** et de **cachet** sont laissées vides pour être signées et tamponnées à
  la main : l’application n’imite jamais une signature ou un cachet officiel. La « signature électronique »
  désigne uniquement la signature cryptographique du QR code.

## 4. Sauvegardes

- Le fichier `.akwa.json` contient les données, les **empreintes** des mots de passe et la clé de
  signature **chiffrée** — jamais un mot de passe ni une clé privée en clair.
- L’empreinte SHA-256 du fichier détecte une **altération accidentelle** (fichier tronqué, corrompu). Elle
  n’empêche pas une personne déterminée de modifier le fichier et de recalculer l’empreinte : conservez les
  sauvegardes en lieu sûr (clé USB rangée, deuxième support).
- Avant toute restauration : analyse du fichier, aperçu, mot de passe, et copie de sécurité de l’état
  actuel.

## 5. Données personnelles et journal

- Données minimales dans les QR codes (voir ci-dessus) et dans l’outil de vérification autonome (références,
  empreintes, statuts ; noms seulement si le directeur le choisit).
- Le journal des opérations décrit l’action (« Note corrigée : nom, matière ») sans copier de donnée de
  santé, de téléphone ni d’acte de naissance. Le rapport de diagnostic technique retire les données
  personnelles.
- Données de santé (groupe sanguin, allergies, infirmerie) : visibles par la direction et l’enseignant de la
  classe ; jamais dans un QR code ni dans l’outil autonome.

## 6. Code et injection

- Tout le HTML est produit par un gabarit qui échappe chaque valeur ; les modèles de documents
  personnalisés n’acceptent **aucun HTML** (seuls les champs `{…}` documentés et le gras `**…**`).
- Les images importées sont limitées aux formats PNG, JPEG, GIF et WebP (`data:` contrôlé) ; les clés
  dangereuses (`__proto__`, `constructor`, `prototype`) sont retirées des données importées.
- Aucune ressource externe n’est chargée ; aucune donnée ne quitte l’ordinateur sans action explicite
  (enregistrement d’un fichier).

## 7. Licence et activation

La version 1.x contenait une logique d’activation dans la page : elle ne protégeait rien, car la page est
modifiable par l’utilisateur. AKWA SCHOOL 2 ne prétend pas protéger la page elle-même. La protection de
la diffusion relève de l’emballage (application Android signée, contrôle de signature `Integrite.java` ;
installateur Windows signé).
