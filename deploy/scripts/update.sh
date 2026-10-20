#!/usr/bin/env bash
# Update the Incentive Tracker on the office server:
#   cd /opt/incentive && bash deploy/scripts/update.sh
# Steps: backup now -> git pull --ff-only -> rebuild and restart -> remove old images.
# Avoid running it during busy office hours: the build shares the machine with WBT People.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "1/4  Backing up the database..."
if ! docker compose exec -T incentive-backup /usr/local/bin/backup.sh now; then
  echo "The backup failed, so the update was stopped. Nothing was changed." >&2
  exit 1
fi

echo "2/4  Getting the latest code..."
git pull --ff-only

echo "3/4  Rebuilding and restarting..."
docker compose up -d --build

echo "4/4  Removing old images..."
docker image prune -f

docker compose ps
echo "Done. Open https://incentive.wbtpk.com to check."
