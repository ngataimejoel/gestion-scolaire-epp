# Installation et mise en production

Ce guide couvre l'installation de GESTION SCOLAIRE EPP sur un serveur, son exploitation quotidienne
(tâches, sauvegardes, mises à jour) et la restauration. Une seule installation sert toutes les écoles ;
leurs données sont isolées par l'application.

## 1. Ce qu'il faut

| Élément | Recommandation |
|---|---|
| Serveur | Linux (Ubuntu 22.04 ou 24.04), 2 Go de mémoire au moins, 20 Go de disque |
| Node.js | version 22 (20 au minimum) |
| PostgreSQL | version 16, sur le même serveur ou en service géré |
| Nom de domaine | ex. `ecoles.example.ci`, avec certificat HTTPS (Let's Encrypt) |
| SMS | compte API Orange SMS Côte d'Ivoire (developer.orange.com) |
| Paiement | compte marchand CinetPay et/ou Wave Business |
| E-mail (facultatif) | compte Resend |

L'application peut aussi être déployée sur une plateforme d'hébergement Node.js (Render, Railway, Fly.io…)
avec une base PostgreSQL gérée : les étapes 3 à 6 restent les mêmes, les variables se saisissent dans
l'interface de la plateforme.

## 2. Base de données

```bash
sudo -u postgres psql -c "CREATE USER epp WITH PASSWORD 'mot-de-passe-solide';"
sudo -u postgres psql -c "CREATE DATABASE epp OWNER epp;"
```

`DATABASE_URL="postgresql://epp:mot-de-passe-solide@localhost:5432/epp"`

## 3. Variables d'environnement

Copier `.env.example` en `.env` (ou les saisir dans l'hébergeur). **Aucune de ces valeurs ne doit être
committée ni envoyée au navigateur** : le code ne lit les secrets que côté serveur.

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | oui | connexion PostgreSQL |
| `SESSION_SECRET` | oui | 32 caractères aléatoires au moins : `openssl rand -hex 32` |
| `APP_URL` | oui | adresse publique, ex. `https://ecoles.example.ci` (liens des SMS, retours de paiement) |
| `SMS_PROVIDER` | oui | `orange` en production (`simulation` n'envoie rien) |
| `ORANGE_SMS_CLIENT_ID`, `ORANGE_SMS_CLIENT_SECRET`, `ORANGE_SMS_EXPEDITEUR` | avec Orange | identifiants de l'application Orange et numéro expéditeur du contrat |
| `SMS_SENDER` | non | nom d'expéditeur affiché, s'il est validé par l'opérateur |
| `PAYMENT_PROVIDERS` | oui | ex. `cinetpay,wave` (la simulation est refusée en production) |
| `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY` | avec CinetPay | clés du tableau de bord CinetPay |
| `WAVE_API_KEY`, `WAVE_WEBHOOK_SECRET` | avec Wave | clé API et secret du webhook Wave Business |
| `CRON_SECRET` | oui | secret des tâches quotidiennes : `openssl rand -hex 32` |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `MAIL_FROM` | non | e-mails de notification (`resend`) |
| `ADMIN_TELEPHONE`, `ADMIN_MOT_DE_PASSE`, `ADMIN_NOM` | à la création de l'administrateur | puis à retirer du fichier |
| `AFFICHER_SMS_SIMULES`, `AUTORISER_PAIEMENT_SIMULE` | non | démonstration seulement : laisser vides en production |

## 4. Installation de l'application

```bash
git clone https://github.com/ngataimejoel/gestion-scolaire-epp.git
cd gestion-scolaire-epp
npm ci                      # installe et génère le client Prisma
npm run db:migrate          # crée ou met à jour les tables (prisma migrate deploy)
npm run build
npm run admin:creer         # compte administrateur de la plateforme + offres de départ
```

Lancement permanent (exemple avec systemd, fichier `/etc/systemd/system/epp.service`) :

```ini
[Unit]
Description=GESTION SCOLAIRE EPP
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/gestion-scolaire-epp
EnvironmentFile=/opt/gestion-scolaire-epp/.env
Environment=NODE_ENV=production PORT=3000
ExecStart=/usr/bin/npm start
Restart=always
User=epp

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now epp
```

Mettre un proxy HTTPS devant (nginx + certbot, ou Caddy). Exemple nginx :

```nginx
server {
  server_name ecoles.example.ci;
  client_max_body_size 10m;            # import du classeur (8 Mo au plus)
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

`sudo certbot --nginx -d ecoles.example.ci` ajoute le certificat.

## 5. Premiers réglages

1. Se connecter sur `/connexion` avec le compte administrateur (code SMS demandé), puis ouvrir `/admin`.
2. **Offres** : les prix de départ (Essai gratuit 30 jours, Standard 30 000 FCFA, Premium 60 000 FCFA) sont
   des valeurs provisoires à confirmer. Les modifier dans `/admin` : ils ne sont écrits nulle part ailleurs.
3. Déclarer les adresses de notification chez les fournisseurs de paiement :
   - CinetPay : l'URL est envoyée avec chaque paiement (`https://<domaine>/api/paiement/cinetpay`), rien à faire.
   - Wave : dans Wave Business, webhook `https://<domaine>/api/paiement/wave`, événements
     `checkout.session.completed` et `checkout.session.payment_failed`, et reporter le secret dans `WAVE_WEBHOOK_SECRET`.
4. Chaque directeur inscrit ensuite son école sur `/inscription` ; l'essai gratuit s'ouvre automatiquement.
   Pour reprendre ses données, il utilise **Import et sauvegarde → Importer le classeur**.

## 6. Tâches quotidiennes

Une fois par jour (rappels d'abonnement, évaluation dans 3 jours, notes à terminer), `crontab -e` :

```cron
# 6 h 00 heure d'Abidjan (UTC)
0 6 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://ecoles.example.ci/api/taches > /dev/null
```

(Remplacer `$CRON_SECRET` par la valeur, ou charger `.env` dans la ligne de cron.) Chaque message n'est envoyé qu'une fois.

## 7. Sauvegardes

Deux niveaux complémentaires :

- **Base complète (toutes les écoles)**, chaque nuit, avec rotation sur 30 jours :

  ```cron
  30 1 * * * cd /opt/gestion-scolaire-epp && set -a && . ./.env && DOSSIER=/var/sauvegardes/epp scripts/sauvegarde-base.sh >> /var/log/epp-sauvegarde.log 2>&1
  ```

  Le script écrit un fichier `pg_dump` au format personnalisé, vérifie qu'il est lisible, supprime les
  fichiers de plus de `GARDER_JOURS` jours. **Copier régulièrement ce dossier hors du serveur** (autre
  machine, stockage objet) : une sauvegarde sur le même disque ne protège pas d'une panne du serveur.

- **Par école**, à la demande du directeur : menu **Import et sauvegarde → Télécharger la sauvegarde**.
  Fichier Excel au format du classeur (paramètres, registre, personnel, notes, résultats, absences),
  disponible même si l'abonnement a expiré.

## 8. Restauration

**Toute la base** (après une panne, ou pour vérifier une sauvegarde sur une autre machine) :

```bash
sudo systemctl stop epp
sudo -u postgres psql -c "DROP DATABASE epp;" -c "CREATE DATABASE epp OWNER epp;"
pg_restore --no-owner --dbname="$DATABASE_URL" /var/sauvegardes/epp/epp-AAAA-MM-JJ-HHMM.dump
npm run db:migrate          # applique les migrations plus récentes que la sauvegarde, s'il y en a
sudo systemctl start epp
```

**Une seule école**, à partir de son fichier de sauvegarde Excel : le directeur l'importe dans
**Import et sauvegarde**. L'import n'écrase jamais les données présentes : dans une école vide, il recrée
tout (vérifié par les tests : l'export relu redonne exactement les mêmes données) ; dans une école qui a
déjà des données, il n'ajoute que ce qui manque. Pour revenir à un état antérieur d'une école qui a des
données erronées, restaurer la base complète sur un serveur de secours et exporter l'école depuis celui-ci.

Tester une restauration au moins une fois par trimestre.

## 9. Mise à jour de l'application

```bash
cd /opt/gestion-scolaire-epp
scripts/sauvegarde-base.sh   # (avec .env chargé) sauvegarde avant mise à jour
git pull
npm ci
npm run db:migrate
npm run build
sudo systemctl restart epp
```

## 10. Vérifications avant l'ouverture aux écoles

- [ ] `SESSION_SECRET` et `CRON_SECRET` générés aléatoirement, `.env` lisible seulement par l'utilisateur `epp` (`chmod 600 .env`).
- [ ] `SMS_PROVIDER=orange` : un SMS de test reçu (inscription d'une école de test).
- [ ] `AFFICHER_SMS_SIMULES` et `AUTORISER_PAIEMENT_SIMULE` vides.
- [ ] Un paiement réel de faible montant aller-retour avec chaque fournisseur, puis activation vérifiée dans `/abonnement`.
- [ ] Prix des offres confirmés dans `/admin`.
- [ ] Tâche quotidienne planifiée ; appel manuel réussi (réponse JSON).
- [ ] Sauvegarde nocturne planifiée, copie hors serveur, une restauration testée.
- [ ] HTTPS actif ; accès PostgreSQL fermé depuis l'extérieur.
- [ ] `npm test` vert sur une base de test (`TEST_DATABASE_URL`, jamais la base de production : elle est vidée).

## 11. Tests et intégration continue

```bash
npm test          # 200+ tests : moteur de calcul identique au classeur, comptes, isolation, paiement, import…
npm run typecheck
npm run lint
```

GitHub Actions (`.github/workflows/ci.yml`) lance lint, types, tests (PostgreSQL 16) et build à chaque pull request.
