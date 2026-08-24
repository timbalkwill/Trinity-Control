const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function resolveLocalModule(parentFile, request) {
  const unresolved = path.resolve(path.dirname(parentFile), request);
  const candidates = path.extname(unresolved)
    ? [unresolved]
    : [unresolved, `${unresolved}.cjs`, `${unresolved}.js`, path.join(unresolved, "index.cjs"), path.join(unresolved, "index.js")];
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function localRuntimeGraph(entries) {
  const discovered = new Set();
  const visit = file => {
    const absolute = path.resolve(root, file);
    if (discovered.has(absolute)) return;
    discovered.add(absolute);
    const source = fs.readFileSync(absolute, "utf8");
    for (const match of source.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      const dependency = resolveLocalModule(absolute, match[1]);
      assert.ok(dependency, `${path.relative(root, absolute)} requires unresolved local module ${match[1]}`);
      visit(dependency);
    }
  };
  entries.forEach(visit);
  return [...discovered].map(file => path.relative(root, file).split(path.sep).join("/")).sort();
}

function includedByElectronBuilder(file, patterns) {
  let included = false;
  for (const pattern of patterns) {
    const excluded = pattern.startsWith("!");
    const candidate = excluded ? pattern.slice(1) : pattern;
    const matches = candidate.endsWith("/**/*")
      ? file.startsWith(candidate.slice(0, -4))
      : candidate === file;
    if (matches) included = !excluded;
  }
  return included;
}

test("Electron package covers the complete local main/preload runtime require graph", () => {
  const runtimeFiles = localRuntimeGraph(["electron-main.cjs", "preload.cjs"]);
  const packagePatterns = packageJson.build.files;
  const missing = runtimeFiles.filter(file => !includedByElectronBuilder(file, packagePatterns));

  assert.deepEqual(missing, [], `Missing packaged runtime modules:\n${missing.join("\n")}`);
  assert.ok(runtimeFiles.includes("lighting-execution.cjs"));
  assert.ok(includedByElectronBuilder("lighting-execution.cjs", packagePatterns));
  assert.ok(includedByElectronBuilder("public/app.js", packagePatterns));
  assert.ok(!includedByElectronBuilder("test/cue-execution.test.cjs", packagePatterns));
});
