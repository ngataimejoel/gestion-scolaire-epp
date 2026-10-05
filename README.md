# Gestion Scolaire EPP

Application Windows de gestion d'une école primaire (CP1 à CM2), inspirée de SmartIEPP.
Elle fonctionne **sans Internet** : toutes les données restent sur l'ordinateur de l'école.

## Fonctionnalités

- **Tableau de bord** : effectifs garçons / filles par classe, redoublants.
- **Élèves** : inscription, recherche, filtre par classe, import depuis Excel (.xls / .xlsx, par exemple les
  fichiers exportés de SmartIEPP avec les colonnes « Matricule », « Nom et prénoms », « Sexe », « Date de naissance »),
  export Excel et impression de la liste.
- **Classes** et **Personnel** (enseignants, directeur…).
- **Compositions** : saisie des notes par classe (barèmes par niveau), absents, total, moyenne sur 10,
  rang avec ex-aequo, appréciation, admis / non admis ; export Excel et impression.
- **Statistiques** : rapport par niveau (inscrits, présents, admis, taux de réussite par sexe) et meilleurs élèves
  par niveau (moyenne générale, français, mathématiques).
- **Paramètres** : informations de l'école (IEPP, DREN, année scolaire), matières et barèmes modifiables,
  moyenne d'admission, sauvegarde et restauration.

## Installer à l'école

1. Télécharger `Gestion-Scolaire-EPP-Setup-x.y.z.exe` :
   - dans l'onglet **Actions** du dépôt GitHub → dernière exécution « Installateur Windows » → **Artifacts** ;
   - ou dans **Releases** pour une version publiée (tag `v1.0.0`, etc.).
2. Double-cliquer sur le fichier. Si Windows affiche « Windows a protégé votre ordinateur », cliquer sur
   **Informations complémentaires** puis **Exécuter quand même** (l'installateur n'est pas signé).
3. Suivre l'assistant ; un raccourci « Gestion Scolaire EPP » est créé sur le bureau.

Configuration requise : Windows 10 ou 11, 64 bits.

### Données et sauvegardes

- La base de données est dans `%APPDATA%\gestion-scolaire-epp\ecole.db`.
- Une sauvegarde automatique est faite chaque jour à l'ouverture dans `%APPDATA%\gestion-scolaire-epp\sauvegardes`
  (les 15 dernières sont conservées).
- **Paramètres → Sauvegarder vers…** permet de copier la base sur une clé USB ; **Restaurer** la recharge.
- Désinstaller ou mettre à jour l'application **ne supprime pas** les données.

### Mettre à jour

Installer simplement la nouvelle version par-dessus l'ancienne : les données sont conservées.

## Développement

```bash
npm install
npm run app:dev     # interface Next.js + fenêtre Electron avec rechargement à chaud
npm test            # tests de la base de données
npm run lint
npm run dist:win    # construit l'installateur dans dist/ (sous Windows)
```

Architecture :

- `src/` : interface (Next.js en export statique, React, Tailwind).
- `electron/main.js` : fenêtre, protocole `app://` qui sert l'interface, sauvegardes.
- `electron/db.js` : base SQLite locale (module `node:sqlite` intégré à Electron, aucune dépendance native),
  calcul des moyennes, rangs et statistiques.
- `.github/workflows/windows.yml` : construit l'installateur NSIS sur un poste Windows de GitHub à chaque push ;
  un tag `v*` publie aussi une Release.
