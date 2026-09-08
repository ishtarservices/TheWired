#!/bin/bash
# Routine production deploy, run ON the server from /opt/thewired.
#
# Pulls the images that .github/workflows/build-images.yml published from
# `main` and recreates whatever changed. It does NOT update
# docker-compose.prod.yml or .env — those live on the host and are edited by
# hand (docs/DEPLOY.md). `config` runs first so a missing required variable or
# a YAML slip fails here instead of half-way through a restart.
set -euo pipefail
cd /opt/thewired
docker compose -f docker-compose.prod.yml config > /dev/null
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
