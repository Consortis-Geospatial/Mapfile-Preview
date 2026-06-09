#!/bin/sh
set -e

WS="${WORKSPACE_DIR:-/data/maps}"
UI="${UI_DIST:-/app/ui}"

# 1) Make sure the workspace exists and seed a valid example mapfile on first run.
mkdir -p "$WS"
if [ -z "$(ls -A "$WS" 2>/dev/null)" ]; then
  echo "[entrypoint] Empty workspace -> seeding example.map into $WS"
  cp /opt/seed/example.map "$WS/example.map" || true
fi

# 2) Optional: point the UI to a custom public origin.
#    Only needed if you change the published port (see docker-compose.yml).
if [ -n "$APP_ORIGIN" ] && [ -f "$UI/assets/config/config.json" ]; then
  echo "[entrypoint] Setting UI apiURL -> $APP_ORIGIN"
  sed -i "s#\"apiURL\"[[:space:]]*:[[:space:]]*\"[^\"]*\"#\"apiURL\": \"$APP_ORIGIN\"#" \
    "$UI/assets/config/config.json"
fi

# 3) Start Apache (internal MapServer CGI endpoint used for WMS/WFS previews).
echo "[entrypoint] Starting Apache (MapServer CGI) ..."
. /etc/apache2/envvars 2>/dev/null || true
apache2ctl start || true

# 4) Start the Node API (which also serves the UI) in the foreground.
echo "[entrypoint] Starting Mapfile Preview (UI + API) on port ${PORT:-4300} ..."
cd /app/server
exec node src/index.js
