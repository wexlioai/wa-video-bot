#!/usr/bin/env bash
# Builds the one-file installers (dist/setup-oracle.sh, dist/setup-windows.ps1) from this repo.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd); NAME=wa-video-bot; T=$(mktemp -d); mkdir -p dist "$T/$NAME"
git ls-files | grep -v '^installers/\|^dist/' | tar -cf - -T - | tar -xf - -C "$T/$NAME"
(cd "$T" && tar -czf payload.tgz "$NAME" && zip -qr payload.zip "$NAME")
{ cat installers/oracle-template.sh; base64 -w 76 "$T/payload.tgz"; } > dist/setup-oracle.sh
python3 - "$T/payload.zip" <<'PY'
import base64, sys, textwrap
t = open('installers/windows-template.ps1').read()
b = base64.b64encode(open(sys.argv[1], 'rb').read()).decode()
open('dist/setup-windows.ps1', 'w', newline='\r\n').write(t.replace('__PAYLOAD__', '\n'.join(textwrap.wrap(b, 100))))
PY
rm -rf "$T"; echo "built dist/setup-oracle.sh and dist/setup-windows.ps1"
