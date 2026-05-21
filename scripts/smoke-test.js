"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const size = (relativePath) => fs.statSync(path.join(root, relativePath)).size;

const pkg = readJson("package.json");
const commands = pkg.contributes?.commands?.map((command) => command.command) || [];
const requiredCommands = [
  "lynvo.openBoard",
  "lynvo.openTable",
  "lynvo.openActivity",
  "lynvo.openConflicts",
  "lynvo.openLabels",
  "lynvo.openInsights",
  "lynvo.syncBoard",
  "lynvo.quickCreateTask",
  "lynvo.createTaskFromCode",
  "lynvo.connectGitHub",
];

assert.strictEqual(pkg.name, "lynvo");
assert.strictEqual(pkg.main, "./dist/extension.js");
assert.strictEqual(pkg.license, "MIT");
assert.ok(pkg.publisher, "publisher is required for marketplace publishing");
assert.ok(pkg.repository?.url, "repository url is required");
assert.ok(pkg.icon?.endsWith(".png"), "marketplace icon should be PNG");
assert.ok(exists(pkg.icon), `missing icon: ${pkg.icon}`);
assert.ok(exists("media/lynvo-board-preview.png"), "missing marketplace preview image");
assert.ok(exists("LICENSE"), "missing LICENSE");
assert.ok(exists("README.md"), "missing README.md");
assert.ok(exists("CHANGELOG.md"), "missing CHANGELOG.md");
assert.ok(exists(".github/workflows/ci.yml"), "missing CI workflow");
assert.ok(exists(".github/workflows/package.yml"), "missing package workflow");
assert.ok(exists("docs/RELEASE.md"), "missing release checklist");
assert.ok(commands.length > 0, "commands must be contributed");
assert.strictEqual(new Set(commands).size, commands.length, "commands must be unique");
requiredCommands.forEach((command) => {
  assert.ok(commands.includes(command), `missing command: ${command}`);
});
assert.ok(exists("dist/extension.js"), "missing compiled extension bundle");
assert.ok(exists("dist/webview.js"), "missing compiled webview bundle");
assert.ok(size("dist/extension.js") > 1024, "extension bundle is unexpectedly small");
assert.ok(size("dist/webview.js") > 1024, "webview bundle is unexpectedly small");

const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
assert.ok(!readme.includes("YOUR GIF"), "README still contains placeholder text");
assert.ok(readme.includes("Shadow Branch Sync"), "README must document sync architecture");
assert.ok(readme.includes(".vscode/lynvo/"), "README must document modular persistence");

console.log("Lynvo smoke checks passed.");
