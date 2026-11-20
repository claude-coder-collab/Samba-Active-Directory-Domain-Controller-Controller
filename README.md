# Samba Active Directory Domain Controller Controller

A simple desktop app for managing a Samba 4 Active Directory domain controller over SSH, using the official [`samba-tool`](https://wiki.samba.org/index.php/User_and_Group_management). Nothing needs to be installed on the server.

TypeScript/Electron port of [AdamVenn/Samba-Active-Directory-Domain-Controller-Controller](https://github.com/AdamVenn/Samba-Active-Directory-Domain-Controller-Controller).

### What it does
- View and edit the domain password policy
- View, add, delete, enable and disable users, with days left until each password expires
- Reset user passwords (optionally forcing a change at next login)
- View, add and remove non-built-in groups
- Add users to and remove users from groups

### Requirements
- A Samba AD DC reachable over SSH, with a login that can run `samba-tool` (normally `root`)
- To build from source: Node.js 22+

### Usage
```sh
npm ci
npm start
```
Enter the DC's address (append `:port` for non-standard SSH ports), user and password. On first connection you are asked to confirm the server's host key fingerprint; it is then remembered and a changed key is refused.

Multi-select users and group members with Ctrl/⌘-click (Shift-click for a range of users). Double-click a group to collapse it.

### Building packages
```sh
npm run dist        # dmg / nsis installer / AppImage for the current OS, in release/
```
Pushing a `v*` tag builds all three on GitHub Actions and attaches them to a draft release.

### Development
```sh
npm run check       # typecheck, lint, unit + SSH integration tests
npm run fake-dc     # local fake DC on 127.0.0.1:2222 (root / secret) to try the app against
npm run e2e         # drives the real app against the fake DC with Playwright
```

### License
GPL-3.0, as the original.
