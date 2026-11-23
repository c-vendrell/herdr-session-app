#!/usr/bin/env bash
# Remove session-resume. Keeps the saved state unless --purge is given.
set -euo pipefail

APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
NAME="main-resume"
PURGE=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app-home) APP_HOME="${2:?--app-home needs a path}"; shift 2 ;;
    --name)     NAME="${2:?--name needs a name}"; shift 2 ;;
    --purge)    PURGE=1; shift ;;
    -h|--help)
      echo "Usage: ./uninstall.sh [--app-home PATH] [--name LAYOUT] [--purge]"; exit 0 ;;
    *) echo "error: unknown option: $1" >&2; exit 2 ;;
  esac
done

if command -v herdr-app >/dev/null 2>&1; then
  HERDR_APP_HOME="$APP_HOME" herdr-app do layout.switch '{"name":"main"}' >/dev/null 2>&1 || true
fi

rm -f  "$APP_HOME/layouts/$NAME.json"
rm -rf "$APP_HOME/mods/session-resume"
if [ "$PURGE" -eq 1 ]; then
  rm -f "$APP_HOME/session-resume.json" "$APP_HOME/session-resume.config.json"
  echo "Removed the mod, the layout '$NAME', the saved state and the config."
else
  echo "Removed the mod and the layout '$NAME'. Kept session-resume.json and the config (use --purge to delete them)."
fi
