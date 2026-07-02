#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const REQUIRED_PREFIX = "./assets/generated/";
const CONTRIBUTION_KEYS = [
  "chatSkills",
  "chatInstructions",
  "chatPromptFiles",
  "chatAgents",
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function readPackageJson() {
  const packagePath = path.resolve("package.json");
  if (!fs.existsSync(packagePath)) {
    throw new Error(`package.json not found at ${packagePath}`);
  }

  const raw = fs.readFileSync(packagePath, "utf8");
  return JSON.parse(raw);
}

function validateContributionPaths(pkg) {
  const contributes = pkg.contributes ?? {};
  const violations = [];

  for (const key of CONTRIBUTION_KEYS) {
    const entries = contributes[key];
    if (!Array.isArray(entries)) {
      continue;
    }

    for (let index = 0; index < entries.length; index += 1) {
      const item = entries[index] ?? {};
      const itemPath = item.path;

      if (typeof itemPath !== "string" || itemPath.length === 0) {
        violations.push(`${key}[${index}] has missing or non-string path`);
        continue;
      }

      if (!itemPath.startsWith(REQUIRED_PREFIX)) {
        violations.push(`${key}[${index}] path '${itemPath}' must start with '${REQUIRED_PREFIX}'`);
      }
    }
  }

  return violations;
}

try {
  const pkg = readPackageJson();
  const violations = validateContributionPaths(pkg);

  if (violations.length > 0) {
    fail("Contribution path guard failed. Detected invalid package.json contributions:");
    for (const violation of violations) {
      fail(`- ${violation}`);
    }
    process.exit(process.exitCode ?? 1);
  }

  console.log("Contribution path guard passed.");
} catch (error) {
  fail(`Contribution path guard failed with error: ${error.message}`);
  process.exit(process.exitCode ?? 1);
}
