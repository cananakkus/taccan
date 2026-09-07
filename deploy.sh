#!/usr/bin/env bash
set -euo pipefail

rsync -a --delete \
  --exclude node_modules --exclude .git --exclude .playwright-mcp \
  --exclude '.env' --exclude '.env.*' --exclude .taccan-state.json \
  --exclude test-results --exclude playwright-report --exclude coverage \
  --exclude frontend/dist \
  ./ wleeaf:/opt/wleeaf/taccan/
ssh wleeaf 'docker compose -f /opt/wleeaf/docker-compose.yml up -d --no-deps --build taccan'
