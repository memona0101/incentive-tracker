# Deploying the Incentive Tracker on the office server

The app runs on the same server as **WBT People** (`s-wbt-hrm`, `192.168.50.150`) at
**https://incentive.wbtpk.com**, reachable only from the office network and Tailscale.

```
Browser ── https://incentive.wbtpk.com ──┐
Browser ── https://hrm.wbtpk.com ────────┤
                                         ▼
                     caddy (wbt-people)  :80/:443
                      │                        │
            web / api (HRM)            incentive-web   ◄── /opt/incentive, compose project "incentive"
                      │                        │
                  db (HRM)          incentive-data volume (SQLite) ──► incentive-backup ──► /srv/incentive-backups
```

- One container, `incentive-web`, runs the whole app (pages + `/api`). It publishes **no ports**; the HRM's
  Caddy reaches it over the shared `wbt-people_default` network.
- The database is a single SQLite file in the Docker volume `incentive-data`. It is separate from the HRM's database.
- `incentive-backup` makes an encrypted copy every night at 3 AM into `/srv/incentive-backups`.

> **Safety rules:** never screenshot or paste the `.env` file or the backup passphrase. Never run
> `docker compose down` inside `/opt/wbt-people`. Never edit files inside `/opt/wbt-people` by hand.

---

## Before you start (one time)

These need other people, so ask early.

1. **Andrew: the one-time HRM change** (section 5 of the server handoff). The HRM repo adds
   `import /etc/caddy/sites/*.caddy` to its Caddyfile and mounts `/opt/caddy-sites` into the HRM's Caddy.
   On the server, Andrew creates the folder **before** updating the HRM (otherwise Docker creates it owned by root):
   `sudo mkdir -p /opt/caddy-sites && sudo chown aharris:aharris /opt/caddy-sites`, then
   `cd /opt/wbt-people && bash deploy/scripts/update.sh`. After that, new sites are just a file in `/opt/caddy-sites`.
2. **IT: the DNS name.** Ask IT to add `incentive.wbtpk.com → 192.168.50.150` to the office DNS
   (`192.168.50.50`), the same way as `hrm.wbtpk.com`.
3. **Your server account.** The handoff was written for `aharris`; you sign in as `abennett`. Steps 2
   and 3 below check that your account can use Docker and write to the Caddy sites folder.

---

## First deployment

Run these one at a time. Each block is one command.

### 1. Connect to the server
From PowerShell on your PC (or Terminal on the Mac):
```bash
ssh abennett@192.168.50.150
```
You should see a prompt like `abennett@s-wbt-hrm:~$`.

### 2. Check your account can use Docker
```bash
groups
```
The list must include `docker`. If it doesn't, ask Andrew to run `sudo usermod -aG docker abennett`,
then sign out and back in.

### 3. Check there's room on the server
```bash
free -h && df -h / /srv && docker stats --no-stream
```
You want a few GB of free memory and disk. The app itself uses very little (well under 200 MB of RAM).

### 4. Download the app
```bash
sudo mkdir -p /opt/incentive && sudo chown abennett:abennett /opt/incentive
```
```bash
git clone https://github.com/memona0101/incentive-tracker.git /opt/incentive
```
If the GitHub repo is private, git asks for a username and password: use your GitHub username and a
**personal access token** (GitHub → Settings → Developer settings → Fine-grained tokens, read-only access
to this one repo) as the password.

### 5. Create the settings file
```bash
cd /opt/incentive && cp deploy/.env.example .env && chmod 600 .env
```
Make a backup passphrase (copy it into the company password manager straight away; **don't screenshot it**):
```bash
openssl rand -hex 32
```
Open the settings file and fill in `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` (10+ characters) and
`BACKUP_PASSPHRASE` (the value you just made). Save with **Ctrl+O, Enter**, exit with **Ctrl+X**.
```bash
nano .env
```

### 6. Create the backup folder
```bash
sudo mkdir -p /srv/incentive-backups && sudo chown 1000:1000 /srv/incentive-backups
```
(`1000` is the user the app's containers run as, so they can write backups there.)

### 7. Start the app
This builds the containers. It takes a minute or two and uses some CPU, so avoid busy office hours.
```bash
cd /opt/incentive && docker compose up -d --build
```
```bash
docker compose ps
```
Expected: `incentive-web` shows `Up … (healthy)` and `incentive-backup` shows `Up`. If `incentive-web` keeps
restarting, check its log:
```bash
docker compose logs --tail=30 incentive-web
```
You should see `Created the first administrator: <your email>`. If it says the database is empty and demo
mode is off, an `ADMIN_*` value in `.env` is missing or the password is shorter than 10 characters: fix it
with `nano .env`, then run `docker compose up -d` again.

### 8. Add the site to Caddy
Check you can write to the Caddy sites folder (made by Andrew's one-time change):
```bash
cp /opt/incentive/deploy/caddy/incentive.caddy /opt/caddy-sites/incentive.caddy
```
If that says *Permission denied*, ask Andrew to run `sudo chown aharris:docker /opt/caddy-sites && sudo chmod 775 /opt/caddy-sites`, then try again.

Restart Caddy (both sites are down for 2–5 seconds). Use plain `docker` here, not `docker compose` inside
`/opt/wbt-people`: that needs to read the HRM's private `.env`, which only `aharris` can open.
```bash
docker restart wbt-people-caddy-1
```
```bash
docker logs --tail=30 wbt-people-caddy-1
```
There should be no `error` lines about `incentive.caddy`. **If Caddy won't start, the HRM is down too.**
Move the file aside and restart Caddy, then send a screenshot of the error:
```bash
mv /opt/caddy-sites/incentive.caddy /tmp/ && docker restart wbt-people-caddy-1
```

### 9. Test
From an office PC (after IT has added the DNS name):
1. Open **https://incentive.wbtpk.com**. You should see a padlock and no warning.
2. Sign in with the admin email and password from `.env`.
3. Open **https://hrm.wbtpk.com** and check the HRM still works.

Then, as the admin in the app:
- **Files** page: add the real files employees will log against.
- **Team** page: add each employee with a temporary password (they can be given a new one any time with the key icon).
- Remove the `ADMIN_PASSWORD=` line from `.env` (`nano .env`); it's only used on the very first start.

### 10. Remote (Tailscale) users
Laptops working from home need one more hosts-file line (same IP as the HRM, no Tailscale change needed):
```
192.168.50.150  incentive.wbtpk.com
```
- Windows: open Notepad **as administrator**, open `C:\Windows\System32\drivers\etc\hosts`, add the line, save.
- Mac:
  ```bash
  echo "192.168.50.150  incentive.wbtpk.com" | sudo tee -a /etc/hosts
  ```

---

## Everyday tasks

### Update to the latest version
After new code is pushed to GitHub:
```bash
cd /opt/incentive && bash deploy/scripts/update.sh
```
It backs up first, then pulls, rebuilds and restarts. If the backup fails, it stops without changing anything.

### Make a backup now
```bash
cd /opt/incentive && docker compose exec incentive-backup /usr/local/bin/backup.sh now
```
```bash
ls -lh /srv/incentive-backups
```

### See the app's log
```bash
cd /opt/incentive && docker compose logs --tail=50 incentive-web
```

### Restore a backup
Only if something went wrong. This replaces the current database with the backup.
1. Stop the app (the HRM is not affected):
   ```bash
   cd /opt/incentive && docker compose stop incentive-web incentive-backup
   ```
2. Decrypt the backup you want into `/tmp` (replace the file name; it asks for the backup passphrase):
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in /srv/incentive-backups/incentive_2026-10-20_0300.db.gz.enc | gunzip > /tmp/incentives.db
   ```
3. Copy it into the app's volume:
   ```bash
   docker run --rm -v incentive_incentive-data:/data -v /tmp:/restore alpine sh -c "rm -f /data/incentives.db-wal /data/incentives.db-shm && cp /restore/incentives.db /data/incentives.db && chown 1000:1000 /data/incentives.db"
   ```
4. Start the app again and delete the decrypted copy:
   ```bash
   docker compose start incentive-web incentive-backup
   ```
   ```bash
   rm /tmp/incentives.db
   ```

---

## Settings reference (`/opt/incentive/.env`)

| Setting | What it does |
|---|---|
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Create the first administrator. Used only when the database is empty. |
| `BACKUP_PASSPHRASE` | Encrypts backups. Keep a copy in the password manager. |
| `BACKUP_HOUR` | Hour of the nightly backup (default `3`, after the HRM's 2 AM backup). |
| `BACKUP_KEEP_DAYS` | Older backups are deleted (default `30`). |
| `COOKIE_SECURE` | `1` marks the sign-in cookie HTTPS-only. Leave it on. |

Set by `docker-compose.yml` (no need to change): `NODE_ENV=production` (no demo data, no demo sign-in
buttons), `TZ=Asia/Karachi`, `HOST=0.0.0.0`, `PORT=3000`, `DB_FILE=/data/incentives.db`, `TRUST_PROXY=1`
(sign-in lockouts use the real PC's address that Caddy passes on, not Caddy's own).
