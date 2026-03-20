#!/usr/bin/env bash
set -euo pipefail

rsync -a --delete --exclude node_modules --exclude .git --exclude .playwright-mcp ./ wleeaf:/opt/wleeaf/taccan/
ssh wleeaf 'docker compose -f /opt/wleeaf/docker-compose.yml up -d --build taccan'
