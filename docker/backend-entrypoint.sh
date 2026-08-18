#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  set -- node dist/index.js
fi

echo "Starting EchoSupport: $*"
exec "$@"
