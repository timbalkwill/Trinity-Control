#!/bin/bash
set -euo pipefail

shopt -s nullglob
apps=(dist/mac*/"Trinity Control.app")

if [ ${#apps[@]} -eq 0 ]; then
  echo "No packaged Trinity Control applications were found."
  exit 1
fi

for app in "${apps[@]}"; do
  echo "Verifying: $app"
  test -f "$app/Contents/Info.plist"
  test -x "$app/Contents/MacOS/Trinity Control"
  test -f "$app/Contents/_CodeSignature/CodeResources"
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$app"
done

dmgs=(dist/*.dmg)
if [ ${#dmgs[@]} -eq 0 ]; then
  echo "No DMG installers were produced."
  exit 1
fi

for dmg in "${dmgs[@]}"; do
  echo "Checking DMG: $dmg"
  /usr/bin/hdiutil verify "$dmg"
done

echo "All macOS application bundles and DMGs passed verification."
