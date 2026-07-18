const { execFileSync } = require("child_process");
const path = require("path");

/**
 * Internal Alpha builds do not use an Apple Developer ID yet.
 * Electron's nested frameworks must still have a coherent signature,
 * so each packaged application is re-signed ad hoc before the DMG is made.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log(`Re-signing Alpha app ad hoc: ${appPath}`);

  try {
    execFileSync("/usr/bin/codesign", ["--remove-signature", appPath], {
      stdio: "inherit"
    });
  } catch {
    // A completely unsigned bundle has nothing to remove.
  }

  execFileSync(
    "/usr/bin/codesign",
    [
      "--force",
      "--deep",
      "--sign",
      "-",
      "--timestamp=none",
      appPath
    ],
    { stdio: "inherit" }
  );

  execFileSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    { stdio: "inherit" }
  );
};
