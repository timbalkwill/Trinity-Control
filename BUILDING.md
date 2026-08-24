# Trinity Control builds

## Windows production build

The supported Windows production target is an unsigned x64 NSIS installer.
Run on a Windows x64 development machine:

```powershell
npm ci
npm test
npm run build:win
```

The installer is written to `dist/Trinity-Control-Setup-<version>-x64.exe`.
Unsigned internal builds are expected to show a Microsoft Defender SmartScreen
warning. No signing certificate is configured. Windows may also ask whether to
allow Trinity Control on private networks when the Browser Operator first binds
to TCP port 4310; allow private networks only.

Application data is stored under Electron's per-user application-data root:
`%APPDATA%\\Trinity Control Refresh`. It is never stored in Program Files.

After importing a `.trinitybackup`, configure machine-local values separately:

- QLC+ executable, normally the installed `qlcplus.exe`
- QLC+ `.qxw` workspace path
- Home Assistant URL, token, and entity configuration
- any credentials intentionally excluded from portable backups
- Windows Firewall private-network access for TCP 4310

The official Windows `.ico` is still pending approved square artwork. Until it
is supplied, electron-builder uses its default application icon.

## macOS Alpha builds

GitHub Actions builds separate Intel and Apple Silicon DMG installers.

These internal Alpha builds are ad-hoc signed. They are not yet signed with an
Apple Developer ID or notarized by Apple. The build verifies the nested Electron
frameworks, application signature, and DMG integrity before uploading anything.

Always install Trinity Control from the `.dmg` inside the GitHub artifact.
Do not run an unpacked `.app` copied from a build folder.

A future public release should replace ad-hoc signing with Developer ID signing
and Apple notarization.
