#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! $1 =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z0-9][a-zA-Z0-9-]*$ ]]; then
  printf 'Usage: bash %s PILOT_HOSTNAME\n' "$0" >&2
  exit 2
fi

host=$1
origin="https://$host"
probe=(curl --disable --silent --show-error --output /dev/null --connect-timeout 5 --max-time 15)

redirect=$("${probe[@]}" --proto '=http' --write-out '%{http_code} %{redirect_url}' "http://$host/readyz")
case "$redirect" in
  "301 $origin/readyz" | "308 $origin/readyz")
    printf 'PASS HTTP redirects to the same host and path over HTTPS\n'
    ;;
  *)
    printf 'FAIL expected a permanent HTTP redirect to the pilot HTTPS readiness URL\n' >&2
    exit 1
    ;;
esac

for path in / /livez /startupz /readyz /health; do
  status=$("${probe[@]}" --proto '=https' --tlsv1.2 --write-out '%{http_code}' "$origin$path")
  if [[ "$status" != 200 ]]; then
    printf 'FAIL HTTPS %s returned %s, expected 200\n' "$path" "$status" >&2
    exit 1
  fi
  printf 'PASS HTTPS %s (200)\n' "$path"
done

script_dir=$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)
python3 -B "$script_dir/../shiori-ops.py" quick-check "$origin"
