# Trinity Control macOS Alpha builds

GitHub Actions builds separate Intel and Apple Silicon DMG installers.

These internal Alpha builds are ad-hoc signed. They are not yet signed with an
Apple Developer ID or notarized by Apple. The build verifies the nested Electron
frameworks, application signature, and DMG integrity before uploading anything.

Always install Trinity Control from the `.dmg` inside the GitHub artifact.
Do not run an unpacked `.app` copied from a build folder.

A future public release should replace ad-hoc signing with Developer ID signing
and Apple notarization.
