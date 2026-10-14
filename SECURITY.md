# Security

lnxeasy shows information about a server and is meant to be reachable over the network,
so security problems are taken seriously.

## Reporting a problem

Please do not open a public issue for a security problem.

Report it privately through
[GitHub private vulnerability reporting](https://github.com/lnxeasy/lnxeasy/security/advisories/new).
Include what you found, how to reproduce it and which version or commit you tested.

You will get an answer within a week. Once a fix is released, the problem is described
in the release notes, with credit to you unless you prefer to stay anonymous.

## What lnxeasy does to protect a server

- **Login required.** Every page and endpoint except the login page and `/api/health` needs a session.
- **Passwords are never stored.** Only an scrypt hash with a random salt is kept, in a file
  that the `lnxeasy` user alone can read. Weak and common passwords are rejected.
- **Two-step sign-in.** A time-based code from an authenticator app can be required after the password.
  A code works once, also across restarts. While it is on, the answer never tells whether the password
  alone was right: a wrong password and a wrong code look the same.
- **HTTPS only.** The server refuses to listen on a public address without a certificate.
- **Lockout.** Five failed attempts from one address lock that address out for 15 minutes.
- **Address list.** The panel can be limited to chosen addresses. Everyone else gets no answer at all,
  including other users on the server itself; only the health check that the installer uses is answered locally.
- **Request limits.** Requests per address, open connections, request size and request time are capped.
- **Sessions.** Random 256-bit tokens in a cookie that is `HttpOnly`, `Secure` and `SameSite=Strict`.
  Requests that change something must carry an `Origin` header of this site, and are rejected otherwise.
- **Strict Content Security Policy.** The page loads nothing from other servers and runs no inline scripts.
- **No shell.** Commands are started with fixed arguments. Nothing a visitor sends is passed to a command.
- **No dependencies.** The server uses only Node.js core modules.
- **Unprivileged service.** lnxeasy runs as its own system user, not as root.
- **Privilege separation.** The one thing that needs root, reading the process names behind ports,
  is done by a separate helper that runs a single fixed command and accepts no input.
- **Proxy headers are not trusted by default.** `X-Forwarded-For` is believed only from the addresses
  listed in `TRUSTED_PROXIES`. When a trusted proxy does not send it, lnxeasy refuses the request instead of
  treating every visitor as the same address.
- **Activity log.** Sign-ins, failed attempts and lockouts are written to the system log and shown in the panel.

## Past reviews

| Date | Review | Result |
|------|--------|--------|
| October 2026 | Hands-on test against a local installation: unauthorised access, path traversal, injection, XSS, user enumeration, brute force, flooding, code reuse, cookies | No critical or high findings. Six low and medium findings, all fixed in 0.4.1: password check visible while two-step sign-in was on, writes without an `Origin` header accepted, this machine exempt from the address list, missing proxy header accepted, code reuse possible after a restart, no CSP on API answers. |

## What it does not protect against

- **A compromised server.** Anyone who is root on the server can read the settings and reset the password.
- **A compromised browser or computer.** Malware on the computer you sign in from can use your session.
- **The first visit with a self-signed certificate.** Compare the fingerprint the installer prints with
  the one the browser shows, or install your own certificate with `--cert` and `--key`.
- **Large denial-of-service attacks.** The built-in limits stop simple floods, not a distributed attack.
- **A compromised source.** The installer downloads lnxeasy from GitHub. It checks the files of a release
  against a checksum, which protects against corrupted or swapped downloads, not against someone who
  controls the repository itself.

lnxeasy is a young project and has not had an independent security audit.
[CODE_TOUR.md](CODE_TOUR.md) is written to make reviewing it yourself as easy as possible.
For a server that matters, limit the panel to your own address or keep it behind a VPN.

## Recommended setup

1. Limit who can reach the panel: `lnxeasy allow YOUR_IP_ADDRESS` (as root).
2. Turn on two-step sign-in: **Security** in the top bar.
3. Check the certificate fingerprint on the first visit: `lnxeasy fingerprint` (as root).
4. Update regularly by running the installer again.
