# Decisions

## 2026-11-18 — TypeScript/Electron port (2.0.0)
- **Replaced the Python code** rather than keeping both; the original was ~2k lines and had no tests.
- **Argv + POSIX quoting instead of string-built commands.** The original wrapped values in double quotes, so passwords or names containing `"`, `$` or backticks broke commands or executed on the server.
- **Exit code, not stderr, decides failure.** samba-tool prints deprecation warnings to stderr on success.
- **Host key trust-on-first-use** stored in app prefs, replacing paramiko's AutoAddPolicy (which accepted any key). OpenSSH `known_hosts` is not read, to avoid parsing hashed/wildcard entries.
- **Relaxed person-name validation** to allow non-ASCII (e.g. García) now that quoting is safe; account/group names keep the original's conservative ASCII rule.
- **Bug fixes carried in the port:** policy option `reset-account-lockout` → `reset-account-lockout-after`; `ou create` referenced an undefined attribute; `user show` lines with extra `: ` crashed parsing; group members were passed as `"a, b"` instead of `a,b`.
- **Surname/given name optional** when adding users (original silently skipped rows with any empty field).
- **Added:** confirmations on delete, must-change-at-next-login on password reset, `host:port`, user filter, keyboard-interactive auth.
- **Passwords still appear on the remote command line** (visible in `ps` on the DC briefly), as in the original; samba-tool's interactive prompt needs a TTY.
- **No real DC in CI:** a fake ssh2 server emulating samba-tool is used for integration and UI tests; behaviour against real Samba needs manual QA.
- **Vanilla TS renderer, esbuild** — small UI, no framework needed.

## 2026-11-19 — Trimmed scope
- **Removed CSV import** at the user's request (the original only had a stub button).
- **Removed SSH key and agent authentication**; login is password-only. Auto-connect depended on passwordless login, so it was removed too, along with its menu item and preference.

## 2026-11-19 — Password expiry column
- **Use Samba's constructed `msDS-UserPasswordExpiryTimeComputed`** rather than computing `pwdLastSet` + the domain "Maximum password age": Samba's value also accounts for fine-grained password policies (PSOs), never-expire flags and must-change-at-next-login. It is requested in the existing `user show` call, so no extra round trips. Requires Samba ≥ 4.9; older DCs show "—".
- **Days are rounded down** (whole days remaining); under 24 h shows "Today". Computed with the client's clock.
- **Warning threshold 14 days**, fixed.
- **minimatch override** (2026-11-20): `npm audit` flags minimatch 9/10 (GHSA-g3hv-75wg-m249) inside electron-builder, with no fixed stable release; `npm audit fix --force` downgrades electron-builder to a worse version. `overrides` lifts only minimatch `>=7 <11.0.1` to `^11.0.1` (v3/v5 copies use a different API and are untouched). Build-time only. Remove once electron-builder updates.
