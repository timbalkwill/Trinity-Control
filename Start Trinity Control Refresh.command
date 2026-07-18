#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "Node.js is required. Install the LTS version from nodejs.org, then run this file again." buttons {"OK"} default button "OK" with icon caution'
  exit 1
fi
if [ ! -d node_modules ]; then
  npm install
fi
npm start
