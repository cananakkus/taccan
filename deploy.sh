#!/usr/bin/env bash
set -euo pipefail

ssh wleeaf 'cd /opt/wleeaf/taccan && git pull && docker compose -f /opt/wleeaf/docker-compose.yml up -d --build taccan'
