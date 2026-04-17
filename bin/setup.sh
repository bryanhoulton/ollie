#!/usr/bin/env bash
# One-shot local setup: creates Postgres DB, applies schema, copies .env.
set -euo pipefail

cd "$(dirname "$0")/.."

DB_NAME="${DB_NAME:-ollie}"

echo "==> Checking dependencies"
command -v yarn >/dev/null || { echo "yarn is required"; exit 1; }
command -v psql >/dev/null || { echo "psql (postgres) is required"; exit 1; }
command -v createdb >/dev/null || { echo "createdb (postgres) is required"; exit 1; }

if [ ! -f .env ]; then
  echo "==> Creating .env from template"
  cp .env.example .env
  echo "    Edit .env before running 'yarn dev'."
fi

echo "==> Installing node deps"
yarn install --silent

echo "==> Ensuring Postgres database '$DB_NAME' exists"
if psql -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
  echo "    Database already exists."
else
  createdb "$DB_NAME"
  echo "    Created."
fi

echo "==> Applying schema"
psql "$DB_NAME" -q -f src/db/schema.sql

echo ""
echo "Setup complete. Next steps:"
echo "  1. Fill in .env with your Slack app credentials."
echo "  2. In one shell:  ngrok http 3000"
echo "  3. Paste the ngrok URL into PUBLIC_BASE_URL in .env,"
echo "     and into the two Slack app manifests."
echo "  4. In another shell:  yarn dev"
