#!/usr/bin/env bash
# ─── FeedForge Installer / Updater ──────────────────────────────────────────
# Builds the extension and opens Brave's extension page for installation.
# Works with Brave, Chrome, Chromium, and Edge.
#
# Usage:
#   ./install.sh           First-time install (build + instructions)
#   ./install.sh --update  Update: pull latest code, rebuild, and reload
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/.output/chrome-mv3"
BOLD="\033[1m"
DIM="\033[2m"
PURPLE="\033[35m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RED="\033[31m"
RESET="\033[0m"

IS_UPDATE=false
if [[ "$1" == "--update" || "$1" == "-u" ]]; then
  IS_UPDATE=true
fi

echo ""
echo -e "${PURPLE}${BOLD}  ⚒️  FeedForge — ${IS_UPDATE:+Updater}${IS_UPDATE:-Installer}${RESET}"
echo -e "${DIM}  Custom YouTube Algorithm Extension${RESET}"
echo ""

# ── Step 1: Check dependencies ──────────────────────────────────────────────

if ! command -v npm &>/dev/null; then
  echo -e "${YELLOW}  ✗ npm not found. Please install Node.js first.${RESET}"
  exit 1
fi

# ── Step 2: Pull latest code (update mode only) ────────────────────────────

if $IS_UPDATE; then
  if command -v git &>/dev/null && [ -d "$SCRIPT_DIR/.git" ]; then
    echo -e "${CYAN}  ◌ Pulling latest changes...${RESET}"
    cd "$SCRIPT_DIR" && git pull --ff-only 2>&1 | sed 's/^/    /'
    echo -e "${GREEN}  ✓ Code updated${RESET}"
  else
    echo -e "${YELLOW}  ! Not a git repo — skipping pull. Download the latest zip instead.${RESET}"
  fi
fi

# ── Step 3: Install node_modules if missing ─────────────────────────────────

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo -e "${CYAN}  ◌ Installing dependencies...${RESET}"
  cd "$SCRIPT_DIR" && npm install --silent
  echo -e "${GREEN}  ✓ Dependencies installed${RESET}"
elif $IS_UPDATE; then
  echo -e "${CYAN}  ◌ Syncing dependencies...${RESET}"
  cd "$SCRIPT_DIR" && npm install --silent
  echo -e "${GREEN}  ✓ Dependencies synced${RESET}"
fi

# ── Step 4: Build production extension ──────────────────────────────────────

echo -e "${CYAN}  ◌ Building extension...${RESET}"
cd "$SCRIPT_DIR" && npm run build --silent 2>/dev/null
echo -e "${GREEN}  ✓ Extension built → .output/chrome-mv3/${RESET}"

# ── Step 5: Read version from manifest ──────────────────────────────────────

if command -v node &>/dev/null; then
  VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$OUTPUT_DIR/manifest.json','utf8')).version)" 2>/dev/null || echo "unknown")
  echo -e "${GREEN}  ✓ Version: v${VERSION}${RESET}"
fi

# ── Step 6: Detect browser ──────────────────────────────────────────────────

BROWSER_CMD=""
BROWSER_NAME=""
EXTENSIONS_URL=""

if command -v brave-browser &>/dev/null; then
  BROWSER_CMD="brave-browser"
  BROWSER_NAME="Brave"
  EXTENSIONS_URL="brave://extensions"
elif command -v brave &>/dev/null; then
  BROWSER_CMD="brave"
  BROWSER_NAME="Brave"
  EXTENSIONS_URL="brave://extensions"
elif command -v brave-browser-stable &>/dev/null; then
  BROWSER_CMD="brave-browser-stable"
  BROWSER_NAME="Brave"
  EXTENSIONS_URL="brave://extensions"
elif command -v google-chrome &>/dev/null; then
  BROWSER_CMD="google-chrome"
  BROWSER_NAME="Chrome"
  EXTENSIONS_URL="chrome://extensions"
elif command -v google-chrome-stable &>/dev/null; then
  BROWSER_CMD="google-chrome-stable"
  BROWSER_NAME="Chrome"
  EXTENSIONS_URL="chrome://extensions"
elif command -v chromium &>/dev/null; then
  BROWSER_CMD="chromium"
  BROWSER_NAME="Chromium"
  EXTENSIONS_URL="chrome://extensions"
elif command -v chromium-browser &>/dev/null; then
  BROWSER_CMD="chromium-browser"
  BROWSER_NAME="Chromium"
  EXTENSIONS_URL="chrome://extensions"
fi

# ── Step 7: Print result ────────────────────────────────────────────────────

echo ""

if $IS_UPDATE; then
  # ── Update mode: just tell them to reload ──
  echo -e "${GREEN}${BOLD}  ✓ Update complete!${RESET}"
  echo ""
  if [ -n "$BROWSER_CMD" ]; then
    echo -e "  Go to ${CYAN}${EXTENSIONS_URL}${RESET} and click ${PURPLE}Reload${RESET} on FeedForge."
    echo -e "${CYAN}  ◌ Opening ${EXTENSIONS_URL}...${RESET}"
    nohup "$BROWSER_CMD" "$EXTENSIONS_URL" &>/dev/null &
  else
    echo -e "  Open your browser's extensions page and click ${PURPLE}Reload${RESET} on FeedForge."
  fi
  echo ""
else
  # ── Fresh install mode: full instructions ──
  if [ -n "$BROWSER_CMD" ]; then
    echo -e "${GREEN}  ✓ Detected ${BROWSER_NAME}${RESET}"
    echo -e "${CYAN}  ◌ Opening ${EXTENSIONS_URL}...${RESET}"
    nohup "$BROWSER_CMD" "$EXTENSIONS_URL" &>/dev/null &
    echo ""
  else
    echo -e "${YELLOW}  ! No Chromium browser detected automatically.${RESET}"
    echo -e "${DIM}    Open your browser's extensions page manually.${RESET}"
    echo ""
  fi

  echo -e "${BOLD}  ┌─────────────────────────────────────────────┐${RESET}"
  echo -e "${BOLD}  │  Installation Steps:                        │${RESET}"
  echo -e "${BOLD}  │                                             │${RESET}"
  echo -e "${BOLD}  │  1. Enable ${PURPLE}Developer Mode${RESET}${BOLD} (top-right toggle) │${RESET}"
  echo -e "${BOLD}  │  2. Click ${PURPLE}\"Load unpacked\"${RESET}${BOLD} (top-left)         │${RESET}"
  echo -e "${BOLD}  │  3. Navigate to:                            │${RESET}"
  echo -e "${BOLD}  │                                             │${RESET}"
  echo -e "${CYAN}  │  ${OUTPUT_DIR}${RESET}"
  echo -e "${BOLD}  │                                             │${RESET}"
  echo -e "${BOLD}  │  4. Click ${PURPLE}\"Select Folder\"${RESET}${BOLD}                    │${RESET}"
  echo -e "${BOLD}  │  5. Done! Pin FeedForge to your toolbar 📌  │${RESET}"
  echo -e "${BOLD}  └─────────────────────────────────────────────┘${RESET}"
  echo ""
  echo -e "${DIM}  The extension folder path has been copied below for easy pasting:${RESET}"
  echo ""
  echo "  $OUTPUT_DIR"
  echo ""

  # Try to copy to clipboard
  if command -v xclip &>/dev/null; then
    echo -n "$OUTPUT_DIR" | xclip -selection clipboard 2>/dev/null && \
      echo -e "${GREEN}  ✓ Path copied to clipboard!${RESET}"
  elif command -v xsel &>/dev/null; then
    echo -n "$OUTPUT_DIR" | xsel --clipboard 2>/dev/null && \
      echo -e "${GREEN}  ✓ Path copied to clipboard!${RESET}"
  elif command -v wl-copy &>/dev/null; then
    echo -n "$OUTPUT_DIR" | wl-copy 2>/dev/null && \
      echo -e "${GREEN}  ✓ Path copied to clipboard!${RESET}"
  fi
fi

echo -e "${DIM}  To update later: ${RESET}${CYAN}./install.sh --update${RESET}"
echo ""
