# syntax=docker/dockerfile:1
#
# Mapfile Preview — single all-in-one image.
# Bundles: Angular UI (built) + Node/Express API + MapServer 8 (validation binary
# and CGI endpoint via Apache, used internally for WMS/WFS previews).
#
# Build & run with docker-compose.yml (recommended):
#   docker compose up -d --build   ->  open http://localhost:4300

##########  Stage 1 — build the Angular UI  ##########
FROM node:20-bookworm-slim AS ui
WORKDIR /ui
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
# Use the "docker" configuration (= production, but without bundle-size budgets,
# which the app currently exceeds because Monaco editor is bundled). Output is
# the same optimized build at /ui/dist/client/browser.
RUN npm run build -- --configuration production,docker

##########  Stage 2 — runtime (Node API + MapServer + Apache)  ##########
FROM node:20-bookworm-slim AS runtime

# MapServer 8 (CGI binary) + Apache (serves the CGI used for WMS/WFS previews).
# No native Node modules are used, so no build toolchain is required.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      apache2 \
      cgi-mapserver \
      ca-certificates \
 && a2enmod cgid \
 && a2enconf serve-cgi-bin \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# --- API dependencies ---
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# --- API source ---
COPY server/ ./
# Never ship a committed local override: config.local.json would shadow the
# container environment variables (and it contains Windows paths).
RUN rm -f /app/server/src/config.local.json

# --- Built UI (served statically by the Node API, i.e. same origin as /api) ---
COPY --from=ui /ui/dist/client/browser /app/ui

# --- MapServer / Apache config, seed mapfile, entrypoint ---
COPY docker/mapserver.conf       /etc/mapserver/mapserver.conf
COPY docker/mapserv-apache.conf  /etc/apache2/conf-enabled/zz-mapserv.conf
COPY docker/example.map          /opt/seed/example.map
COPY docker/entrypoint.sh        /entrypoint.sh
# Normalize line endings (in case the repo was checked out with CRLF on Windows)
# and make the entrypoint executable.
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# --- Container defaults (override any of these in docker-compose.yml) ---
ENV PORT=4300 \
    WORKSPACE_DIR=/data/maps \
    UI_DIST=/app/ui \
    MAPSERV_PATH=/usr/lib/cgi-bin/mapserv \
    MAPSERV_URL=http://127.0.0.1/cgi-bin/mapserv \
    MAPSERVER_CONF=/etc/mapserver/mapserver.conf \
    CURRENT_MAP=/data/maps/example.map \
    CURRENT_MAP_ALIAS=example \
    USE_MAP_ALIAS=1

EXPOSE 4300
VOLUME ["/data/maps"]
ENTRYPOINT ["/entrypoint.sh"]
