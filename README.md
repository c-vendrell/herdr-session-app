# herdr-session-app

A small mod for the [Herdr](https://herdr.dev) desktop app that **brings your AI agents back after a reboot**.

Herdr's core recreates your spaces, tabs and terminals after a restart, but every
terminal comes back as a bare shell: Claude Code, opencode, Codex, … are gone and you
reopen them by hand. This mod remembers which local terminals were running an agent
and, after a reboot, types the agent's "continue" command into the matching shell.

> Not affiliated with Herdr. Tested with the Herdr app `0.1.17` on macOS.

## How it works

- Every 10 seconds the mod looks at your **local** terminals and notes which ones run a
  known agent in the foreground (`<app home>/session-resume.json`).
- If you close the agent yourself, or the terminal, the note is deleted. Only a
  *reboot* keeps it, so what you close stays closed.
- After a reboot the core gives you the same terminals back as shells. The mod sees a
  note from an earlier boot, waits until the shell has settled, and types, for example,
  `claude '--continue'` there. It retries up to 3 times, 12 s apart, if the agent does not
  start. What `hc send` answered is kept in the `log` field of `session-resume.json`.
- Remote machines are not touched: their cores keep running on their own.

| Agent | Command typed |
|---|---|
| Claude Code | `claude --continue` |
| opencode | `opencode --continue` |
| Codex | `codex resume --last` |
| Pi | `pi --continue` |

## Install

Requires the Herdr app and `python3`.

```sh
git clone https://github.com/c-vendrell/herdr-session-app.git
cd herdr-session-app
./install.sh
```

Herdr only runs a mod that a layout shows, and its shipped layouts are read-only. So the
installer copies the mod and creates a **personal layout** (`main-resume`): a copy of
`main` plus a 1 px block that hosts the mod, then switches the window to it.
Your files are backed up first under `<app home>/backups/`.

Options: `--base NAME` (layout to copy, default `main`), `--name NAME`, `--no-switch`,
`--app-home PATH`.

If you already use your own layout, add this block to it instead of using `--base`:

```json
{ "id": "session-resume-host", "type": "block", "size": { "px": 1 },
  "content": { "mod": "session-resume" } }
```

The mod only runs while the window shows a layout that contains that block.

## Configure (optional)

Create `<app home>/session-resume.config.json`:

```json
{
  "enabled": true,
  "notify": true,
  "interval_seconds": 10,
  "continue": {
    "claude": ["--continue"],
    "codex": false,
    "myagent": ["--resume"]
  }
}
```

- `enabled: false` turns it off without uninstalling.
- `continue` maps an agent's program name to the arguments that continue its last
  session. `false` disables that agent. Any program name works.

## Limits

- It resumes the **last session of that folder** (`--continue`), not an exact session.
  Two agents of the same kind in the same folder may be mixed up.
- Only the program name is kept. Extra flags you started it with (a model, a prompt) are
  not repeated; add them in `continue` if you want them.
- It needs the Herdr app open on a layout that hosts the mod. It does not start
  anything before the app opens.
- Claude Code asks "do you trust this folder?" every time it starts in your **home folder**
  (its answer is not remembered there). Use a project folder, or accept it by hand.
- It types into your terminals. Use `enabled: false` if you ever want it to stop.

## Uninstall

```sh
./uninstall.sh          # removes the mod and the layout, keeps the saved state
./uninstall.sh --purge  # also removes the saved state and the config
```

## Develop

The logic lives in `mods/session-resume/logic.js` with no dependencies:

```sh
node --test test/
herdr-app check mods/session-resume
```

## Contributing

Issues are welcome (bug reports, agents you would like supported, ideas). Pull requests
are not being accepted for now.

## License

MIT, see [LICENSE](LICENSE).
