// session-resume: after a reboot, bring back the AI agents that were running.
//
// Herdr's core recreates every terminal (same address, same folder) as a bare
// shell. This mod notes which local terminals run an agent and, after a
// reboot, types the agent's "continue" command into the matching shell.
// Remote machines are left alone: their cores keep running.
//
// State:  <app home>/session-resume.json         (written by this mod)
// Config: <app home>/session-resume.config.json  (optional, see README)

import { View, div } from "gpui-kit";
import { appHome, checking, exec, hc, machines, notify, readTextFile, terminals, writeTextFile } from "herdr";
import { continueTable, reconcile } from "./logic.js";

const STATE_FILE = () => `${appHome()}/session-resume.json`;
const CONFIG_FILE = () => `${appHome()}/session-resume.config.json`;
const DEFAULT_INTERVAL_S = 10;

let bootId = null;
let busy = false;

async function readJson(path) {
  try {
    const raw = await readTextFile(path);
    return { raw, data: raw ? JSON.parse(raw) : null };
  } catch {
    return { raw: null, data: null };
  }
}

// Identifies the current boot of the computer, so a reboot can be told apart
// from a terminal that was simply closed.
async function currentBoot() {
  if (bootId) return bootId;
  try {
    const linux = await readTextFile("/proc/sys/kernel/random/boot_id");
    if (linux) return (bootId = linux.trim());
  } catch {}
  try {
    const r = await exec("sysctl", ["-n", "kern.boottime"]);
    const m = r.stdout.match(/sec = (\d+)/);
    if (r.code === 0 && m) return (bootId = m[1]);
  } catch {}
  return null;
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const { data: config } = await readJson(CONFIG_FILE());
    if (config?.enabled === false) return;
    const boot = await currentBoot();
    if (!boot) return; // Without a boot id we cannot tell a reboot from a closed terminal.

    const local = machines().find((m) => (m.name ?? null) === null);
    const ready = local?.layout === "ready";
    const { raw, data } = await readJson(STATE_FILE());
    const table = continueTable(config);
    const result = reconcile(data, terminals(), { boot, now: Date.now(), table, ready });

    const logs = [];
    const stamp = new Date().toISOString().slice(11, 19);
    if (result.changed) {
      try {
        await writeTextFile(STATE_FILE(), JSON.stringify({ ...result.state, log: data?.log ?? [] }, null, 2) + "\n", raw);
      } catch {
        return; // Stale snapshot: try again on the next tick, before typing anything.
      }
    }

    let resumed = 0;
    for (const item of result.restore) {
      let line;
      try {
        const r = await hc(["send", item.address, item.text]);
        if (r.code === 0) resumed++;
        line = `${stamp} send ${item.address} try ${item.attempt} -> code ${r.code} ${(r.stderr || r.stdout || "").trim().slice(0, 120)}`;
      } catch (error) {
        line = `${stamp} send ${item.address} try ${item.attempt} -> error ${String(error?.message ?? error).slice(0, 120)}`;
      }
      logs.push(line);
    }
    if (logs.length) {
      // Keep the last results in the state file, to see what happened after a reboot.
      for (let i = 0; i < 3; i++) {
        const cur = await readJson(STATE_FILE());
        if (!cur.data) break;
        try {
          await writeTextFile(STATE_FILE(), JSON.stringify({ ...cur.data, log: [...(cur.data.log ?? []), ...logs].slice(-30) }, null, 2) + "\n", cur.raw);
          break;
        } catch {}
      }
    }
    if (resumed && config?.notify !== false) {
      notify({
        title: resumed === 1 ? "Agent resumed" : `${resumed} agents resumed`,
        body: result.restore.map((r) => `${r.address}: ${r.agent}`).join(" · "),
        level: "info",
      });
    }
  } catch (error) {
    console.log(`session-resume: ${error?.message ?? error}`);
  } finally {
    busy = false;
  }
}

export default class SessionResume extends View {
  init(_props, cx) {
    if (checking()) return; // `herdr-app check` runs init for real: no side effects there.
    cx.spawn(async (cx) => {
      const { data: config } = await readJson(CONFIG_FILE());
      const seconds = Math.max(3, Number(config?.interval_seconds) || DEFAULT_INTERVAL_S);
      await tick();
      cx.timer.every(seconds * 1000, () => { tick(); });
    });
  }

  // Nothing to draw: this mod only works in the background.
  render() {
    return div().size_full();
  }
}
