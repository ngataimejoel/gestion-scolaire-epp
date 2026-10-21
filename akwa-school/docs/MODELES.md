# Modèles de documents

Les documents sont produits par des **modèles versionnés**, indépendants des écrans
(`src/js/docs/modeles/*.js`). L’école peut les personnaliser dans **Paramètres › Modèles de documents** ;
seules ses différences sont enregistrées (`S.modeles[id]` : version du modèle, révision, date, auteur,
réglages). « Rétablir le modèle d’origine » efface ces différences.

## Catalogue

| Famille | Modèles | Registre |
|---|---|---|
| Élèves | bulletin de composition, bulletin annuel, fiche scolaire (modèle officiel), certificat de scolarité, attestation de fréquentation, certificat de transfert (exeat), fiche individuelle, fiche d’inscription | oui (bulletins et fiches : une référence par élève et par période, versions successives) |
| Cartes | carte d’identité scolaire, carte professionnelle du personnel | oui, avec date de fin de validité |
| Personnel | attestation de service, demande d’autorisation d’absence | attestation : oui |
| Listes et états | liste de classe, registre général, état de classe, classement, décisions, effectifs, élèves par âge, dossiers à régulariser, liste du personnel, candidats au CEPE | non (états de gestion datés) |
| Rapports | rentrée, composition, mensuel, fin d’année, CM2, notes par classe, synthèse IEPP, infrastructures, transmission IEPP, rapport personnalisé | non |
| Opérations | reçu de versement (A5 ou A4), journal de caisse, convocation des parents, emploi du temps, cahier de textes, demande d’absence d’un élève | reçu : numéro de reçu propre |

## Réglages personnalisables

| Réglage | Contrôle appliqué à l’enregistrement |
|---|---|
| Titre, sous-titre | 90 et 140 caractères ; **aucun HTML** |
| Texte rédigé | 4 000 caractères ; **aucun HTML** ; champs dynamiques connus uniquement ; `**gras**` |
| Champs affichés | cases propres à chaque modèle (photo, naissance, parents, appréciations…) |
| Page | papier A4 ou A5 et orientation **si le modèle les autorise** ; marges 5 à 35 mm |
| En-tête | officiel (ministère, direction, inspection, école, République, devise, armoiries) ou compact ; logos ; ligne supplémentaire (140 caractères) |
| Signatures | 4 au plus : rôle, nom (champ dynamique possible), cadre, zone de cachet ; hauteur 10 à 50 mm |
| Filigrane | aucun, logo, nom de l’école, « DOCUMENT OFFICIEL », texte (60 caractères) ; opacité 2–30 %, taille 20–100 %, rotation −90° à 90°, position, couleur `#rrggbb`, répétition, écran et/ou impression |
| QR code | actif, nom et matricule inclus ou non, taille 14 à 40 mm |
| Pied de page | texte (160 caractères), référence, numéros de page |
| Cartes | format ID-1 paysage / portrait, badge 70 × 100, personnalisé 40–150 mm ; verso ; validité (fin d’année, date fixe, aucune) ; couleurs |

Un modèle **ne peut ni exécuter de code, ni modifier les données, ni changer les droits** : il ne fait que
dessiner à partir des données qu’on lui fournit. Les mentions de statut (SPÉCIMEN, COPIE, DUPLICATA,
ANNULÉ, PROVISOIRE) sont imposées par l’état réel du document et ne sont pas modifiables par un modèle.

## Champs dynamiques

Écrire le nom entre accolades dans le texte, par exemple `{eleve.nomComplet}`.

**École et document** : `{ecole}` nom de l’école · `{ecole.nomLong}` « École primaire publique de … » ·
`{ecole.code}` · `{iepp}` · `{drenaet}` · `{localite}` · `{annee}` année scolaire · `{directeur}`
civilité et nom · `{directeur.titre}` « Directeur » ou « Directrice » · `{date}` date du jour en toutes
lettres · `{date.courte}` jj/mm/aaaa · `{reference}` référence du document.

**Élève** : `{eleve.nomComplet}` · `{eleve.nom}` · `{eleve.prenoms}` · `{eleve.matricule}` ·
`{eleve.classe}` · `{eleve.naissance}` · `{eleve.lieuNaissance}` · `{eleve.ne}` « né / née » ·
`{eleve.sexe}` · `{eleve.nationalite}` · `{eleve.entree}` · `{eleve.statut}` · `{eleve.motifDepart}` ·
`{eleve.lelui}` « le / la » · `{eleve.inscrit}` « inscrit / inscrite ».

**Personnel** : `{agent.nom}` · `{agent.fonction}` · `{agent.matricule}` · `{agent.emploi}` ·
`{agent.classes}` · `{agent.entree}`.

Un champ inconnu est refusé à l’enregistrement, avec un message sous le texte.

## Mise en page

- Feuilles aux dimensions physiques (A4 210 × 297 mm, A5 148 × 210 mm, paysage) avec marges en mm.
- Longs tableaux paginés automatiquement : en-tête de tableau répété, bloc final (récapitulatif,
  signatures) jamais isolé sur une page.
- Documents d’une page : réduction automatique plafonnée à 72 % ; au-delà, un avertissement propose de
  retirer un bloc ou de passer en paysage.
- Pied de page : référence, statut, coordonnées de l’école, « Page n / N ».

## Versions

Chaque modèle porte une version (`version`). Une personnalisation garde la version sur laquelle elle a été
faite ; si le modèle d’origine évolue, l’éditeur le signale. Chaque document émis enregistre au registre
la version du modèle utilisée.
