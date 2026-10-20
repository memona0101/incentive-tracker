#!/bin/sh
# Encrypted backups of the Incentive Tracker database.
#   backup.sh       run forever: one backup every day at BACKUP_HOUR (local time, TZ)
#   backup.sh now   make one backup immediately (deploy/scripts/update.sh does this before updating)
# Each backup is a consistent SQLite snapshot (VACUUM INTO, safe while the app is running), checked,
# gzipped and encrypted with AES-256 using BACKUP_PASSPHRASE. Files: /backups/incentive_YYYY-MM-DD_HHMM.db.gz.enc
# Restore steps are in deploy/DEPLOY.md.
set -eu

DB="${DB_FILE:-/data/incentives.db}"
OUT=/backups
KEEP="${BACKUP_KEEP_DAYS:-30}"
HOUR="${BACKUP_HOUR:-3}"

backup_once() {
  if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
    echo "BACKUP_PASSPHRASE is not set in .env, so no backup was made." >&2
    return 1
  fi
  stamp=$(date +%Y-%m-%d_%H%M)
  tmp=$(mktemp -d)
  sqlite3 "$DB" "VACUUM INTO '$tmp/incentive.db'"
  if [ "$(sqlite3 "$tmp/incentive.db" 'PRAGMA integrity_check;')" != "ok" ]; then
    echo "Integrity check failed; backup not saved." >&2
    rm -rf "$tmp"
    return 1
  fi
  gzip -9 "$tmp/incentive.db"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
    -in "$tmp/incentive.db.gz" -out "$OUT/incentive_$stamp.db.gz.enc"
  rm -rf "$tmp"
  find "$OUT" -name 'incentive_*.db.gz.enc' -mtime +"$KEEP" -delete
  echo "Backup written: $OUT/incentive_$stamp.db.gz.enc"
}

if [ "${1:-}" = "now" ]; then
  backup_once
  exit $?
fi

echo "Backup service started: every day at $(printf '%02d' "$HOUR"):00 $(date +%Z), keeping $KEEP days."
while true; do
  now=$(date +%s)
  target=$(date -d "$(date +%Y-%m-%d) $(printf '%02d' "$HOUR"):00" +%s)
  [ "$target" -gt "$now" ] || target=$((target + 86400))
  sleep $((target - now))
  backup_once || echo "Backup failed at $(date)." >&2
  sleep 60
done
