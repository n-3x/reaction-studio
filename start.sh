#!/usr/bin/env bash
# Self-host launcher: checks tools, then starts Reaction Studio on this machine only.
set -euo pipefail
cd "$(dirname "$0")"

missing=()
for tool in python3 ffmpeg ffprobe yt-dlp; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing required tools: ${missing[*]}"
  echo "  macOS:  brew install python ffmpeg yt-dlp"
  echo "  Linux:  sudo apt install python3 ffmpeg && pipx install yt-dlp"
  exit 1
fi
command -v codex >/dev/null 2>&1 || echo "Note: 'codex' CLI not found. Automatic starting-image creation needs it (npm i -g @openai/codex); the guided ChatGPT-website flow still works."

[ -f .env ] || cp .env.example .env
echo "Starting on http://127.0.0.1:${PORT:-8787}  (open Connections in the app to add your own fal/AIMLAPI key and connect your ChatGPT account)"
exec python3 app.py --port "${PORT:-8787}"
