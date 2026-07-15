#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TARGET_FILE = path.join(os.tmpdir(), 'acdc-agent-flow-hooks.jsonl');

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const raw = await readStdin();
  if (!raw || !raw.trim()) {
    process.stdout.write('{"continue": true}\n');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stdout.write('{"continue": true}\n');
    return;
  }

  const event = {
    timestamp: payload.timestamp || new Date().toISOString(),
    hook_event_name: payload.hook_event_name || '',
    session_id: payload.session_id || '',
    agent_id: payload.agent_id || '',
    agent_type: payload.agent_type || '',
    prompt: payload.prompt || '',
    tool_name: payload.tool_name || '',
    tool_use_id: payload.tool_use_id || '',
    cwd: payload.cwd || '',
  };

  fs.mkdirSync(path.dirname(TARGET_FILE), { recursive: true });
  fs.appendFileSync(TARGET_FILE, `${JSON.stringify(event)}\n`, 'utf8');

  process.stdout.write('{"continue": true}\n');
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  process.stderr.write(`acdc-flow-hook write failed: ${message}\n`);
  process.stdout.write('{"continue": true}\n');
});
