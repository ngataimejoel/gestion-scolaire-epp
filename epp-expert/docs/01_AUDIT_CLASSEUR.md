# Étape 1 — Audit du classeur source

Fichier analysé : `GESTION_SCOLAIRE_EPP_MODELE_EXPERT (16).xlsm` (707,7 Ko).
L'original n'a pas été modifié : l'analyse a été faite sur une copie, avec `openpyxl` (formules et valeurs en cache), `olevba` (code VBA) et la lecture directe du XML (boutons, graphiques, commentaires).

## 1. Vue d'ensemble

| Élément | Quantité |
|---|---|
| Feuilles | 19 (13 visibles, 6 masquées) |
| Procédures VBA | 58 (module `modImpression` + 2 événements dans `ThisWorkbook`) ; les 19 modules de feuille sont vides |
| Boutons (formes avec macro) | 85 répartis sur les 19 feuilles |
| Listes déroulantes / validations | 115 règles |
| Mises en forme conditionnelles | 135 règles |
| Graphiques | 2 (tableau de bord) |
| Commentaires de cellule | 35 (aide à la saisie) |
| Noms définis | aucun |
| Données d'exemple (fictives) | 64 élèves, 8 agents, 22 événements d'absence élèves, 6 événements d'absence personnel, notes complètes pour 4 évaluations |

**Principe du classeur** (feuille NOTICE) : une seule base d'élèves (REGISTRE ELEVES) et une seule base de personnel (PERSONNEL). Toutes les autres feuilles sont des vues calculées. Capacité pré-formatée : 241 élèves (lignes 10 à 250) et 60 agents.

## 2. Inventaire des feuilles

| # | Feuille | État | Rôle | Saisie |
|---|---|---|---|---|
| 1 | TABLEAU DE BORD | visible | 8 indicateurs, tableau effectifs/résultats par classe, 6 alertes, 2 graphiques, 18 boutons, liens de navigation | aucune |
| 2 | PARAMETRES | visible | Identité de l'école, année scolaire, directeur, dates (édition, référence des âges), listes de choix, seuils/barèmes par classe, calendrier des 4 évaluations (2 colonnes : CP1–CM1 et CM2), jours de classe par mois | oui (cellules jaunes) |
| 3 | REGISTRE ELEVES | visible | Base unique des élèves : 32 colonnes utiles + 3 clés techniques | oui |
| 4 | NOTES CP | visible | CP1 + CP2 : 8 matières notées sur 10 avec coefficients, 4 évaluations | oui |
| 5 | NOTES CE1 | visible | 4 matières avec barèmes (/50, /40, /40, /10 = /140), moyenne sur 10 | oui |
| 6 | NOTES CE2-CM1 | visible | 4 matières (/50, /50, /50, /20 = /170), moyenne sur 10 | oui |
| 7 | NOTES CM2 | visible | 2 compositions (/170) + 2 examens blancs avec « Épreuves physiques /20 » (/190), moyenne sur 20 | oui |
| 8 | RESULTATS | masquée | CP1–CM1 : moyennes, MGA, décision, rang, observation | aucune |
| 9 | RESULTATS CM2 | masquée | CM2 : MGA sur 20, décision (entrée en 6e), rang, observation | aucune |
| 10 | ETAT PAR CLASSE | masquée | Liste d'une classe choisie (C8) + statistiques de la classe + signature | choix de la classe |
| 11 | EFFECTIFS | masquée | Tableau des effectifs par classe × 8 indicateurs × G/F/T + contrôle de cohérence | aucune |
| 12 | SYNTHESE FIN D'ANNEE | masquée | Inscrits, présents, abandons, seuil, admis, taux, redoublants, effectif probable de l'année suivante | aucune |
| 13 | RAPPORT DE COMPOSITION | visible | Pour la composition N° 1–4 : inscrits, présents, absents, admis, taux par classe et sexe ; trois meilleurs par niveau ; observations | n° de composition + observations |
| 14 | RAPPORT DE RENTREE | visible | Liste du personnel + effectifs redoublants / non redoublants par classe et sexe | observations |
| 15 | ABSENCES ELEVES | visible | Journal des retards et absences des élèves | oui |
| 16 | ABSENCES PERSONNEL | visible | Journal des retards et absences du personnel | oui |
| 17 | RAPPORT MENSUEL | visible | Rapport mensuel du directeur : effectifs, abandons, taux de fréquentation, assiduité du personnel, résultats de l'évaluation du mois, 9 zones à rédiger | mois + zones de texte |
| 18 | PERSONNEL | visible | Liste du personnel (16 colonnes) + récapitulatif par fonction et sexe + contrôle « classes sans enseignant » | oui |
| 19 | NOTICE | masquée | Notice d'utilisation (15 rubriques) | aucune |

## 3. Champs de saisie et tableaux de données

### PARAMETRES
- Identité : ministère (C4), DREN (C5), IEPP (C6), nom de l'école (C7), code (C8), année scolaire (C9), localité (C10), directeur (C11), date d'édition (C12), date de référence des âges (C13), nouveaux CP1 attendus (C14), secteur pédagogique (C15).
- Listes de choix : Classe (E3:E8 = CP1, CP2, CE1, CE2, CM1, CM2), Sexe (M/F), Nationalité (9 valeurs), Oui/Non, Orphelin de (-, PERE, MERE, PERE ET MERE), Statut (PRESENT, ABANDON, TRANSFERE), Fonctions du personnel (7 valeurs).
- Seuils d'admission (B18:D23) : seuil de la moyenne de passage et barème (/10 ou /20) par classe. CP1–CM1 : 5/10 ; CM2 : 10/20.
- Calendrier des évaluations (B29:D32) : 4 évaluations, une date pour CP1–CM1 et une pour CM2.
- Jours de classe par mois (B38:D48) : septembre à juillet.

### REGISTRE ELEVES (colonnes A à AI)
N° (calculé), Matricule École (calculé), Matricule DESPS (saisi), Nom et prénoms, Sexe, Classe, Date de naissance, Âge (calculé), Nationalité, Localité, Sous-préfecture, Extrait (OUI/NON), Acte N°, Du, Centre d'état civil, Orphelin, Orphelin de, Père (nom, profession, résidence, téléphone), Mère (idem), Tuteur (idem), Redoublant, Statut, Observations, et 3 clés techniques (AG, AH, AI) utilisées par les autres feuilles.

### Feuilles de notes
Colonnes A–F tirées du registre ; pour chaque évaluation : « Présent ? » (OUI/NON), notes par matière, (TOTAL pour CE1 à CM2), MOYENNE. Ligne 8 : coefficients (CP) ou barèmes (CE1 à CM2), modifiables.

### PERSONNEL (A à P)
N°, Matricule, Nom, Sexe, Date de naissance, Âge, Fonction, Grade/Emploi, Classe tenue, Diplôme, Date de prise de service, Ancienneté, Date d'arrivée dans l'école, Téléphone, Situation matrimoniale, Observations.

### ABSENCES ELEVES / ABSENCES PERSONNEL (A à O)
N°, Date, Matricule, Nom (calculé), Classe ou cours tenu (calculé), Sexe (calculé), Nature (RETARD/ABSENCE), Jours d'absence (0 à 31, demi-journées possibles), Retard en minutes (0 à 600), Motif, Justifié, Observations, + mois/année/clé techniques.

## 4. Formules et règles de calcul

| Règle | Formule source | Où |
|---|---|---|
| Matricule École | `CLASSE-NNN-AA` : NNN = rang de l'élève dans sa classe (ordre du registre), AA = 2 premiers chiffres de l'année (« 26 » pour 2026-2027) | REGISTRE!B |
| Âge | `DATEDIF(naissance ; date de référence ; "y")` (date fixe, pas AUJOURDHUI) | REGISTRE!H, PERSONNEL!F |
| Ancienneté | `DATEDIF(prise de service ; date d'édition ; "y")` | PERSONNEL!L |
| Moyenne d'une évaluation (CP) | Σ(note × coef) ÷ Σ(coef des matières notées), arrondi à 2 décimales ; 0 si « Présent ? » = NON ; vide si aucune note | NOTES CP |
| Moyenne d'une évaluation (CE1 à CM2) | Σ(notes) ÷ Σ(barèmes des matières notées) × 10 (× 20 pour CM2), arrondi à 2 décimales ; 0 si absent ; vide si aucune note | NOTES CE1, CE2-CM1, CM2 |
| Total des points | Σ(notes) ; 0 si absent | NOTES CE1 à CM2 |
| Moyenne des 3 compositions | Moyenne des compositions renseignées (1 à 3), arrondie à 2 décimales | RESULTATS!J |
| MGA CP1–CM1 | (moyenne des 3 compos + 2 × compo de passage) ÷ 3, arrondi à 2 décimales ; vide s'il manque la moyenne des compos ou la compo de passage | RESULTATS!L |
| MGA CM2 | (C1 + C2 + EB1 + EB2) ÷ 4, arrondi à 2 décimales, **seulement si les 4 moyennes existent** | RESULTATS CM2!J |
| Décision | ABANDON ou TRANSFERE selon le statut ; sinon ADMIS si MGA ≥ seuil de la classe, sinon REDOUBLE ; vide si pas de MGA | RESULTATS!O |
| Rang | 1 + nombre d'élèves PRESENTS de la même classe ayant une MGA strictement supérieure (ex æquo au même rang) | RESULTATS!P |
| Observation | ADMIS : MGA ramenée sur 10 ≥ 8 « Très bien », ≥ 7 « Bien », ≥ 6 « Assez bien », sinon « Passable » ; REDOUBLE : « Insuffisant » | RESULTATS!Q |
| Effectifs | Comptages par classe et sexe (inscrits, ivoiriens, étrangers, orphelins, avec/sans extrait, redoublants, abandons) | EFFECTIFS, ETAT PAR CLASSE |
| Synthèse | Présents = statut PRESENT ; abandons = inscrits − présents (transferts inclus) ; taux d'admission = admis ÷ présents (y compris le total, qui n'est pas une moyenne des taux) | SYNTHESE |
| Effectif probable N+1 | redoublants de la classe + admis de la classe précédente ; CP1 = redoublants + nouveaux inscrits attendus ÷ 2 arrondi (par sexe) ; les admis de CM2 sortent | SYNTHESE!U:W |
| Rapport de composition | Présents = élèves ayant une moyenne à la composition et « Présent ? » ≠ NON ; absents = « Présent ? » = NON ; admis = moyenne ≥ seuil ; taux = admis ÷ présents ; 3 meilleurs par classe (ex æquo : premier inscrit au registre) | RAPPORT DE COMPOSITION |
| Taux de fréquentation | max(0 ; 1 − jours d'absence du mois ÷ (effectif inscrit × jours de classe du mois)) | RAPPORT MENSUEL!H:J |
| Évaluation du mois | dernière évaluation dont la date (calendrier) tombe dans le mois choisi ; une pour CP1–CM1, une pour CM2 | RAPPORT MENSUEL!P8, P10 |
| Assiduité du personnel | par agent : nombre de retards / d'absences, jours + minutes cumulés, motif du 1er événement « (+n autre(s)) » | RAPPORT MENSUEL!F:J |
| Indicateurs du tableau de bord | effectif, % filles, présents, taux d'abandon, taux d'admission global, sans extrait, enseignants (fonctions INSTITUTEUR* + DIRECTEUR*), ratio élèves/enseignant | TABLEAU DE BORD |
| Contrôles | total des effectifs = nombre d'élèves du registre ; classes sans enseignant ; homonymes ; élèves sans classe ; MGA manquantes ; élèves en sur-âge | EFFECTIFS!B19, RAPPORT DE RENTREE!B35, TABLEAU DE BORD!J12:J17 |

## 5. Macros VBA

Toutes les macros servent à **imprimer, exporter en PDF, naviguer ou produire des fichiers Excel figés**. Aucune ne calcule une donnée : les calculs sont tous dans les formules.

| Macro(s) | Fonction | Équivalent dans l'application |
|---|---|---|
| `Workbook_Open`, `Workbook_BeforePrint`, `AjusterZonesImpression`, `AjusterImpressionEtInformer`, `MiseEnPageA4`, `DerniereLigneUtile`, `ColonneFinImpression`, `ASauts` | Recale les zones d'impression sur la dernière ligne saisie, A4, marges 0,8/1,2 cm, ajustement en largeur, en-têtes répétés | Moteur de rendu : la mise en page est calculée à chaque génération (A4, marges, colonnes ajustées, en-tête répété, pas de page vide) |
| `AfficherMasquerFeuillesCalculees`, `Montrer`, `Remasquer` | Affiche/masque les 6 feuilles calculées | Sans objet : les vues calculées sont des écrans de l'application |
| `ApercuEtat`, `ImpRegistre`, `ImpResultatsCM2`, `ImpPersonnel`, `ImpAbsencesEleves`, `ImpAbsencesPersonnel`, `ImprimerResultats`, `ImprimerSyntheseAnnee`, `ImprimerEffectifs`, `ImprimerNotice`, `ApercuFeuille`, `ImprimerRapportRentree`, `ImprimerRapportMensuel`, `ImprimerRapportComposition`, `ImpNotesClasse` | Aperçu avant impression d'un état (orientation, pied de page « nom – école – Page p / n ») | Modèles de rapports intégrés + aperçu / impression / PDF / Excel |
| `ImprimerEtatClasse`, `ImprimerClasse`, `PreparerMiseEnPage`, `RestaurerAffichage`, `ClasseChoisieOK`, `ImprimerToutesLesClasses` | État d'une classe sur une page (lignes vides masquées), ou toutes les classes à la suite | Modèle « État des élèves par classe » avec filtre Classe, et option « toutes les classes » |
| `ExporterEtatsPDF`, `PDFFeuille`, `ExporterRapportRentreePDF`, `ExporterRapportMensuelPDF`, `ExporterRapportCompositionPDF`, `ExporterPDFClasse`, `ExporterToutesLesClassesPDF`, `NettoyerNomFichier`, `AnneeScolaire`, `ClassesDisponibles`, `FeuilleEtat` | Export PDF dans un dossier `ETATS_<année>` / `ETATS_CLASSES_<année>` avec noms de fichiers nettoyés | Export PDF (unitaire ou par lot) vers un dossier choisi, mêmes conventions de nommage |
| `ImprimerDossierFinAnnee` | Imprime tableau de bord + effectifs + synthèse + rapport de rentrée + personnel | Action « Dossier de fin d'année » (lot de 5 rapports) |
| `MettreAJourDossier`, `ExporterGroupe`, `AjouterFeuilleLien`, `FichierLie`, `FeuillesLiees`, `OuvrirLie`, `Ouvrir*Lie` (6), `OuvrirDossierDeTravail` | Génère 6 classeurs Excel « à valeurs figées » (registre, notes, résultats, rapports, personnel, notice) et les ouvre | Module Import/Export : export des 6 classeurs figés + ouverture du dossier |
| `RetourTableauDeBord` | Navigation | Menu latéral |

## 6. Listes déroulantes et contrôles de saisie

- REGISTRE : Sexe, Classe, Nationalité, Extrait, Orphelin, Orphelin de, Redoublant, Statut (listes de PARAMETRES) ; date de naissance entre 01/01/2005 et 31/12/2022 ; Matricule DESPS : exactement 9 caractères avec une majuscule en première ou en dernière position (A12345678, 12345678B), surligné en rouge si une valeur collée ne respecte pas la règle.
- NOTES : « Présent ? » OUI/NON ; note numérique entre 0 et le coefficient max (10 pour CP) ou le barème de la matière ; saisie refusée si l'élève est absent à l'évaluation.
- ABSENCES : date entre 01/09/2026 et 31/08/2027, Nature RETARD/ABSENCE, jours 0–31 (décimal), retard 0–600 min (entier), Justifié OUI/NON ; « Matricule inconnu » en rouge.
- PERSONNEL : Sexe, Fonction, Classe tenue ; une classe tenue par deux agents est surlignée.
- RAPPORT DE COMPOSITION : n° 1 à 4 ; RAPPORT MENSUEL : mois de septembre à juillet ; ETAT PAR CLASSE : classe.
- PARAMETRES : barème 10 ou 20.

Mises en forme notables : ABANDON en rose, TRANSFERE en gris, extrait NON en jaune, moyenne < moitié du barème en rouge, note > barème signalée, rang ≤ 3 mis en valeur, taux < 50 % en rouge et ≥ 75 % en vert.

## 7. Tableaux de bord et rapports existants

1. Tableau de bord (8 indicateurs, tableau par classe, 6 alertes, 2 graphiques : effectifs G/F par classe, taux d'admission par classe).
2. Registre des élèves (paysage).
3. Feuilles de notes (une page par évaluation).
4. Résultats CP1–CM1 et résultats CM2 (paysage).
5. État des élèves par classe + statistiques de la classe (une page, paysage).
6. Tableau des effectifs (paysage).
7. Synthèse de fin d'année (paysage).
8. Rapport de composition (une page, paysage).
9. Rapport de rentrée (paysage).
10. Rapport mensuel du directeur (portrait, plusieurs pages).
11. Liste du personnel + récapitulatif (paysage).
12. Journaux des absences élèves et personnel (paysage).
13. Notice (portrait).

Présentation commune : en-tête officiel à deux colonnes (Ministère / DREN / IEPP / école à gauche ; « RÉPUBLIQUE DE CÔTE D'IVOIRE – Union – Discipline – Travail – Année scolaire » à droite), titre centré, bloc « Fait à <localité>, le <date d'édition> – LE DIRECTEUR – <nom> ».

## 8. Relations entre les feuilles

```
PARAMETRES ──► toutes les feuilles (en-têtes, listes, seuils, calendrier, jours de classe)
REGISTRE ELEVES ──(clé de position AI)──► NOTES CP / CE1 / CE2-CM1 / CM2
REGISTRE ELEVES ──(clé AH)──► RESULTATS / RESULTATS CM2 ◄──(matricule)── NOTES
REGISTRE ELEVES ──(clé AG)──► ETAT PAR CLASSE, RAPPORT DE COMPOSITION, RAPPORT MENSUEL
REGISTRE ELEVES ──(matricule)──► ABSENCES ELEVES ──► RAPPORT MENSUEL
PERSONNEL ──► ABSENCES PERSONNEL ──► RAPPORT MENSUEL ; PERSONNEL ──► RAPPORT DE RENTREE, TABLEAU DE BORD
RESULTATS (+CM2) ──► SYNTHESE FIN D'ANNEE, TABLEAU DE BORD
```

## 9. Erreurs, incohérences et points de vigilance

| # | Constat | Gravité | Traitement dans l'application |
|---|---|---|---|
| A1 | **Alerte « élèves en sur-âge » erronée** : la formule (TABLEAU DE BORD!J17) compare la colonne G (date de naissance, un nombre de série ≈ 45 000) à 9, 10… au lieu de la colonne H (âge). Résultat affiché : 64 élèves en sur-âge sur 64. Avec l'âge, le résultat réel est 0. | Élevée | Corrigé (comparaison sur l'âge). L'écart est documenté dans le rapport de validation. |
| A2 | **Les notes sont liées à la position de l'élève dans le registre** (clé `CP-1`, `CE1-1`…) et non à son identité. Insérer, trier ou changer la classe d'un élève dans le registre décale les notes saisies vers un autre élève. | Élevée | Les notes sont rattachées à l'identifiant interne de l'inscription : aucun décalage possible. |
| A3 | **Le Matricule École est recalculé** à chaque modification du registre (il dépend du rang de la ligne). Les journaux d'absences pointent vers une cellule du registre (`='REGISTRE ELEVES'!B22`) au lieu de contenir le matricule. | Moyenne | Le matricule est attribué une fois à l'inscription et ne change plus ; les absences sont rattachées à l'élève. |
| A4 | Le RAPPORT DE RENTREE intitule sa section « Liste des enseignants » mais affiche **tout le personnel**, gardien compris (15 lignes maximum). Le rapport mensuel est limité à 12 agents. | Faible | Liste complète sans limite ; filtre par fonction possible dans le modèle. |
| A5 | **Règle de MGA différente** : CP1–CM1 calculent la moyenne des compositions présentes (1 à 3), alors que le CM2 exige les 4 moyennes. | Information | Conservé tel quel (règle métier documentée), paramétrable par classe. |
| A6 | Un élève absent à une évaluation reçoit 0 et cette note entre dans la MGA (conforme à la notice). Un élève ABANDON est compté « présent » à une composition s'il y a une moyenne. | Information | Conservé ; signalé dans l'aide. |
| A7 | Le rapport mensuel contient des lignes PS/MS/GS (préscolaire) alors que ces classes n'existent pas dans les listes. | Faible | Les classes viennent de la configuration ; le préscolaire peut être ajouté. |
| A8 | Classes, groupes de notes, nombre d'évaluations et dates de validation (2005–2022, 2026–2027) sont **codés en dur** ; ajouter une classe demande de recopier des lignes dans plusieurs feuilles. | Moyenne | Classes, matières, barèmes, évaluations et années sont paramétrables. |
| A9 | Capacité limitée à 241 élèves / 60 agents ; une seule année scolaire par fichier. | Moyenne | Pas de limite ; multi-années avec réinscription. |
| A10 | Aucune protection : pas de mot de passe, pas d'historique, pas de sauvegarde. | Moyenne | Comptes et rôles, journal des actions, sauvegardes. |
| A11 | Doublon de compétence : la colonne « Présent ? » vide vaut présent ; une note saisie pour un absent est refusée par la validation mais pas par un collage. | Faible | Validation systématique côté application. |
| A12 | Le Matricule DESPS n'est pas renseigné dans les données d'exemple (64 cases vides) ; 14 élèves sans extrait (Acte/Du/Centre vides, cohérent). 44 élèves sans tuteur. | Information | Champs facultatifs, contrôle de format conservé. |
| A13 | Doublons détectés : aucun homonyme exact parmi les 64 élèves ; aucune classe tenue par deux agents. | — | Contrôles conservés dans le tableau de bord. |

## 10. Valeurs de référence (cache Excel) qui serviront à la validation

Effectif 64 (35 G / 29 F), 59 présents, 5 abandons, filles 45,3 %, taux d'abandon 7,8 %, taux d'admission 54,2 % (32 admis / 59 présents), 14 sans extrait, 7 enseignants, ratio 9,14 ; synthèse : effectif probable 79 ; rapport de composition n° 1 : taux global 53,2 % ; rapport mensuel d'octobre : 22,5 jours d'absence, fréquentation 98,4 %.
