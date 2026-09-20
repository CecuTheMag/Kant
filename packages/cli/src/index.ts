#!/usr/bin/env node
/**
 * Kant CLI — Encrypted P2P Messenger
 *
 * Two modes:
 *   kant                  → TUI (blessed) — Magician's original interface
 *   kant <command> [opts] → Command mode — flags/env, JSON output, scriptable
 *
 * Commands: connect, status, send, listen, keypair, contacts, circuit, help
 */

import './idb-shim.js';

// ── Mode detection ──────────────────────────────────────────────────────────

const VALID_COMMANDS = ['connect', 'status', 'send', 'listen', 'keypair', 'contacts', 'circuit', 'help'];

const rawArg = process.argv[2] || '';
const isCommandMode = VALID_COMMANDS.includes(rawArg);

if (isCommandMode) {
  // Import command mode dynamically so TUI deps (blessed) aren't loaded
  import('./cli-commands.js').then(m => m.main()).catch(e => {
    process.stderr.write(`FATAL: ${e?.message ?? e}\n`);
    if (e?.stack) process.stderr.write(e.stack + '\n');
    process.exit(1);
  });
} else {
  // TUI mode — Magician's original blessed interface
  import('./cli-tui.js').then(m => m.main()).catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
  });
}
