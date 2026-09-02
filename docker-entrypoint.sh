#!/bin/sh
set -e

echo "Running Prisma migrations..."
npx prisma migrate deploy

if [ "${RUN_DB_SEED}" = "true" ]; then
  echo "Running database seed..."
  npx tsx prisma/seed.ts
fi

echo "Starting OpCore Compliance API on port ${PORT:-3010}..."
exec node dist/index.js
