"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pkg = require("../package.json");
const asset = name => path.join(root, "build", "icons", name);

function pngDimensions(file) {
  const data = fs.readFileSync(file);
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

test("approved icon assets contain square platform resolutions", () => {
  assert.deepEqual(pngDimensions(asset("trinity-control.png")), [1254, 1254]);
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    assert.deepEqual(pngDimensions(asset(path.join("png", `${size}.png`))), [size, size]);
  }

  const ico = fs.readFileSync(asset("trinity-control.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  assert.equal(count, 7);
  const icoSizes = Array.from({ length: count }, (_, index) => {
    const encoded = ico[6 + index * 16];
    return encoded === 0 ? 256 : encoded;
  });
  assert.deepEqual(icoSizes, [16, 24, 32, 48, 64, 128, 256]);

  const icns = fs.readFileSync(asset("trinity-control.icns"));
  assert.equal(icns.subarray(0, 4).toString("ascii"), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
});

test("Electron Builder and BrowserWindow use the approved icon without changing identity", () => {
  assert.equal(pkg.build.win.icon, "build/icons/trinity-control.ico");
  assert.equal(pkg.build.mac.icon, "build/icons/trinity-control.icns");
  assert.equal(pkg.build.nsis.installerIcon, "build/icons/trinity-control.ico");
  assert.equal(pkg.build.nsis.uninstallerIcon, "build/icons/trinity-control.ico");
  assert.equal(pkg.build.nsis.installerHeaderIcon, "build/icons/trinity-control.ico");
  assert.ok(pkg.build.files.includes("build/icons/trinity-control.png"));

  const main = fs.readFileSync(path.join(root, "electron-main.cjs"), "utf8");
  assert.match(main, /icon: path\.join\(__dirname, "build", "icons", "trinity-control\.png"\)/);
  assert.equal(pkg.productName, "Trinity Control");
  assert.equal(pkg.build.appId, "org.trinitybaptist.trinitycontrol");
  assert.equal(pkg.build.win.executableName, "Trinity Control");
  assert.equal(pkg.build.nsis.artifactName, "Trinity-Control-Setup-${version}-${arch}.${ext}");
});
