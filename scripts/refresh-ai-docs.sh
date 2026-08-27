#!/usr/bin/env bash
# Refresh the vendored llms.txt reference files under docs/ai/.
# These go stale — re-run before starting a new lot.
set -euo pipefail
cd "$(dirname "$0")/.."
fetch() {
  local name="$1" url="$2" out="docs/ai/$1.llms.txt"
  if curl -sfL --max-time 60 "$url" -o "$out.tmp"; then
    mv "$out.tmp" "$out"
    printf '  %-16s %8s B  %s\n' "$name" "$(wc -c < "$out" | tr -d ' ')" "$url"
  else
    rm -f "$out.tmp"
    printf '  %-16s   FAILED  %s\n' "$name" "$url" >&2
    return 1
  fi
}
echo "Refreshing docs/ai/ ..."
fetch convex          https://docs.convex.dev/llms.txt
fetch better-auth     https://www.better-auth.com/llms.txt
fetch tanstack-start  https://tanstack.com/start/latest/llms.txt
fetch shadcn          https://ui.shadcn.com/llms.txt
echo "Astro: no llms.txt published — use the astro-docs MCP server instead."
