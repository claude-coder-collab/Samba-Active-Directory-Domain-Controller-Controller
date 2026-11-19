# Specification

## Purpose
Desktop GUI that manages users, groups and password policy of a Samba 4 AD DC by running `samba-tool` over a single SSH connection. No server-side component.

## Architecture
- `src/core/` — platform-neutral TypeScript, no Electron imports.
  - `shell.ts`: `shellQuote`/`shellJoin`. Every remote command is built as an argv array and POSIX-quoted (safe words unquoted, otherwise single-quoted with `'\''` escaping; NUL rejected). No string interpolation into commands anywhere.
  - `validate.ts`: account/group names (ASCII 0x20–0x7A, none of `` `~!@#$%,^&*(){}[]'|\:;"<>?/=+ ``, no leading/trailing space); person names (any text without control chars or surrounding spaces; given name/surname optional); passwords (non-empty, no control chars); hosts (IPv4, IPv6, DNS name); `parseHostPort` (`host`, `host:port`, `[v6]:port`, default 22) and `formatHostPort` (omits `:22`).
  - `parse.ts`: parsers for `domain info` (`key : value`, split on first colon), `domain passwordsettings show` (skip header line, split on last colon, map label→set option), `user show` LDIF (unfold lines beginning with a space, repeated keys become arrays, `::` values base64-decoded, `#` lines ignored), DN helpers, and `summariseSambaError` (complexity failure → friendly message; else first line containing `ERROR`; else all stderr; else fallback).
  - `flags.ts`: userAccountControl bit table and decoder.
  - `builtins.ts`: provisioned group names and `krbtgt`, hidden from the UI.
  - `samba.ts`: `SambaTool` over an `Executor { exec(cmd) → {stdout, stderr, code} }`. A command fails iff exit code ≠ 0 (stderr warnings with exit 0 are success). Per-user `user show` and per-group `listmembers` run with concurrency 4 (`mapLimit`, order preserved). Results sorted by name. Bulk user operations run sequentially, continue past failures and throw one `SambaError` listing `name: message` per failure.
  - `forms.ts`: add-user row conversion (blank rows ignored; a row with any field but missing username or password is an error), policy diff (only edited, settable, trimmed values), RFC 4180 CSV parser, CSV→rows (header aliases or fixed order username, givenName, surname, password, mustChange; mustChange blank → true).
  - `api.ts`: IPC contract (`SdccApi`, `apiMethods`), `Result<T>` (`{ok,value}|{ok:false,error}`), preferences shape and normalisation.
- `src/main/` — Electron main process.
  - `ssh.ts`: `SshExecutor` on `ssh2`. Auth attempts in order: password, keyboard-interactive (answers every prompt with the password) — both only when a password is given — then SSH agent (`SSH_AUTH_SOCK`, or the OpenSSH named pipe on Windows), then `~/.ssh/id_ed25519`, `id_ecdsa`, `id_rsa` if they parse without a passphrase. No methods → immediate error. Host key fingerprint `SHA256:<base64 of sha256(wire key), no padding>` passed to a verifier. readyTimeout 15 s, keepalive 30 s. Errors mapped to friendly messages.
  - `session.ts`: `Session` holds one connection. Known hosts are keyed by `formatHostPort`. Unknown key → ask user, remember only on accept; mismatched key → show error, refuse. Preferences are saved after a successful connection only. `autoConnect` connects with empty password using saved host/user when enabled. `snapshot` fetches domain info (`domain info <host>`), policy, users and groups in parallel.
  - `prefs.ts`: JSON at `<userData>/prefs.json` (`host`, `username` default `root`, `autoConnect`, `knownHosts`), written atomically with mode 0600. `SDCC_USER_DATA` env var overrides userData.
  - `main.ts`: one window; `contextIsolation`, `sandbox`, no node integration, navigation and new windows blocked; strict CSP in the page. One `ipcMain.handle` per `apiMethods` entry, every handler returns `Result`. Menu: Connection → Refresh (Cmd/Ctrl+R), Disconnect, Don't Connect Automatically; sent to renderer as `menu` events.
- `src/preload/preload.ts`: exposes `window.sdcc` with an `invoke` wrapper per API method plus `onMenu`.
- `src/renderer/`: vanilla TS + HTML/CSS, light/dark.
  - Startup: try auto-connect; on failure show connect form with error. Connect form prefilled from prefs; password cleared only after successful connect.
  - Main view: header (domain, base DN, Refresh, Disconnect); column 1 domain info + editable policy (read-only for unknown labels; submit sends only changes then reloads); column 2 filterable users table (login, given name, surname, Enabled/Disabled, flags excluding NORMAL_ACCOUNT/ACCOUNTDISABLE; disabled struck through; click / Ctrl-⌘ toggle / Shift range); column 3 groups tree (groups with member children, Ctrl-⌘ multi-select, double-click collapse).
  - Actions: Add users (dialog, 10 rows, Add row, Import CSV appends to filled rows; invalid input reopens dialog with data); Enable/Disable; Delete (confirmation); Change password (exactly one user, confirm field, must-change option); Add group (prompt); Remove group (exactly one group, confirmation); Add selected users to the single selected group; Remove selected members (members only, grouped per group). After each action the affected data is reloaded. A busy overlay covers every call; errors go to a modal.

## samba-tool commands used
`domain info <host>`, `domain passwordsettings show|set --<opt>=<v>…`, `user list|show|create <u> <pw> --given-name= --surname= [--must-change-at-next-login]|delete|enable|disable|setpassword <u> --newpassword= [--must-change-at-next-login]`, `group list|listmembers|add|delete|addmembers <g> <a,b>|removemembers <g> <a,b>`; core also supports `ou list|create`, `computer list`.

Policy labels → options: Password complexity→complexity, Store plaintext passwords→store-plaintext, Password history length→history-length, Minimum password length→min-pwd-length, Minimum/Maximum password age (days)→min-/max-pwd-age, Account lockout duration (mins)→account-lockout-duration, Account lockout threshold (attempts)→account-lockout-threshold, Reset account lockout after (mins)→reset-account-lockout-after. Values must be alphanumeric.

## Build and test
esbuild bundles main (CJS, ssh2 inlined, native optional deps external), preload (CJS) and renderer (IIFE) into `dist/`. electron-builder packages `dist/` (mac dmg, win nsis, linux AppImage). Vitest: unit tests for core/session with a fake executor; integration tests run `SshExecutor` against `test/fake-dc` (ssh2 server emulating the commands above with in-memory state). `npm run e2e` drives the built app via Playwright against the fake DC.
