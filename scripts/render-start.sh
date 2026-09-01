#!/usr/bin/env bash
# Start Odoo on Render.
#
# This exists to solve two problems that only appear on Render.
#
# 1. PORT means two different things.
#    Render injects PORT as the HTTP port. The official Odoo image's entrypoint
#    reads PORT as the *PostgreSQL* port:
#
#        : ${PORT:=${DB_PORT_5432_TCP_PORT:=5432}}
#        check_config "db_port" "$PORT" "PGPORT"
#
#    and appends its own --db_port last, where it beats anything passed before
#    it. Left alone, Odoo would try to reach Neon on Render's HTTP port. This
#    script is invoked as the container command, so the entrypoint takes its
#    `*) exec "$@"` branch and injects nothing at all. PostgreSQL is configured
#    from DB_PORT here, and PORT is used only for HTTP.
#
# 2. There is no config file on Render.
#    /etc/odoo/odoo.conf is a bind mount in local development, and it cannot be
#    committed because it holds credentials. It is written here from the
#    environment instead, and never leaves the container.
set -euo pipefail

fail() {
    echo "render-start: $*" >&2
    exit 1
}

for var in DB_HOST DB_NAME DB_USER DB_PASSWORD ODOO_ADMIN_PASSWD; do
    if [ -z "${!var:-}" ]; then
        fail "$var is not set. Add it to the Render service's environment."
    fi
done

# Neon's PostgreSQL port. Deliberately not $PORT — see the note above.
DB_PORT="${DB_PORT:-5432}"
# Render's HTTP port. 8069 keeps the script usable outside Render.
HTTP_PORT="${PORT:-8069}"

CONF="${ODOO_RC:-/etc/odoo/odoo.conf}"
umask 077
cat > "$CONF" <<CONF_EOF
[options]
addons_path = /mnt/extra-addons,/usr/lib/python3/dist-packages/odoo/addons
data_dir = /var/lib/odoo

; Guards database create/drop/duplicate. Not the login password.
admin_passwd = ${ODOO_ADMIN_PASSWD}
; No database manager on a shared, internet-facing instance.
list_db = False

db_host = ${DB_HOST}
db_port = ${DB_PORT}
db_user = ${DB_USER}
db_password = ${DB_PASSWORD}
db_name = ${DB_NAME}
dbfilter = ^${DB_NAME}\$
; Neon terminates TLS and refuses plaintext.
db_sslmode = require

; Behind Render's proxy, so trust its forwarding headers.
proxy_mode = True
; One process: websockets stay in-thread and there is a single HTTP port to
; publish. A nine-person staging environment does not need a worker pool.
workers = 0
; Without this the module's four scheduled actions never run.
max_cron_threads = 1
CONF_EOF

# Neon's pooled endpoint breaks Odoo: it keeps session-level state and the demo
# seeder takes a pg_advisory_xact_lock, neither of which survives transaction
# pooling. The failure comes later and looks like something else, so name it now.
case "$DB_HOST" in
    *-pooler.*)
        echo "render-start: WARNING $DB_HOST is Neon's POOLED endpoint." >&2
        echo "render-start: WARNING Use the direct host — the same name without '-pooler'." >&2
        echo "render-start: WARNING Odoo holds session state and the seeder takes a" >&2
        echo "render-start: WARNING pg_advisory_xact_lock; transaction pooling breaks both." >&2
        ;;
esac

# An empty database is the one failure this script can report better than Odoo
# can. Odoo starts anyway and answers every request with HTTP 500 and
# KeyError: 'ir.http', which says nothing about the cause; the one line that
# does is buried in the boot log.
schema_state=$(
    python3 - <<'PY' || echo unknown
import os, sys
try:
    import psycopg2
    connection = psycopg2.connect(
        host=os.environ['DB_HOST'], port=os.environ['DB_PORT'],
        dbname=os.environ['DB_NAME'], user=os.environ['DB_USER'],
        password=os.environ['DB_PASSWORD'], sslmode='require',
        connect_timeout=15,
    )
    with connection, connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.ir_module_module') IS NOT NULL")
        print('initialized' if cursor.fetchone()[0] else 'empty')
    connection.close()
except Exception as exc:
    # Never echo the exception itself: a connection error can carry the DSN.
    print('unknown')
    print('render-start: preflight query failed (%s); leaving the decision to '
          'Odoo.' % type(exc).__name__, file=sys.stderr)
PY
)

if [ "$schema_state" = "empty" ] && [ -z "${ODOO_INIT:-}" ]; then
    fail "database '$DB_NAME' on $DB_HOST has no Odoo schema.

  Set ODOO_INIT=school_management in the Render dashboard, deploy once, then
  REMOVE the variable and deploy again.

  Starting without it leaves every request returning HTTP 500 with
  KeyError: 'ir.http', because there is no ir_module_module table to load."
fi

# One-off database initialization.
#
# Render's free plan gives no shell, and initializing over the internet from a
# developer laptop is impractically slow: an Odoo install issues tens of
# thousands of small queries and each one pays the round trip, so a
# cross-continent install takes hours. This container runs in the same region
# as the database, where the same work takes minutes.
#
# Set ODOO_INIT=school_management in the Render dashboard, deploy once, then
# REMOVE the variable and deploy again. Left set, it re-runs the install on
# every boot.
INIT_ARGS=()
if [ -n "${ODOO_INIT:-}" ]; then
    echo "render-start: ODOO_INIT=${ODOO_INIT} — installing on this boot. Remove the variable once it succeeds."
    INIT_ARGS+=(-i "${ODOO_INIT}")
fi

echo "render-start: HTTP on 0.0.0.0:${HTTP_PORT}; PostgreSQL ${DB_HOST}:${DB_PORT}/${DB_NAME} (sslmode=require)"

exec odoo \
    --config="${CONF}" \
    --http-interface=0.0.0.0 \
    --http-port="${HTTP_PORT}" \
    "${INIT_ARGS[@]}"
