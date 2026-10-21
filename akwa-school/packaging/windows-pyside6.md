# Variante : application Windows PySide6 existante (`epp-expert`, interface v8)

L’application de bureau `epp-expert` affiche une page HTML avec un pont `QWebChannel` nommé
`pont` (`epp/v8/fenetre.py`). AKWA SCHOOL 2 sait l’utiliser (hôte « bureau » : enregistrement par
`pont.enregistrer`, mots de passe et comptes gérés par l’application Windows, fichiers par
`pont.telecharger`, impression par `pont.imprimer`) — testé avec un pont simulé.

Pour l’adopter, `epp/v8/page.py` doit charger `AKWA_SCHOOL.html` (copié dans `resources/web/`)
**sans** injecter `pont_v8.js` (adaptateur propre à l’ancienne interface) :

```python
html = (web / "AKWA_SCHOOL.html").read_text(encoding="utf-8")
tete = ('<script src="qrc:///qtwebchannel/qwebchannel.js"></script>'
        f"<script>window.APP_DATA={donnees};</script>")
return html.replace("<head>", "<head>" + tete, 1)
```

> Non appliqué ni testé ici (PySide6 indisponible dans l’environnement de développement).
> L’emballage Electron (`windows-electron/`) est la voie recommandée pour le .exe d’AKWA SCHOOL 2 :
> il fournit en plus un vrai export PDF.
