# GESTION SCOLAIRE EPP EXPERT (Python / PySide6)

Application Windows hors ligne qui reprend le classeur « GESTION_SCOLAIRE_EPP_MODELE_EXPERT » :
registre, notes, résultats (MGA, rangs, décisions), effectifs, absences, personnel et tous les états
imprimables, avec un moteur de rapports configurable sans programmation.

Cette version vit dans le dossier `epp-expert/` ; l'application Electron à la racine du dépôt n'est pas modifiée.

## Développement

```powershell
cd epp-expert
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest -q          # tests
.venv\Scripts\python -m epp                # lancer l'application
.venv\Scripts\python -m epp --selftest     # auto-test sans interface
```

## Installateur Windows

- Automatique : workflow GitHub Actions « EPP EXPERT (Python) - Windows » ; l'installateur
  `GestionScolaireEPP-Setup-x.y.z.exe` est dans les **Artifacts** de l'exécution. Le workflow teste aussi
  l'exécutable sans Python, l'installation silencieuse, la mise à jour et la désinstallation.
- Manuel, sous Windows : `powershell -ExecutionPolicy Bypass -File packaging\build_windows.ps1`
  (Python 3.13 64 bits et Inno Setup 6 requis).

## Application Android

`android/` : application AKWA SCHOOL pour téléphone, utilisable seule (sans ordinateur) ou synchronisée à la
demande avec l'ordinateur de l'école par le Wi-Fi (sans Internet). L'APK est construit par la même CI et joint aux versions publiées. Détails : `docs/ANDROID.md`.

## Données

La base est dans `%LOCALAPPDATA%\GestionScolaireEPP` (jamais dans le dossier d'installation) ; elle est
conservée lors d'une mise à jour ou d'une désinstallation, sauf si vous demandez sa suppression.

## Tests et données personnelles

Le classeur réel (noms, téléphones des élèves) n'est **pas** dans ce dépôt public. Les tests qui comparent
l'application aux valeurs calculées par Excel s'exécutent quand le classeur est présent dans
`tests/data/classeur_source.xlsm` (ou via la variable `EPP_SOURCE_XLSM`) ; sinon ils sont ignorés et
les tests s'appuient sur une école de démonstration fictive (`epp/demo.py`).
