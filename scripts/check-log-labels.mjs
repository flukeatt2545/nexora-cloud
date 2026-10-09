#!/usr/bin/env node
// Log label guard.
//
// Every event the API writes to audit_logs should have a Thai name in actionLabel
// (app/dashboard/DashboardApp.tsx); otherwise the logs page shows the raw code, for example
// "user_file_category.updated". This script collects the action names from the Go code and
// lists any that have no label.
//
//   node scripts/check-log-labels.mjs     report, exit 1 if a label is missing

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BACKEND = join(ROOT, "backend");
const LABELS = join(ROOT, "app", "dashboard", "DashboardApp.tsx");

// Built at run time from a value the request chooses, so they cannot be read from the code.
const DYNAMIC = ["start", "stop", "restart", "rebuild", "redeploy"].map((action) => `hosting.runtime.${action}.requested`);

const ACTION = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

function goFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return goFiles(path);
    return name.endsWith(".go") && !name.endsWith("_test.go") ? [path] : [];
  });
}

const actions = new Set(DYNAMIC);
for (const file of goFiles(BACKEND)) {
  const text = readFileSync(file, "utf8");
  // Action: "x"   and   Action: map[bool]string{true: "x", false: "y"}[...]
  for (const match of text.matchAll(/Action:\s*(?:"([^"]+)"|map\[bool\]string\{([^}]*)\})/g)) {
    if (match[1]) actions.add(match[1]);
    if (match[2]) for (const value of match[2].matchAll(/"([^"]+)"/g)) actions.add(value[1]);
  }
  // action := "x" / action = "x", later passed as Action: action
  for (const match of text.matchAll(/\baction\s*:?=\s*"([^"]+)"/g)) actions.add(match[1]);
  // helpers that take the action as a string argument
  for (const match of text.matchAll(/(?:botMailAdminAudit|auditMailAccess)\([^)]*?"([a-z_]+\.[a-z0-9_.]+)"/g)) actions.add(match[1]);
  // functions that return an action name, e.g. databaseSuspendAction
  for (const match of text.matchAll(/func \w*Action\([^)]*\) string \{([\s\S]*?)\n\}/g)) {
    for (const value of match[1].matchAll(/"([^"]+)"/g)) actions.add(value[1]);
  }
  // SQL that writes audit rows directly
  for (const match of text.matchAll(/INSERT INTO audit_logs[\s\S]*?`/g)) {
    for (const value of match[0].matchAll(/'([a-z_]+\.[a-z0-9_.]+)'/g)) actions.add(value[1]);
  }
}

const source = readFileSync(LABELS, "utf8");
const start = source.indexOf("const actionLabel: Record<string, string> = {");
const end = source.indexOf("\n};", start);
const labelled = new Set([...source.slice(start, end).matchAll(/"([a-z0-9_.]+)":/g)].map((match) => match[1]));

const missing = [...actions].filter((action) => ACTION.test(action) && !labelled.has(action)).sort();
if (missing.length) {
  console.log(`${missing.length} log action(s) have no Thai name in actionLabel (app/dashboard/DashboardApp.tsx):`);
  for (const action of missing) console.log(`  ${action}`);
  process.exit(1);
}
console.log(`All ${actions.size} log actions have a Thai name.`);
