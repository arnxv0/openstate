#!/bin/bash
# Readable view of the debugging trail in logs/openstate.log (see lib/log.ts).
#
#   scripts/logs.sh            last 60 lines
#   scripts/logs.sh -f         follow
#   scripts/logs.sh episode    only lines whose scope or text matches "episode"
#   scripts/logs.sh -f voice   follow, filtered
set -euo pipefail
file="$(dirname "$0")/../logs/openstate.log"
follow=""
if [ "${1:-}" = "-f" ]; then follow=1; shift; fi
filter=${1:-}

format() {
  python3 -u -c '
import sys, json
needle = sys.argv[1].lower()
for line in sys.stdin:
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if needle and needle not in line.lower():
        continue
    data = " ".join(f"{k}={json.dumps(v, ensure_ascii=False)}" for k, v in (e.get("data") or {}).items() if v is not None)
    print(e["t"][11:23], e["src"][:5].ljust(5), e["scope"].ljust(8), e["msg"], data, flush=True)
' "$filter"
}

[ -f "$file" ] || { echo "no log yet: $file"; exit 0; }
if [ -n "$follow" ]; then tail -n 20 -f "$file" | format; else tail -n "${LINES_BACK:-60}" "$file" | format; fi
