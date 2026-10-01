"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
for (const script of [
  "regression-test.js",
  "persistence-regression-test.js",
  "sync-regression-test.js",
  "skill-regression-test.js",
  "agent-skill-regression-test.js",
  "ui-regression-test.js",
]) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
    cwd: root, stdio: "inherit", timeout: 120000,
  });
  if (result.error || result.status !== 0) {
    console.error(`Lynvo regression failed: ${script}`, result.error || `exit ${result.status}`);
    process.exit(result.status || 1);
  }
}
