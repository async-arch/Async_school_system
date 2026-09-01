# Shared staging environment

One shared Odoo instance the whole team tests against, so nobody has to reason
about whose local database is in what state.

```
GitHub main ──► Render (Docker, free) ──► Odoo 19 ──► Neon PostgreSQL (free)
```

**Staging is not production.** It holds synthetic data only, it is allowed to
sleep, and it can be rebuilt from scratch at any time.

---

## What you need before you start

| Thing | Where | Notes |
|---|---|---|
| Neon account | neon.tech | Free plan |
| Render account | render.com | Free plan, connected to the GitHub repo |
| A Docker install | your machine | Only for the one-off initialization |

---

## 1. Create the Neon database

1. Create a Neon project. Pick **PostgreSQL 16** and a region close to the team.
2. Create a database named **`school`**.
3. Open **Connection Details** and copy the **direct** connection string —
   the host **without** `-pooler` in it.

> **Use the direct/unpooled host.** Odoo keeps session-level state and the demo
> seeder takes a `pg_advisory_xact_lock`; a transaction pooler breaks both. The
> pooled endpoint will appear to work and then fail in confusing ways.

You need four values from that string:

```
DB_HOST      ep-xxxx-xxxx.eu-central-1.aws.neon.tech     (no -pooler)
DB_PORT      5432
DB_USER      neondb_owner
DB_PASSWORD  ...
```

## 2. Initialize the database (one-off, from your machine)

Render's free plan gives no shell, so the first-time setup runs locally against
Neon — Neon is reachable from anywhere.

```bash
export NEON_HOST=...        # direct host, no -pooler
export NEON_USER=...
export NEON_PASSWORD=...

# Install the module with demo data. Demo records are fictional, which is
# exactly what staging should contain.
docker compose run --rm --no-deps \
  odoo odoo -d school -i school_management \
  --db_host="$NEON_HOST" --db_port=5432 \
  --db_user="$NEON_USER" --db_password="$NEON_PASSWORD" \
  --db_sslmode=require --no-http --stop-after-init
```

Expect `Modules loaded.` and exit code 0. This takes a few minutes.

> **Pass the database on the command line, not as `HOST`/`USER`/`PASSWORD`
> environment variables.** `docker compose run` mounts `./config`, and the image
> entrypoint only fills in parameters that are *absent* from the config file.
> `config/odoo.conf` already sets `db_host = db`, so those environment variables
> are ignored and the command quietly initializes your **local** database
> instead of Neon. Command-line flags override the config file, so they win.
> Confirm the log line `odoo: database: <user>@<host>:5432` names the Neon host
> before walking away.

## 3. Switch staging to database-backed attachments

**Do this immediately after step 2, before anyone uploads anything.**

Render's filesystem is ephemeral: it is wiped on every redeploy, restart and
wake-from-sleep. Odoo stores attachment payloads on disk by default
(`ir_attachment.location = file`), so on Render every uploaded document, photo
and birth certificate would be destroyed on the next deploy — the database
would keep the record and lose the bytes.

Two statements, both in the Neon console → **SQL Editor**, with the database
dropdown set to **`school`** (not `neondb`):

```sql
-- 1. Store new attachment payloads in PostgreSQL instead of on disk.
INSERT INTO ir_config_parameter (key, value, create_uid, write_uid, create_date, write_date)
VALUES ('ir_attachment.location', 'db', 1, 1, now(), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, write_date = now();

-- 2. Drop the compiled asset bundles so Odoo rebuilds them into the database.
DELETE FROM ir_attachment WHERE url LIKE '/web/assets/%';
```

Then load the site once. The first request is slow while Odoo regenerates the
bundles; after that everything is served from PostgreSQL.

Confirm it worked:

```sql
SELECT
  count(*) FILTER (WHERE store_fname IS NOT NULL)                       AS on_disk_bad,
  count(*) FILTER (WHERE db_datas IS NOT NULL AND length(db_datas) > 0) AS in_db_good
FROM ir_attachment WHERE url LIKE '/web/assets/%';
```

`on_disk_bad` must be **0**.

> **Why the second statement matters.** The container that ran the install wrote
> its asset bundles to that container's disk. The moment Render replaces the
> container — a redeploy, a restart, or waking from sleep — those files are gone
> while the database rows still point at them. An attachment row with no file,
> no database content and a `url` is answered by Odoo with a redirect *to that
> same url*, so the browser loops and the site fails to load with
> `ERR_TOO_MANY_REDIRECTS`. Deleting the bundles makes Odoo rebuild them, this
> time into the database. Asset bundles are derived data — deleting them is
> always safe.
>
> For the same reason, do **not** run `ir.attachment.force_storage()` in a
> container that was started after the install. It reads the missing files as
> empty and clears their pointers, which is what produces the broken rows above.

> This is a **staging-only** setting. It lives in the staging database, not in
> the repository, so local development and any future production deployment are
> untouched and keep using the filestore.

## 4. Create the Render service

1. **New → Blueprint**, point it at this repository. Render reads `render.yaml`.
2. Set the four secret environment variables in the dashboard:
   `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `ODOO_ADMIN_PASSWD`.
   (`DB_PORT=5432` and `DB_NAME=school` are already in the blueprint.)
   `ODOO_ADMIN_PASSWD` is Odoo's **master password**, which guards database
   create/drop/duplicate — not the login password. Make it a long random string.
3. **For the very first deploy only**, also set `ODOO_INIT` = `school_management`.
   Render's free plan has no shell, and initializing across the internet from a
   laptop is impractically slow — an Odoo install issues tens of thousands of
   small queries and each pays the round trip. The container sits in the same
   region as the database and does the same work in minutes.

   > Measured from a developer laptop to a Neon project in `us-east-2`: **181 ms
   > per statement**. At tens of thousands of statements that is hours, which is
   > why this is the supported path and section 2 is the fallback.

   Forgetting this step is the failure it exists to prevent, so the startup
   script now checks for it: if the database has no `ir_module_module` table and
   `ODOO_INIT` is unset, the deploy fails immediately naming the remedy, instead
   of booting an Odoo that answers every request with `KeyError: 'ir.http'`.
4. Deploy. The first build takes several minutes. Watch the log for
   `Modules loaded.`, then the health check turns green.
5. **Remove `ODOO_INIT` and deploy again.** Left set, it reinstalls on every boot.

Render's health check hits `/web/health`, which returns `200 {"status":"pass"}`.

## 5. Secure the instance

Immediately after the first successful deploy:

1. Log in as `admin` / `admin`.
2. **Change the admin password.** The instance is on a public URL.
3. Create a user per teammate with a real role (Registrar, Teacher, HR) rather
   than everyone sharing `admin` — role-scoped bugs only appear when people use
   role-scoped accounts.

## 6. Verify

| Check | Expected |
|---|---|
| `curl https://<service>.onrender.com/web/health` | `200 {"status": "pass"}` |
| Log in | Odoo loads |
| Register a staff member with a 16-digit Fayda ID | Saves |
| Enter a 15-digit Fayda ID | Rejected with a clear message |
| Register a teacher on that staff record | Teacher form shows the same Fayda ID, read-only |
| Upload a document | Saves |
| Redeploy, then reopen the document | **Still there** — this is what step 3 buys |
| Run the synthetic staff import (below) | 20 draft staff created |

Optional synthetic dataset (20 fictional staff, no Fayda IDs):

```bash
docker compose run --rm --no-deps -T \
  odoo odoo shell -d school --db_host="$NEON_HOST" --db_port=5432 \
  --db_user="$NEON_USER" --db_password="$NEON_PASSWORD" \
  --db_sslmode=require --no-http <<'EOF'
print(env['school.staff.import'].dry_run())
print(env['school.staff.import'].run_import())
env.cr.commit()
EOF
```

These 20 land in **Draft** and stay there: the dataset carries no birth date,
phone, job title or responsibility, and the import does not invent them.

## 7. Day-to-day deployments

```
feature branch → local tests → PR → CI → merge to main → Render deploys → team tests
```

Render redeploys automatically on every push to `main`. Only `main` deploys;
feature branches never do.

**A deploy updates the module. It never rebuilds the database.** If a merged
change needs a module upgrade (new field, new migration), run it once against
Neon from your machine:

```bash
docker compose run --rm --no-deps \
  odoo odoo -d school -u school_management \
  --db_host="$NEON_HOST" --db_port=5432 \
  --db_user="$NEON_USER" --db_password="$NEON_PASSWORD" \
  --db_sslmode=require --no-http --stop-after-init
```

**Rollback:** in Render, open the service → **Deploys** → pick the previous
successful deploy → **Redeploy**. That rolls back the code. It does not roll
back the database, so a deploy that ran a migration needs a database restore
(Neon → **Restore** → point-in-time) as well.

## ⚠️ Never run `scripts/reset-db.sh` against staging

`reset-db.sh` **drops and recreates the database**. It is for local development
only, and it is hard-wired to the local `db` container, so it cannot reach Neon
by accident — but do not adapt it to. Destroying the shared database throws away
everyone's test data with no warning.

To deliberately rebuild staging: drop the database in the Neon console, create
it again, and repeat steps 2 and 3.

## Known limitations — all deliberate

**The service sleeps.** Render's free plan spins a service down after ~15
minutes without traffic. The first request afterwards takes roughly a minute
while the container starts and Odoo loads its registry. Waking it up is just
opening the URL and waiting.

**Scheduled jobs only run while the service is awake.** The module has four:
three daily, and one every five minutes (announcement visibility). While the
service sleeps, none of them run; they resume on wake. For testing this is
fine, and we are deliberately **not** working around it — no ping loops, no
keep-alive cron, no fake traffic.

**The filesystem is ephemeral.** Handled by step 3. If someone ever resets
`ir_attachment.location` back to `file`, uploads start disappearing on redeploy.

**The database is shared.** Anyone can change anyone's test data. Treat staging
as disposable and do not use it to store anything you would be sad to lose.

**Free-tier storage.** Neon's free plan gives 0.5 GB per project. The database
is roughly 47 MB, plus attachments now living inside it. There is plenty of
room, but a bulk upload of large documents would eat it.

**Email is not configured.** Creating a teacher *without* typing a password
calls `user.action_reset_password()`, which sends mail — that will fail until
SMTP is set. To test that path, add outgoing mail server settings in Odoo
(Settings → Technical → Outgoing Mail Servers) using a free relay. Everything
else, including creating a teacher *with* a password, works without SMTP.

## Data policy

Staging is public and shared. **Synthetic data only.**

Never enter a real Fayda ID, a real staff or student record, a real birth
certificate, or any real personal document. The demo data and the 20-row
dataset are both fictional, which is why they are the ones used here.
