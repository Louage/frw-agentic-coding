#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

function parseArgs(argv) {
  const args = { schema: "", data: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--schema" && i + 1 < argv.length) {
      args.schema = argv[i + 1];
      i += 1;
      continue;
    }

    if (current === "--data" && i + 1 < argv.length) {
      args.data = argv[i + 1];
      i += 1;
      continue;
    }
  }

  return args;
}

function readJson(filePath) {
  const fullPath = path.resolve(filePath);
  const raw = fs.readFileSync(fullPath, "utf8");
  return JSON.parse(raw);
}

function main() {
  const { schema, data } = parseArgs(process.argv.slice(2));

  if (!schema || !data) {
    console.error("Usage: node Validate-JsonSchema.mjs --schema <schemaPath> --data <dataPath>");
    process.exit(2);
  }

  const schemaJson = readJson(schema);
  const dataJson = readJson(data);

  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
  });
  addFormats(ajv);

  const validate = ajv.compile(schemaJson);
  const valid = validate(dataJson);

  if (!valid) {
    const errors = validate.errors ?? [];
    for (const err of errors) {
      const instancePath = err.instancePath || "/";
      const keyword = err.keyword || "unknown";
      const message = err.message || "validation error";
      console.error(`[schema] ${instancePath} (${keyword}): ${message}`);
    }
    process.exit(1);
  }
}

main();
