# Decisions

## 2026-11-18 — TypeScript/Electron port (2.0.0)
- **Replaced the Python code** rather than keeping both; the original was ~2k lines and had no tests.
- **Argv + POSIX quoting instead of string-built commands.** The original wrapped values in double quotes, so passwords or names containing `"`, `$` or backticks broke commands or executed on the server.
- **Exit code, not stderr, decides failure.** samba-tool prints deprecation warnings to stderr on success.
- **Host key trust-on-first-use** stored in app prefs, replacing paramiko's AutoAddPolicy (which accepted any key). OpenSSH `known_hosts` is not read, to avoid parsing hashed/wildcard entries.
- **Relaxed person-name validation** to allow non-ASCII (e.g. García) now that quoting is safe; account/group names keep the original's conservative ASCII rule.
- **Bug fixes carried in the port:** policy option `reset-account-lockout` → `reset-account-lockout-after`; `ou create` referenced an undefined attribute; `user show` lines with extra `: ` crashed parsing; group members were passed as `"a, b"` instead of `a,b`.
- **Surname/given name optional** when adding users (original silently skipped rows with any empty field).
- **Added:** confirmations on delete, CSV import (was a stub), must-change-at-next-login on password reset, `host:port`, user filter, keyboard-interactive auth.
- **Passwords still appear on the remote command line** (visible in `ps` on the DC briefly), as in the original; samba-tool's interactive prompt needs a TTY.
- **No real DC in CI:** a fake ssh2 server emulating samba-tool is used for integration and UI tests; behaviour against real Samba needs manual QA.
- **Vanilla TS renderer, esbuild** — small UI, no framework needed.
