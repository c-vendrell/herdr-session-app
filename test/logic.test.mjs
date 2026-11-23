import test from "node:test";
import assert from "node:assert/strict";
import { reconcile, agentOf, continueTable, commandFor } from "../mods/session-resume/logic.js";

const table = continueTable({});
const NOW = 1_000_000_000_000;
const shell = (address, cwd = "/work") => ({ address, state: "live", cwd, foreground: { name: "zsh", argv: ["/bin/zsh", "-l"], cwd } });
const agent = (address, name, cwd = "/work", extra = []) => ({ address, state: "live", cwd, foreground: { name: "x", argv: [name, ...extra], cwd } });
const run = (state, terms, over = {}) => reconcile(state, terms, { boot: "B1", now: NOW, table, ready: true, ...over });

test("remembers a running agent", () => {
  const { state } = run(null, [agent("t1", "opencode")]);
  assert.equal(state.entries.t1.agent, "opencode");
  assert.equal(state.entries.t1.boot, "B1");
});

test("agent closed in the same boot is forgotten", () => {
  const first = run(null, [agent("t1", "claude")]).state;
  const { state } = run(first, [shell("t1")], { now: NOW + 5 * 60_000 });
  assert.equal(state.entries.t1, undefined);
});

test("after a reboot the shell gets the continue command", () => {
  const before = run(null, [agent("t1", "claude", "/work/app")], {}).state;
  const out = run(before, [shell("t1", "/work/app")], { boot: "B2", now: NOW + 3600_000 });
  assert.equal(out.restore.length, 1);
  assert.equal(out.restore[0].text, "claude '--continue'");
  assert.ok(out.state.entries.t1, "entry is kept until the agent is back");
});

test("restore retries a few times, spaced out, then stops", () => {
  const before = run(null, [agent("t1", "codex")]).state;
  const a = run(before, [shell("t1")], { boot: "B2", now: NOW + 1000 });
  const tooSoon = run(a.state, [shell("t1")], { boot: "B2", now: NOW + 5_000 });
  const b = run(a.state, [shell("t1")], { boot: "B2", now: NOW + 14_000 });
  const c = run(b.state, [shell("t1")], { boot: "B2", now: NOW + 28_000 });
  const d = run(c.state, [shell("t1")], { boot: "B2", now: NOW + 60_000 });
  assert.equal(a.restore[0].text, "codex 'resume' '--last'");
  assert.equal(tooSoon.restore.length, 0);
  assert.equal(b.restore.length, 1);
  assert.equal(c.restore.length, 1);
  assert.equal(d.restore.length, 0, "gives up after 3 attempts");
});

test("waits until the recovered shell has settled", () => {
  const before = run(null, [agent("t1", "claude")]).state;
  const fresh = { ...shell("t1"), program_started_ms: NOW + 1000 - 1500 };
  assert.equal(run(before, [fresh], { boot: "B2", now: NOW + 1000 }).restore.length, 0);
  assert.equal(run(before, [fresh], { boot: "B2", now: NOW + 6000 }).restore.length, 1);
});

test("agent that came back refreshes the entry with the new boot", () => {
  const before = run(null, [agent("t1", "opencode")]).state;
  const a = run(before, [shell("t1")], { boot: "B2", now: NOW + 1000 });
  const b = run(a.state, [agent("t1", "opencode")], { boot: "B2", now: NOW + 30_000 });
  assert.equal(b.state.entries.t1.boot, "B2");
  assert.equal(b.state.entries.t1.restore, undefined);
});

test("a stale agent report does not count when the foreground is a shell", () => {
  const t = { ...shell("t1"), status: { app: "claude-code" }, report: { app: "claude-code" } };
  assert.equal(agentOf(t, table), null);
});

test("node wrapper is recognised", () => {
  assert.equal(agentOf(agent("t1", "node", "/w", ["/usr/lib/opencode"]), table), "opencode");
});

test("remote terminals are ignored", () => {
  const { state, restore } = run(null, [agent("pxmx/t1", "opencode")]);
  assert.deepEqual(state.entries, {});
  assert.equal(restore.length, 0);
});

test("a closed terminal is forgotten only when the list is trustworthy", () => {
  const before = run(null, [agent("t1", "claude")]).state;
  const later = NOW + 5 * 60_000;
  assert.ok(run(before, [], { now: later, ready: false }).state.entries.t1);
  assert.equal(run(before, [], { now: later, ready: true }).state.entries.t1, undefined);
});

test("cd is added when the shell is somewhere else", () => {
  const before = run(null, [agent("t1", "claude", "/a b")]).state;
  const out = run(before, [shell("t1", "/home")], { boot: "B2", now: NOW + 1000 });
  assert.equal(out.restore[0].text, "cd '/a b' && claude '--continue'");
});

test("user overrides and disabling", () => {
  const t = continueTable({ continue: { claude: ["--resume"], codex: false } });
  assert.deepEqual(t.claude, ["--resume"]);
  assert.equal(t.codex, undefined);
  assert.equal(commandFor({ agent: "codex", argv: ["codex"] }, null, t), null);
});

test("entries older than 30 days are pruned", () => {
  const old = { version: 1, entries: { t1: { agent: "claude", argv: ["claude"], cwd: "/w", boot: "B0", seen: NOW - 31 * 24 * 3600_000 } } };
  assert.equal(run(old, [shell("t1")], { boot: "B1" }).state.entries.t1, undefined);
});
