// Pure logic for session-resume: no imports, so it can be unit-tested with Node.
//
// The idea: Herdr's core recreates every terminal after a reboot (same address,
// same folder) but as a bare shell. We remember which terminals were running
// an AI agent, and after a reboot we type the agent's "continue" command into
// the matching shell.

/** How each agent continues its most recent session in the current folder. */
export const DEFAULT_CONTINUE = {
  claude: ["--continue"],
  opencode: ["--continue"],
  codex: ["resume", "--last"],
  pi: ["--continue"],
};

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "nu", "elvish", "xonsh"]);
const STATUS_ALIAS = { "claude-code": "claude" };
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const REFRESH_SEEN_MS = 3600 * 1000;
const SETTLE_MS = 4000;
const RETRY_MS = 12000;
const MAX_ATTEMPTS = 3;

export const baseName = (p) => String(p ?? "").split("/").pop();

/** Effective table: defaults plus the user's overrides. `false` disables an agent. */
export function continueTable(config) {
  const table = { ...DEFAULT_CONTINUE };
  const custom = config?.continue;
  if (custom && typeof custom === "object") {
    for (const [key, value] of Object.entries(custom)) {
      if (value === false || value === null) delete table[key];
      else if (Array.isArray(value) && value.every((v) => typeof v === "string")) table[key] = value;
    }
  }
  return table;
}

export const isLocal = (terminal) => typeof terminal?.address === "string" && !terminal.address.includes("/");

export function isShell(terminal) {
  if (terminal?.program?.shell === true) return true;
  const argv = terminal?.foreground?.argv;
  return Array.isArray(argv) && argv.length > 0 && SHELLS.has(baseName(argv[0]).replace(/^-/, ""));
}

/** Which known agent is in the foreground of this terminal, or null. */
export function agentOf(terminal, table) {
  const argv = terminal?.foreground?.argv;
  if (Array.isArray(argv) && argv.length) {
    // `claude`, `/opt/bin/opencode`, or `node /path/to/opencode`.
    for (const arg of argv.slice(0, 2)) {
      const name = baseName(arg);
      if (Object.prototype.hasOwnProperty.call(table, name)) return name;
    }
    return null; // The foreground is something else: a stale report must not count.
  }
  const app = terminal?.report?.app ?? terminal?.status?.app ?? terminal?.program?.key ?? null;
  const key = STATUS_ALIAS[app] ?? app;
  return key && Object.prototype.hasOwnProperty.call(table, key) ? key : null;
}

/** Single-quote for a POSIX shell. */
export const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The text to type into the recovered shell. */
export function commandFor(entry, terminal, table) {
  const args = table[entry.agent];
  if (!args) return null;
  const program = baseName(entry.argv?.[0]) || entry.agent;
  const cmd = [program, ...args].map((a, i) => (i === 0 ? a : quote(a))).join(" ");
  const here = terminal?.foreground?.cwd ?? terminal?.cwd ?? null;
  const same = (a, b) => String(a ?? "").replace(/\/+$/, "") === String(b ?? "").replace(/\/+$/, "");
  return entry.cwd && !same(entry.cwd, here) ? `cd ${quote(entry.cwd)} && ${cmd}` : cmd;
}

/**
 * Update the saved entries from the live terminals.
 *   state:  { version, entries: { [address]: { agent, argv, cwd, boot, seen, hold_until? } } }
 *   ctx:    { boot, now, table, ready }  (`ready`: the local terminal list is trustworthy)
 * Returns { state, changed, restore: [{ address, agent, text }] }. Does not mutate `state`.
 */
export function reconcile(state, terminals, ctx) {
  const { boot, now, table, ready } = ctx;
  const entries = { ...(state?.entries ?? {}) };
  const restore = [];
  let changed = false;
  for (const [address, entry] of Object.entries(entries)) {
    if (now - (entry.seen ?? 0) > MAX_AGE_MS) { delete entries[address]; changed = true; }
  }
  const local = terminals.filter(isLocal);
  const seenAddresses = new Set();

  for (const terminal of local) {
    if (terminal.state && terminal.state !== "live") continue;
    seenAddresses.add(terminal.address);
    const agent = agentOf(terminal, table);
    const prev = entries[terminal.address];

    if (agent) {
      const fg = terminal.foreground ?? {};
      const next = {
        agent,
        argv: Array.isArray(fg.argv) && fg.argv.length ? fg.argv : prev?.argv ?? [agent],
        cwd: fg.cwd ?? terminal.cwd ?? prev?.cwd ?? null,
        boot,
        seen: prev && prev.boot === boot && prev.agent === agent && now - (prev.seen ?? 0) < REFRESH_SEEN_MS ? prev.seen : now,
      };
      const same = prev && prev.agent === next.agent && prev.cwd === next.cwd && prev.boot === next.boot
        && prev.seen === next.seen && JSON.stringify(prev.argv) === JSON.stringify(next.argv);
      if (!same) { entries[terminal.address] = next; changed = true; }
      continue;
    }

    if (!prev || !isShell(terminal)) continue;

    if (prev.boot !== boot) {
      // A reboot (or a core restart) took the agent away; the shell is back.
      // Send the command, then check again: the shell may not have been ready.
      const tries = prev.restore?.boot === boot ? prev.restore.attempts : 0;
      const last = prev.restore?.boot === boot ? prev.restore.last : 0;
      const settled = !terminal.program_started_ms || now - terminal.program_started_ms >= SETTLE_MS;
      if (settled && tries < MAX_ATTEMPTS && now - last >= RETRY_MS) {
        const text = commandFor(prev, terminal, table);
        if (text) {
          restore.push({ address: terminal.address, agent: prev.agent, text, attempt: tries + 1 });
          entries[terminal.address] = { ...prev, restore: { boot, attempts: tries + 1, last: now } };
          changed = true;
        }
      }
    } else if (now >= (prev.hold_until ?? 0)) {
      // Same session and the agent is gone: the person closed it. Forget it.
      delete entries[terminal.address];
      changed = true;
    }
  }

  if (ready) {
    for (const [address, entry] of Object.entries(entries)) {
      if (seenAddresses.has(address) || address.includes("/")) continue;
      if (entry.boot === boot && now >= (entry.hold_until ?? 0)) {
        delete entries[address]; // The terminal was closed.
        changed = true;
      }
    }
  }

  return { state: { version: 1, entries }, changed, restore };
}
