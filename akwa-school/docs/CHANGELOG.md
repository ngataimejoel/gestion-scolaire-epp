# Journal des modifications

## 2.0.0 — refonte complète

Version reconstruite à partir d’AKWA SCHOOL 1.7.0 (`AKWA_SCHOOL_v1.7.0_PROFESSIONAL_3.html`), après
audit (`AUDIT.md`). Les données 1.x sont reprises sans perte (voir « Migration »).

### Conservé (toutes les fonctions de la 1.7.0)

- Élèves : inscription avec ou sans extrait de naissance, parents et tuteur, matricule école et national,
  photo et photo de l’extrait, départ et statut, fiche élève, registre, import Excel (.xlsx, .xls, .csv).
- Classes : niveaux ouverts, classes multigrades ou jumelées, affectation des enseignants, type de
  fonctionnement.
- Notes : grilles officielles CP / CE / CM, barèmes et coefficients, absents aux compositions, matières de
  composition au CP, moyennes, rangs, mentions, MGA (règle des 4 évaluations ou 3 compositions + passage),
  décisions de fin d’année, passage à l’année suivante avec archives et parcours scolaire.
- Comptes enseignants (une classe ou plusieurs), validation des saisies, ouverture et date limite de
  saisie, messages du directeur, suivi des classes, journal.
- Absences : appel du jour (présent / absent / absent justifié), demandes d’autorisation (personnel et
  élèves) avec justification automatique des jours de classe.
- Vie scolaire (emploi du temps, cahier de textes, discipline, infirmerie, calendrier), finances (frais,
  versements et reçus, dépenses, cantine), services (bibliothèque, CEPE, parents), liaison IEPP.
- Rapports officiels (rentrée, composition, mensuel, fin d’année, CM2, notes par classe, infrastructures,
  synthèse IEPP), générateur de rapports à blocs, statistiques.
- Fonctionnement hors ligne en un seul fichier ; école de démonstration.

### Corrigé

| Défaut de la 1.7.0 | Correction |
|---|---|
| Perte silencieuse au-delà de la capacité de `localStorage` | IndexedDB (images à part), erreur d’enregistrement **visible** avec « Réessayer », repli signalé par un bandeau permanent |
| Mot de passe administrateur et code de secours en clair | empreintes PBKDF2-SHA-256 (310 000 itérations) ; code de secours propre à chaque installation, montré une fois ; mot de passe 1.x converti puis effacé, changement imposé s’il est faible |
| QR code de la fiche scolaire avec filiation, acte de naissance et téléphone, sans vérification | QR minimal (référence, dates, empreinte ; nom et matricule seulement pour les cartes) signé ECDSA P-256 et contrôlé au registre |
| Plantage du passage d’année quand un niveau supérieur n’est pas ouvert | élève admis vers un niveau non ouvert archivé avec la mention « à transférer » ; bilan affiché avant confirmation ; copie de sécurité préalable |
| Aucune détection de doublon à l’inscription | comparaison nom + prénoms + naissance, confirmation explicite « c’est un autre enfant » ; matricule national unique |
| Droits appliqués en partie par du CSS masquant des boutons | droits vérifiés dans chaque fonction métier (testé : 12 actions réservées refusées à un enseignant même appelées directement) |
| Correction d’une note validée possible par un enseignant en contournant l’écran (constaté pendant la refonte) | règle `notes.corriger` imposée dans `notes.saisir` et `notes.marquerAbsent` |
| Sauvegarde sans contrôle d’intégrité, restauration sans filet | empreinte SHA-256, analyse et aperçu avant restauration, mot de passe, copie de sécurité préalable, copies automatiques quotidiennes et avant opération |
| Type des notifications deviné sur le texte | types explicites (succès, avertissement, erreur, attente) |
| Validation hétérogène | module unique de validation (noms, téléphones de Côte d’Ivoire, dates, années, notes à 2 décimales, matricules, références) |

Défauts trouvés par les tests automatisés pendant la refonte, puis corrigés :

- arrondi au centième inexact (hérité de la 1.7.0 : 10,075 donnait 10,07 ; moyenne de 10,01 et 10 donnait 10,00) ;
- note à une décimale refusée (8,7 / 10) par un contrôle des décimales en calcul binaire ;
- montant arrondi à zéro affiché « -0 F » ; DRENAET saisie « DE » seule mal interprétée ;
- niveau suivant d’un niveau inconnu égal à CP1 (risque au passage d’année) ;
- fichier de données abîmé (entrée vide dans une liste) empêchant l’ouverture : entrée ignorée et signalée ;
- entrée de journal seule (export, mot de passe refusé) non enregistrée avant la modification suivante ;
- export annulé par l’utilisateur inscrit au journal comme effectué ;
- conflit de nom entre « total des dépenses » et « enregistrer une dépense » (journal de caisse en erreur) ;
- filigrane SPÉCIMEN tronqué hors de la feuille ; planche de cartes à 8 au lieu de 10 ; zone d’impression
  vidée trop tôt après une impression ; bouton « copie » proposé avant l’émission de l’original ;
- fiche d’un élève d’une classe fermée inaccessible au directeur ; suggestions de sous-préfectures
  affichées « code,nom ».

Défauts trouvés par la relecture contradictoire des écrans Élèves, Notes, Absences, Personnel et Documents
(relecteurs distincts de l’auteur, défauts reproduits dans Chromium), puis corrigés et couverts par
`tests/e2e/revue.test.cjs` :

- **droits** : un enseignant obtenait par appel direct le classement, les décisions, les bulletins ou la
  liste d’une autre classe, et le registre de toute l’école (le contrôle ne portait que sur les documents
  inscrits au registre) : le droit est désormais vérifié pour tout modèle, dans le générateur ;
- **droits** : l’import faisait confiance à l’analyse (classe hors périmètre, élève invalide) : chaque ligne
  est contrôlée de nouveau au moment d’importer ; « remplacer » un document au registre et marquer lus
  les messages d’un collègue n’exigeaient aucun droit ;
- **validation des notes** : l’absence posée par un enseignant comptait (moyenne 0) sans validation et il
  pouvait lever une absence enregistrée : l’absence attend maintenant la validation comme une note ;
  le directeur effaçait des notes validées en cochant « Absent » sans mot de passe ; une note en attente
  vidée par le directeur restait en attente et était validée ensuite ;
- **perte de données** : le passage d’année effaçait les notes en attente (désormais archivées et signalées)
  et se poursuivait si la copie de sécurité échouait (il est maintenant refusé) ; un double clic sur
  « Importer » inscrivait deux fois les mêmes élèves ; « Tout le monde présent » effaçait aussi les
  absences justifiées par une autorisation accordée ; une année déjà archivée pouvait être écrasée ;
- **cohérence** : changer un élève de classe en cours d’année gardait ses notes au barème de l’ancienne
  classe (confirmation, notes mises de côté dans son dossier) ; matricule d’un élève à la corbeille
  réattribué (doublon après restauration) ; « Rouvrir la saisie » sans effet après une date limite dépassée ;
  évaluations incomplètes (matières sans note) non signalées en fin d’année ;
- **import Excel** : dates au format date d’Excel perdues ; matricule école de l’export « format national »
  refusé à la réimportation ; doublons (élève sans date de naissance, ligne répétée) non détectés ; colonne
  « date acte » ignorée ; naissance future acceptée ; message de copie de sécurité affiché même sans copie ;
- **journal** : motif libre d’un départ d’élève et chaque note en attente (nom et valeur) inscrits au journal ;
- **interface** : choix de fichier (import, photo, photo du QR) inaccessible au clavier ; focus perdu après
  une décision ou une absence ; case refusée gardant la valeur refusée ; compteur de notes ignorant les notes
  en attente ; bouton « Inscrire un élève » de l’accueil sans effet ; bouton « Excel (CSV) » proposé à
  l’enseignant puis refusé ; actions de sélection silencieuses après suppression d’un élève ; n° et date
  d’acte marqués obligatoires mais non exigés.

### Amélioré

- Interface entièrement redessinée : structure bleu nuit, surfaces blanc cassé, accent cuivré, thème
  sombre, menu repliable, navigation par onglets, recherche globale (élèves, personnel, écrans,
  références), fiches latérales, tableaux avec recherche, tri, pagination, sélection et export, états vides,
  fenêtres protégées contre la perte de saisie, erreurs affichées sous le champ concerné, version téléphone
  avec barre de navigation basse, animations réductibles.
- Documents : moteur indépendant des écrans, modèles versionnés et personnalisables sans HTML, feuilles aux
  dimensions physiques (A4, A5, paysage), pagination automatique, en-tête officiel, zones de signature et de
  cachet laissées vierges, filigranes paramétrables et mentions de statut automatiques.
- **Registre des documents** : référence unique avec clé de contrôle, émission à l’impression (l’aperçu n’inscrit
  rien), copie conforme contrôlée, duplicata (l’original devient « remplacé »), annulation motivée, historique
  des impressions, versions successives des bulletins et fiches.
- **Cartes d’identification** élèves et personnel : ID-1 paysage ou portrait, badge, format personnalisé ;
  planche A4 de 10 cartes avec traits de coupe, recto-verso, départ à un emplacement choisi, impression à
  l’unité ; validité.
- **Vérification** : saisie de la référence, lecture du QR par caméra ou photo (décodeur hors ligne intégré,
  correction d’erreurs Reed-Solomon), verdict détaillé (intégrité, émetteur, registre, statut) ; **outil de
  vérification autonome** à remettre à l’IEPP.
- Clés de signature : création, rotation, déclaration de compromission ; clé privée chiffrée.
- Hôtes : navigateur, application Windows PySide6, emballage Electron (vrai export PDF), application Android
  existante (stockage dans les fichiers de l’application).
- Journal des opérations étendu (2 000 entrées) sans données personnelles inutiles ; diagnostic technique.
- Renforcements : seul un membre du personnel actif est titulaire d’une classe ; la numérotation des reçus
  reprend toujours au-delà du plus grand numéro existant (après restauration ou import).

### Remplacé

| Avant | Après |
|---|---|
| `localStorage` (clé `akwa_school_v5`) | IndexedDB (clé 1.x lue et **jamais effacée**) |
| Impression du HTML des écrans | moteur documentaire et zone d’impression dédiée |
| Bouton « PDF » ouvrant la boîte d’impression sans le dire | libellé honnête (« choisissez Enregistrer au format PDF ») ; vrai PDF dans l’emballage Windows |
| QR à données en clair | QR minimal signé |
| Activation dans la page | protection de la diffusion confiée à l’emballage signé (voir `SECURITE.md`) |

### Retiré

- Code d’activation et licence dans la page (n’apportaient aucune protection réelle).
- Code de secours universel commun à toutes les installations.

### Migration des données 1.x

- Reprise automatique proposée au premier lancement (données du navigateur `akwa_school_v5`, ou fichier
  `etat_v8.json` de l’application Android), ou par restauration d’une sauvegarde `.json` 1.x.
- Aucune donnée métier n’est perdue : élèves, personnel, notes, absences, appels, autorisations,
  rapports rédigés, archives, vie scolaire, finances, services, journal.
- Les secrets en clair sont convertis en empreintes puis supprimés ; les images non conformes
  (types non autorisés) sont écartées et signalées.
