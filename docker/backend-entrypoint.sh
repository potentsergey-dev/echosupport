#!/bin/sh
set -eu

echo "Applying database migrations..."
pnpm exec prisma migrate deploy

echo "Ensuring the initial owner and demo agent exist..."
node dist/db/seed.js

echo "Starting EchoSupport..."
exec node dist/index.js
