# Matrice de correspondance Excel → application

> **Avertissement (13/10/2026)** : les statuts ci-dessous sont les **objectifs**. Sont réellement testés à ce jour : calculs, résultats, statistiques, import du classeur, moteur et modèles de rapports (PDF / Excel), gestion des modèles. L'interface, la sauvegarde et l'installateur ne sont pas encore testés ; l'état réel sera publié dans `docs/RESULTATS_TESTS.md`.

Statut : ✅ reproduit et testé automatiquement · 🟡 reproduit, vérifié manuellement uniquement · ❌ non reproduit.
La colonne « Test » renvoie au fichier de `tests/` qui vérifie la fonctionnalité.

| Fonction du classeur | Feuille / macro | Module de l'application | Écran / composant | Test | Statut |
|---|---|---|---|---|---|
| Identité de l'école, DREN, IEPP, code, localité, directeur, secteur | PARAMETRES C4:C15 | Établissement & année | Paramètres → Établissement | test_db.py | ✅ |
| Année scolaire, date d'édition, date de référence des âges, nouveaux CP1 attendus | PARAMETRES C9, C12:C14 | Établissement & année | Paramètres → Années scolaires | test_db.py | ✅ |
| Listes de choix (classes, sexe, nationalités, oui/non, orphelin de, statut, fonctions) | PARAMETRES E:J | Paramètres généraux | Paramètres → Listes de choix | test_db.py | ✅ |
| Seuils et barèmes par classe | PARAMETRES B18:D23 | Classes & effectifs | Paramètres → Classes | test_calculs.py | ✅ |
| Calendrier des 4 évaluations (CP1–CM1 / CM2) | PARAMETRES B29:D32 | Évaluations | Paramètres → Évaluations | test_validation_excel.py | ✅ |
| Jours de classe par mois | PARAMETRES B38:D48 | Absences | Paramètres → Jours de classe | test_validation_excel.py | ✅ |
| Registre des élèves (32 champs) | REGISTRE ELEVES | Élèves | Élèves → fiche élève (4 onglets) | test_repositories.py | ✅ |
| N° d'ordre, âge | REGISTRE A, H | Élèves | colonnes calculées | test_calculs.py | ✅ |
| Matricule École CLASSE-NNN-AA | REGISTRE B | Inscriptions | attribué à l'inscription, stable | test_repositories.py | ✅ |
| Contrôle du Matricule DESPS (9 caractères, majuscule en tête ou en fin) | REGISTRE C (validation + MFC) | Élèves | validation du formulaire | test_validation.py | ✅ |
| Date de naissance bornée | REGISTRE G | Élèves | validation du formulaire | test_validation.py | ✅ |
| Statut PRESENT / ABANDON / TRANSFERE (pas de suppression) | REGISTRE AE | Inscriptions | fiche élève, couleurs rose/gris | test_repositories.py | ✅ |
| Feuilles de notes CP (coefficients), CE1, CE2-CM1, CM2 (barèmes) | NOTES * | Évaluations & notes | Notes → grille de saisie | test_calculs.py | ✅ |
| « Présent ? » NON : moyenne 0, saisie refusée | NOTES G, Q, AA, AK | Évaluations & notes | grille de saisie | test_calculs.py | ✅ |
| Moyenne pondérée / total ÷ barème | NOTES P, M… | Calculs | moteur `calculs.py` | test_validation_excel.py | ✅ |
| Moyenne des 3 compos, MGA, décision, rang, observation (CP1–CM1) | RESULTATS | Résultats | Résultats | test_validation_excel.py | ✅ |
| MGA CM2 sur 4 évaluations, décision entrée en 6e | RESULTATS CM2 | Résultats | Résultats (filtre CM2) | test_validation_excel.py | ✅ |
| État des élèves d'une classe + statistiques | ETAT PAR CLASSE | Classes & effectifs | Classes + rapport « État par classe » | test_validation_excel.py | ✅ |
| Tableau des effectifs + contrôle | EFFECTIFS | Statistiques | rapport « Tableau des effectifs » | test_validation_excel.py | ✅ |
| Synthèse de fin d'année + effectif probable | SYNTHESE FIN D'ANNEE | Statistiques | rapport « Synthèse de fin d'année » | test_validation_excel.py | ✅ |
| Rapport de composition (inscrits, présents, absents, admis, taux, 3 meilleurs, observations) | RAPPORT DE COMPOSITION | Rapports | rapport paramétré par n° de composition | test_validation_excel.py | ✅ |
| Rapport de rentrée (personnel + redoublants) | RAPPORT DE RENTREE | Rapports | rapport « Rapport de rentrée » | test_validation_excel.py | ✅ |
| Journal des absences élèves | ABSENCES ELEVES | Absences | Absences → Élèves | test_repositories.py | ✅ |
| Journal des absences personnel | ABSENCES PERSONNEL | Absences | Absences → Personnel | test_repositories.py | ✅ |
| Rapport mensuel (fréquentation, assiduité, évaluation du mois, 9 zones à rédiger) | RAPPORT MENSUEL | Rapports | rapport paramétré par mois + zones de texte | test_validation_excel.py | ✅ |
| Liste du personnel, récapitulatif, classes sans enseignant | PERSONNEL | Personnel | Personnel + rapport | test_validation_excel.py | ✅ |
| Indicateurs, tableau par classe, alertes, 2 graphiques | TABLEAU DE BORD | Tableau de bord | Tableau de bord | test_validation_excel.py | ✅ (alerte sur-âge corrigée, voir audit A1) |
| Notice d'utilisation | NOTICE | Documentation | Aide → Guide + `docs/GUIDE_UTILISATEUR.md` | — | 🟡 |
| Zones d'impression ajustées, A4, en-têtes répétés | `AjusterZonesImpression`… | Moteur de rapports | rendu PDF | test_reports.py | ✅ |
| Aperçu / impression de chaque état | `ApercuEtat`, `Imp*`, `Imprimer*` | Rapports | Aperçu + Imprimer | test_ui_smoke.py | 🟡 impression physique non testée (pas d'imprimante) |
| Export PDF d'un état / de tous les états / un PDF par classe | `Exporter*PDF` | Rapports | Export PDF, export par lot | test_reports.py | ✅ |
| Dossier de fin d'année (5 états) | `ImprimerDossierFinAnnee` | Rapports | lot « Dossier de fin d'année » | test_reports.py | ✅ |
| 6 classeurs « fichiers liés » à valeurs figées | `MettreAJourDossier`… | Import / Export | Export → Dossier de travail | test_import_export.py | ✅ |
| Afficher / masquer les feuilles calculées | `AfficherMasquerFeuillesCalculees` | — | sans objet (écrans dédiés) | — | — |
| Navigation / retour au tableau de bord | `RetourTableauDeBord`, liens ▸ | Interface | menu latéral + raccourcis Ctrl+1…9 | test_ui_smoke.py | ✅ |
| Contrôles (homonymes, sans classe, MGA manquantes, classes sans enseignant, extraits manquants) | TABLEAU DE BORD J12:J17 | Tableau de bord | panneau Alertes | test_validation_excel.py | ✅ |

## Fonctions ajoutées (absentes du classeur)

| Fonction | Module | Test |
|---|---|---|
| Plusieurs années scolaires, réinscription / passage en classe supérieure | Inscriptions | test_repositories.py |
| Comptes utilisateurs, rôles configurables, mots de passe hachés (PBKDF2-SHA256) | Sécurité | test_security.py |
| Journal des actions | Sécurité | test_security.py |
| Concepteur de modèles de rapports, versionnement, import/export de modèles | Paramètres → Modèles de rapports | test_reports.py, test_templates.py |
| Sauvegarde manuelle / automatique, restauration vérifiée | Sauvegarde | test_backup.py |
| Import du classeur source | Import / Export | test_import_export.py |
