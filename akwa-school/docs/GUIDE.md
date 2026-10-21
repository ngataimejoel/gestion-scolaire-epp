# Guide d’utilisation d’AKWA SCHOOL 2

## 1. Premier lancement

Ouvrez `AKWA_SCHOOL.html` (double-clic) avec Chrome, Edge ou Firefox récent, ou l’application installée
(Windows, Android). Quatre choix :

| Choix | Quand l’utiliser |
|---|---|
| **Reprendre les données d’AKWA SCHOOL 1.x** | proposé seulement si l’ancienne version a laissé des données sur cet appareil ; les anciennes données ne sont jamais effacées |
| **Créer mon école** | identité de l’école, année et niveaux ouverts, mot de passe du directeur |
| **Restaurer une sauvegarde** | fichier `.akwa.json` (version 2) ou `.json` de la version 1.x |
| **École de démonstration** | pour découvrir : directeur `Demo2026`, enseignants `Classe2026` ; documents marqués SPÉCIMEN |

À la création, un **code de secours** s’affiche **une seule fois** : notez-le et rangez-le. Il permet de
choisir un nouveau mot de passe en cas d’oubli, sans Internet.

## 2. Se repérer

- **Menu** à gauche (réductible) ; sur téléphone, barre en bas et bouton « Menu ».
- **Recherche** (`Ctrl K` ou `/`) : élève, membre du personnel, écran, référence de document.
- En haut : état d’enregistrement (« Enregistré »), vérification d’un document, alertes, thème, profil
  (changer de mot de passe, verrouiller, se déconnecter).
- Chaque modification est enregistrée automatiquement. Si l’enregistrement échoue, un bandeau rouge
  l’indique avec « Réessayer » : faites alors une sauvegarde sur clé USB.
- Après 15 minutes d’inactivité (réglable), l’écran se verrouille.

## 3. Élèves et classes

- **Inscrire** : onglets Identité, Naissance (avec ou sans extrait), Parents & tuteur, Scolarité & santé.
  Une erreur s’affiche sous le champ concerné, sans perdre ce qui est saisi. Un élève du même nom et de
  même naissance est signalé : confirmez seulement s’il s’agit d’un autre enfant.
- **Fiche élève** : clic sur un nom (résultats, identité, parents, santé, absences, frais, documents émis).
- **Départ** (transfert, abandon…) : l’élève reste au registre ; supprimer place l’élève dans la corbeille.
- **Import Excel** : aperçu ligne par ligne (à importer, doublon, erreur) avant confirmation ; copie de
  sécurité automatique juste avant.
- **Classes** : effectifs, enseignant (affectation), avancement des notes, appel du jour.

## 4. Notes et bulletins

- **Saisie** : `Tab` matière suivante, `Entrée` élève suivant ; enregistrement à chaque case ; totaux,
  moyennes et rangs recalculés aussitôt. Corriger une note déjà enregistrée demande le mot de passe du
  directeur.
- **Enseignants** : leurs notes attendent la validation du directeur si l’option est active (case orangée).
- **Validation** (directeur) : valider ou rejeter par classe et évaluation ; ouvrir, fermer la saisie, fixer
  une date limite ; évaluation en cours.
- **Résultats** : classement, mentions, bulletins (une classe entière ou un élève) ; bulletin annuel (MGA).
- **Fin d’année** : décisions proposées d’après la MGA, modifiables ; **passage à l’année suivante** avec
  bilan préalable, saisie de « PASSER », mot de passe et copie de sécurité automatique.

## 5. Absences

- **Appel** : un clic fait défiler Présent → Absent → Absent justifié (directeur). Un enseignant marque
  les absents ; seul le directeur lève une absence déjà enregistrée.
- **Autorisations** : demandes du personnel et des élèves ; accorder une demande d’élève justifie ses
  absences sur les jours de classe concernés ; impression de la demande.

## 6. Documents officiels, cartes et vérification

- **Émettre un document** (Documents › Émettre) : choisir le modèle, puis les élèves ou membres concernés.
  L’aperçu est un **brouillon** : la **référence** (`AK-CSC-2026-000012-7`) et le **QR code** sont attribués
  au moment d’**imprimer** ou d’enregistrer en PDF. Fermer l’aperçu n’inscrit rien au registre.
- **Signature électronique** : créez d’abord la clé de l’école (Paramètres › Sécurité & signature). Les QR
  codes sont alors signés ; sans clé, les documents restent vérifiables par le registre de cet ordinateur.
- **Cartes** (Documents › Cartes) : choisir les élèves ou le personnel, puis planche A4 de **10 cartes**
  (traits de coupe, recto-verso, emplacement de départ pour une feuille entamée) ou impression **à
  l’unité** (imprimante à cartes).
- **Registre** : tous les documents émis ; pour chacun : détails et historique, vérifier, **copie** (même
  référence, mention COPIE — seulement si les données n’ont pas changé), **duplicata** (nouvelle référence,
  l’original devient « remplacé » : carte perdue), **annuler** (motif et mot de passe).
- **Vérifier** : saisir une référence, scanner le QR avec la caméra ou importer une photo. Le résultat
  distingue l’intégrité (signature), l’émetteur (clé), l’inscription au registre et le statut (annulé,
  remplacé, expiré). Comparez toujours le nom et la photo avec la personne.
- **Outil de vérification autonome** (Documents › Vérifier) : fichier à remettre à l’IEPP ou à un autre
  établissement ; il contient les clés publiques et une **copie datée** du registre. Redistribuez-le après
  une annulation importante.

### Bien imprimer

Dans la boîte d’impression : papier **A4** (ou A5 pour un reçu), **échelle 100 %** (« Taille réelle »),
marges « Aucune » ou « Par défaut », **« Graphiques d’arrière-plan » activé** (couleurs et filigranes).
Pour obtenir un PDF dans le navigateur : bouton PDF, puis imprimante « Enregistrer au format PDF »
(ou « Microsoft Print to PDF »). L’application Windows enregistre directement un vrai fichier PDF.
Pour des cartes recto-verso, faites d’abord un essai sur papier ordinaire.

## 7. Personnel

- Fiches (civilité, matricule, fonction, emploi, classes, type de fonctionnement, photo, avis d’affectation).
- **Comptes enseignants** : identifiant et mot de passe provisoire affiché une seule fois ; l’enseignant le
  change à sa première connexion ; activer, désactiver, réinitialiser ; **suivi des classes**.
- **Messages** du directeur aux enseignants (lus à la connexion).

## 8. Vie scolaire, finances, services

- **Vie scolaire** : emploi du temps, cahier de textes, discipline (convocation imprimable), infirmerie
  (données confidentielles), calendrier des événements.
- **Finances** (directeur) : frais par niveau, versements avec **reçu numéroté** (A5 ou A4), annulation
  d’un reçu avec motif (le reçu reste, mention ANNULÉ), dépenses, journal de caisse, cantine.
- **Services** : bibliothèque (fonds, prêts, retards), dossiers du CEPE pièce par pièce, annonces et
  messages aux parents. AKWA SCHOOL **n’envoie pas de SMS** : il prépare le texte et les numéros
  (copier, ouvrir l’application SMS du téléphone, liste CSV), puis vous notez l’envoi.

## 9. Rapports et statistiques

Rapports officiels (rentrée, compositions, mensuel, fin d’année, CM2, notes par classe, infrastructures)
avec zones de rédaction à l’écran ; générateur de rapports à blocs ; statistiques ; **transmission IEPP**
(fichier et fiche récapitulative, historique).

## 10. Sauvegarder (indispensable)

Les données sont enregistrées dans l’ordinateur (ou le téléphone). Une panne, un vol ou un nettoyage du
navigateur peut les effacer : **seule une copie sur un autre support les protège**.

1. **Chaque semaine** (et avant toute opération importante) : Données › Sauvegarde › **Exporter une
   sauvegarde** sur une clé USB.
2. Gardez **plusieurs fichiers datés** (ne remplacez pas toujours le même) et **3 copies** : l’ordinateur,
   une clé USB, un autre support rangé ailleurs.
3. Vérifiez de temps en temps un fichier (« Vérifier un fichier ») sans rien restaurer.
4. Copies automatiques locales : une par jour (14 gardées) et avant chaque opération risquée (10 gardées).
   Elles sont dans le même ordinateur : elles **ne remplacent pas** la clé USB.
5. **Restaurer** : aperçu du fichier (école, date, contenu, intégrité), saisie de « RESTAURER », mot de
   passe ; l’état actuel est d’abord copié. Un fichier altéré est refusé.

## 11. Paramètres

- **École** : identité (verrouillée après la première saisie ; déverrouillage par mot de passe), contacts,
  en-tête officiel et logos, année scolaire, niveaux ouverts.
- **Modèles de documents** : titres, textes avec champs dynamiques, en-tête, signatures, filigrane, QR,
  format, cartes ; aperçu en direct ; rétablir le modèle d’origine. Voir `MODELES.md`.
- **Sécurité & signature** : mot de passe, code de secours, verrouillage automatique, clés de signature
  (création, rotation, compromission, export des clés publiques).
- **Calendrier** (jours fériés et congés), **Apparence** (couleur, thème sombre, animations), **Diagnostic**.

## 12. Mot de passe oublié

Écran de connexion › « Mot de passe oublié ? » › code de secours › nouveau mot de passe. Un nouveau code
de secours est alors donné. Par sécurité, la clé de signature protégée par l’ancien mot de passe est
retirée : créez-en une nouvelle (les documents déjà émis restent vérifiables).
