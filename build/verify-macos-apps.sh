#!/bin/bash
set -euo pipefail
shopt -s nullglob

apps=(dist/mac*/"Trinity Control Refresh.app")
if [ ${#apps[@]} -eq 0 ]; then
  echo "No packaged Trinity Control apps found."
  exit 1
fi

for app in "${apps[@]}"; do
  echo "Strictly verifying $app"
  test -f "$app/Contents/_CodeSignature/CodeResources"
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$app"
done

dmgs=(dist/*.dmg)
if [ ${#dmgs[@]} -eq 0 ]; then
  echo "No DMGs were produced."
  exit 1
fi

for dmg in "${dmgs[@]}"; do
  echo "Verifying $dmg"
  /usr/bin/hdiutil verify "$dmg"
done
