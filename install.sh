#!/usr/bin/env bash
# Install session-resume into a Herdr app home.
#
# Herdr only runs a mod that a layout shows, and its shipped layouts are
# read-only. So this script copies the mod and creates a personal layout:
# a copy of a base layout (default: main) plus a 1 px block that hosts the mod.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
BASE="main"
NAME="main-resume"
SWITCH=1

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

  --app-home PATH   Herdr app home (default: $HERDR_APP_HOME or ~/.config/herdr-app)
  --base NAME       layout to copy (default: main)
  --name NAME       name of the new layout (default: main-resume)
  --no-switch       do not switch the window to the new layout
  -h, --help        show this help

Existing files are backed up under <app home>/backups/session-resume-<time>/.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app-home) APP_HOME="${2:?--app-home needs a path}"; shift 2 ;;
    --base)     BASE="${2:?--base needs a name}"; shift 2 ;;
    --name)     NAME="${2:?--name needs a name}"; shift 2 ;;
    --no-switch) SWITCH=0; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "error: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

command -v python3 >/dev/null 2>&1 || { echo "error: python3 is required" >&2; exit 1; }
[ -d "$APP_HOME/layouts" ] && [ -d "$APP_HOME/mods" ] || {
  echo "error: Herdr app home not found at: $APP_HOME" >&2
  echo "       Start the Herdr app once, or pass --app-home." >&2
  exit 1
}
[ -f "$APP_HOME/layouts/$BASE.json" ] || { echo "error: layout not found: $APP_HOME/layouts/$BASE.json" >&2; exit 1; }

BACKUP="$APP_HOME/backups/session-resume-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP/layouts" "$BACKUP/mods"
[ -f "$APP_HOME/layouts/$NAME.json" ] && cp -a "$APP_HOME/layouts/$NAME.json" "$BACKUP/layouts/"
[ -d "$APP_HOME/mods/session-resume" ] && cp -a "$APP_HOME/mods/session-resume" "$BACKUP/mods/"

echo "Installing the mod..."
rm -rf "$APP_HOME/mods/session-resume"
mkdir -p "$APP_HOME/mods/session-resume"
for f in mod.json main.js logic.js; do
  cp "$SCRIPT_DIR/mods/session-resume/$f" "$APP_HOME/mods/session-resume/$f"
done

echo "Creating the layout '$NAME' from '$BASE'..."
APP_HOME="$APP_HOME" BASE="$BASE" NAME="$NAME" python3 - <<'PY'
import json, os, sys

home, base, name = os.environ["APP_HOME"], os.environ["BASE"], os.environ["NAME"]
with open(os.path.join(home, "layouts", f"{base}.json"), encoding="utf-8") as f:
    layout = json.load(f)

HOST = {"id": "session-resume-host", "type": "block", "size": {"px": 1},
        "content": {"mod": "session-resume"}}

def has_host(node):
    return node.get("id") == HOST["id"] or any(has_host(c) for c in node.get("children", []))

if not has_host(layout):
    layout.setdefault("children", []).append(HOST)

path = os.path.join(home, "layouts", f"{name}.json")
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(layout, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
PY

if command -v herdr-app >/dev/null 2>&1; then
  HERDR_APP_HOME="$APP_HOME" herdr-app check "$APP_HOME/mods/session-resume" || {
    echo "error: mod check failed. Previous files are in: $BACKUP" >&2; exit 1; }
  if [ "$SWITCH" -eq 1 ]; then
    HERDR_APP_HOME="$APP_HOME" herdr-app do layout.switch "{\"name\":\"$NAME\"}" >/dev/null 2>&1 \
      && echo "Switched the window to the layout '$NAME'." \
      || echo "Could not switch (is the app running?). Pick '$NAME' with the layout switcher."
  fi
fi

cat <<EOF

Installed.
  Mod:     $APP_HOME/mods/session-resume/
  Layout:  $APP_HOME/layouts/$NAME.json
  Backup:  $BACKUP

The mod runs while the window shows the '$NAME' layout.
It records which local terminals run an agent and, after a reboot, resumes them.
Config (optional): $APP_HOME/session-resume.config.json  (see README)
EOF
