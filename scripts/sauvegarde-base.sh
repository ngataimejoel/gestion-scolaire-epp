#!/usr/bin/env bash
# Sauvegarde complète de la base PostgreSQL (toutes les écoles), à lancer chaque nuit par cron.
# Usage : DATABASE_URL=... DOSSIER=/var/sauvegardes/epp GARDER_JOURS=30 scripts/sauvegarde-base.sh
# Restauration : voir docs/DEPLOIEMENT.md (pg_restore).
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL non défini}"
DOSSIER="${DOSSIER:-/var/sauvegardes/epp}"
GARDER_JOURS="${GARDER_JOURS:-30}"
mkdir -p "$DOSSIER"
chmod 700 "$DOSSIER"
# pg_dump ne comprend pas le paramètre « schema » ajouté par Prisma à l'URL
URL="$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"
FICHIER="$DOSSIER/epp-$(date +%Y-%m-%d-%H%M).dump"
pg_dump --format=custom --no-owner --no-privileges --dbname="$URL" --file="$FICHIER.tmp"
mv "$FICHIER.tmp" "$FICHIER"
chmod 600 "$FICHIER"
# Contrôle : le fichier doit être lisible par pg_restore
pg_restore --list "$FICHIER" > /dev/null
find "$DOSSIER" -name 'epp-*.dump' -mtime +"$GARDER_JOURS" -delete
echo "Sauvegarde écrite : $FICHIER ($(du -h "$FICHIER" | cut -f1))"
