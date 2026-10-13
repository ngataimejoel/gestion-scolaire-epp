# Résultats des tests

Exécution du 13/10/2026 sous Linux (Python 3.13, PySide6 6.12, interface en mode `offscreen`), avec le
classeur réel copié dans `tests/data/` (non publié) :

```
python -m pytest -q          →  181 passed
python -m epp --selftest     →  auto-test réussi (7 étapes)
```

Sans le classeur réel (cas du dépôt public et de l'intégration continue) : 147 passed, 34 skipped ; les
comparaisons avec le classeur sont ignorées et le reste s'exécute sur l'école de démonstration fictive. L'intégration continue Windows
construit en plus l'exécutable PyInstaller et l'installateur Inno Setup, puis lance `--selftest` sur
l'exécutable et sur l'application installée.

| Fichier | Tests | Ce qui est vérifié |
|---|---:|---|
| test_reports.py | 20 | moteur de rapports : chaque modèle en PDF et Excel, mise en page, filtres, regroupements, totaux, lots |
| test_modeles_excel.py | 20 | modèles Excel vierges, export puis réimport, import des élèves, notes, absences, personnel avec rapport d'erreurs, import annulé en cas d'échec |
| test_validation_excel.py | 13 | résultats, effectifs et rapports comparés aux valeurs calculées par Excel dans le classeur |
| test_export_word.py | 48 | export Word des rapports, bulletins et listes ; listes en Excel, PDF et Word ; droits |
| test_templates.py | 10 | gestion des modèles : versions, duplication, renommage, import / export, droits |
| test_licence.py | 10 | essai de 7 jours, codes à vie et d'un an, licence falsifiée refusée, données inaccessibles mais conservées après l'essai |
| test_bulletins_photos.py | 8 | bulletins cohérents avec les notes et avec Excel, photos des élèves et du personnel |
| test_bulletin_colore.py | 5 | bulletin couleur, palette douce lisible en noir et blanc |
| test_entete_logos.py | 6 | en-têtes et logos modifiables |
| test_autorisations.py | 7 | demandes d'autorisation d'absence et absences créées automatiquement |
| test_calendrier.py | 5 | jours fériés, congés, jours de classe exclus des autorisations, migration |
| test_fin_annee.py | 7 | décisions de fin d'année (admis, redoublants, abandons…), validation par classe, droits |
| test_passage_annee.py | 5 | passage à l'année suivante, année clôturée en lecture seule, sauvegarde endommagée détectée |
| test_demo.py | 2 | école de démonstration fictive : tous les modèles sans le classeur réel |
| test_interface.py | 15 | interface : premier lancement, connexion, mot de passe provisoire, écran d'activation seul quand la licence a expiré, ouverture de tous les écrans, menus selon le rôle, saisie élève et notes, autorisation avec jours fériés, aperçu de rapport, éditeur de modèles, sauvegarde et restauration, calendrier, passage d'année |

## Non couvert automatiquement

- L'impression réelle sur une imprimante (l'aperçu et le PDF sont testés).
- Les vidéos de démonstration : aucune vidéo n'est fournie ; l'application affiche alors une animation.
- Le service d'activation en ligne : pas encore déployé ; les tests l'imitent par un serveur local, et la licence
  reçue est vérifiée par signature, sans Internet, à chaque ouverture.
