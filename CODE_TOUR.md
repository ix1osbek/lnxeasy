# Code tour

You are about to run lnxeasy on a server, as a service that is reachable over the network.
You should not have to take anyone's word that it is safe. This document shows where everything
is, in the order things happen, so that you can read the code yourself in about half an hour.

The server side is about 2,100 lines of JavaScript with no dependencies, plus one shell script
that installs it. There is no build step: the files in the repository are the files that run.

- [The ten-minute check](#the-ten-minute-check)
- [The map](#the-map)
- [1. What the installer does](#1-what-the-installer-does)
- [2. What happens when the service starts](#2-what-happens-when-the-service-starts)
- [3. The life of one request](#3-the-life-of-one-request)
- [4. Signing in](#4-signing-in)
- [5. Where the data on the page comes from](#5-where-the-data-on-the-page-comes-from)
- [6. Everything lnxeasy writes](#6-everything-lnxeasy-writes)
- [7. Every address the server answers](#7-every-address-the-server-answers)
- [8. The page in the browser](#8-the-page-in-the-browser)
- [9. The `lnxeasy` command](#9-the-lnxeasy-command)
- [What this tour does not prove](#what-this-tour-does-not-prove)

## The ten-minute check

Clone the repository and run these from its root. Each command checks one claim.
The expected result is written under it.

**It starts exactly two other programs, both with fixed arguments.**

```bash
grep -rn "child_process" server.js cli.js src
grep -rnE "\brun\(" server.js cli.js src | grep -v "export function"
```

```
src/core/exec.js:1:import {execFile} from 'node:child_process'
src/modules/ports/ports.service.js:9:        const result = await this.run('ss' , ['-tulpnH'])
cli.js:70:        await run('systemctl', ['restart', service])
```

One file may start programs. It is used twice: `ss -tulpnH` to list ports, and
`systemctl restart lnxeasy.service` from the command line tool. `execFile` does not use a shell,
and nothing a visitor sends is part of either command.

**It never connects out to anything.**

```bash
grep -rnE "fetch\(|http\.request|https\.request|http\.get|https\.get|net\.connect|createConnection|dgram|WebSocket" server.js cli.js src
```

No output. The server only answers requests. It does not call home, check for updates or send statistics.

**It never runs text as code.**

```bash
grep -rnE "\beval\(|new Function|vm\." server.js cli.js src public
```

No output.

**It has no dependencies.**

```bash
grep -n "ependencies" package.json
ls node_modules 2>/dev/null
```

No output from either. Every `import` in the code is a Node.js built-in (`node:...`) or a file in this repository:

```bash
grep -rhE "from '" server.js cli.js src | grep -vE "from '(node:|\./|\.\./)"
```

No output.

**It writes two files, and nothing else.**

```bash
grep -rnE "writeFile|rename\(|chmod\(|chown\(|mkdir\(|unlink|\brm\(" server.js cli.js src
```

```
src/auth/store.js:63-75    the admin account file
cli.js:160                 the settings file, when you run "lnxeasy allow"
```

**The page never turns text from the server into HTML.**

```bash
grep -rn "innerHTML\|outerHTML\|insertAdjacentHTML\|document.write" public
```

No output. Process names and addresses are put on the page with `textContent` only.

**The tests pass.**

```bash
npm test
```

## The map

```
install.sh              The installer. The only part that runs as root.
server.js               Start here. Builds every object and starts listening. 113 lines.
cli.js                  The "lnxeasy" command: password, two-step, address list.

src/
  config.js             Reads the settings from environment variables.

  core/
    errors.js           The error types, each with an HTTP status and a code.
    exec.js             The one place that starts another program.

  http/                 Knows about requests and responses, nothing about Linux.
    app.js              Every request enters here. Decides: limit, login, page or API.
    address.js          The address list ("only these IPs may connect").
    rate.js             Requests per address per minute.
    router.js           Method + path -> handler.
    static.js           Serves the files in public/ and nothing outside it.
    body.js             Reads a JSON request body, with a size limit.
    cookies.js          Reads and builds the session cookie.
    response.js         The two response shapes: {data} and {error}.

  auth/                 Login.
    guard.js            Which paths are public, who is signed in, cross-site check.
    auth.service.js     Login, logout, password change, two-step, activity trail.
    password.js         scrypt hashing, password rules, password generator.
    totp.js             Two-step codes (RFC 6238).
    sessions.js         Session tokens, in memory.
    limiter.js          Lockout after failed attempts.
    store.js            Reads and writes the admin account file.
    auth.routes.js      The /api/auth/... endpoints.

  modules/              One folder per feature. Knows about Linux, nothing about HTTP.
    index.js            The list of modules.
    system/             Uptime, CPU, memory: reads /proc and node:os.
    ports/              Listening ports: runs ss and parses its output.

public/                 The page: plain HTML, CSS and JavaScript.
tests/                  164 tests, run with "npm test".
```

Imports go one way: `http/` and `auth/` may use `core/`, `modules/` may use `core/`,
and `core/` uses nothing. Only `server.js` knows about all of them.

## 1. What the installer does

File: [`install.sh`](install.sh). Read `install_lnxeasy` near the end first: it is the list of steps,
in order. Each step is one function.

| Step | Function | What it does |
|------|----------|--------------|
| 1 | `require_root`, `check_system`, `check_systemd` | Stops if it is not root, not Linux, or `curl`, `tar`, `sha256sum`, `openssl` or systemd is missing. |
| 2 | `download_node` | Downloads Node.js from `nodejs.org`, checks its SHA-256 against the list published there, unpacks it into `/opt/lnxeasy/node`. |
| 3 | `download_app` | Downloads lnxeasy from GitHub into `/opt/lnxeasy/app`. For a release, compares a checksum of every file with the one written in the script (`hash_tree`) and installs nothing if they differ. |
| 4 | `create_user` | Creates the `lnxeasy` system user: no password, no shell, no home directory. |
| 5 | `create_state_directory` | Creates `/var/lib/lnxeasy`, readable by that user only. |
| 6 | `write_config` | Writes `/etc/lnxeasy/lnxeasy.env`. Keeps the file if it already exists and only adds missing lines. |
| 7 | `create_certificate` | Creates a self-signed certificate with `openssl`, or copies yours if you passed `--cert` and `--key`. The key is readable by root and the `lnxeasy` group only. |
| 8 | `write_command` | Writes `/usr/local/bin/lnxeasy`, a four-line wrapper that loads the settings and runs `cli.js`. |
| 9 | `create_account` | On the first install only: generates a random password, stores its hash, keeps the password in a variable to print at the end. |
| 10 | `write_unit` | Writes the systemd unit. It runs the service as `lnxeasy` with `NoNewPrivileges`, a read-only file system (`ProtectSystem=strict`), no access to `/home`, and a private `/tmp`. |
| 11 | `start_service` | `systemctl enable` and `restart`. |
| 12 | `print_summary` | Waits until the service answers, then prints the address, the password and the certificate fingerprint. |

Everything it creates:

| Path | What |
|------|------|
| `/opt/lnxeasy/node` | Node.js |
| `/opt/lnxeasy/app` | lnxeasy |
| `/etc/lnxeasy/lnxeasy.env` | Settings |
| `/etc/lnxeasy/tls/` | Certificate and key |
| `/var/lib/lnxeasy/auth.json` | The admin account: username, password hash, two-step secret |
| `/etc/systemd/system/lnxeasy.service` | The service |
| `/usr/local/bin/lnxeasy` | The command |
| user `lnxeasy` | The account the service runs as |

`uninstall_lnxeasy` removes exactly this list.

What the installer does not do: it does not change the firewall, does not touch SSH, does not install
packages with `apt` or any other package manager, does not add anything to cron, and does not edit
files outside the table above.

## 2. What happens when the service starts

File: [`server.js`](server.js). It runs top to bottom, once.

1. **Read the settings** with `loadConfig` ([`src/config.js`](src/config.js)): `HOST`, `PORT`,
   `AUTH_FILE`, `TLS_CERT_FILE`, `TLS_KEY_FILE`, `ALLOWED_IPS`. This is the only place that reads
   environment variables.
2. **Refuse to start unsafely.** If the address is public and there is no certificate, it prints why
   and exits. If there is no admin account, it prints how to create one and exits.
3. **Build the login parts**: account file, session store, login limiter, auth service, access guard.
4. **Register the endpoints**: health, auth, then the modules.
5. **Create the HTTPS server** and set its limits: 200 connections, 10 seconds for headers,
   30 seconds for a request.
6. **Listen.** On every new connection, before any data is read, the address filter runs
   (`server.on('connection', ...)`): an address that is not on your list is disconnected without an answer.

## 3. The life of one request

Every request goes through `App.handle` in [`src/http/app.js`](src/http/app.js). The whole method is 20 lines.
The order of the checks is the order below.

| # | Check | File | If it fails |
|---|-------|------|-------------|
| 1 | Is this address on the list? (at connection time) | [`src/http/address.js`](src/http/address.js) | Connection closed, no answer |
| 2 | Fewer than 300 requests this minute from this address? | [`src/http/rate.js`](src/http/rate.js) | 429 |
| 3 | Does a request that changes something come from this site? | `checkOrigin` in [`src/auth/guard.js`](src/auth/guard.js) | 403 |
| 4 | Is the path public, or is there a valid session? | `isPublic`, `isAuthenticated` in [`src/auth/guard.js`](src/auth/guard.js) | 401 for the API, redirect to `/login` for pages |
| 5 | Is there a handler for this method and path? | [`src/http/router.js`](src/http/router.js) | 404 |
| 6 | Run the handler | a `*.routes.js` file | Any error is caught in step 7 |
| 7 | Turn the result or the error into JSON | [`src/http/response.js`](src/http/response.js) | An unexpected error becomes "Internal server error"; the details go to the log only |

Step 4 comes before step 5 on purpose: without a session every API path answers 401, whether it exists or not.

The public paths are a fixed list of seven at the top of [`src/auth/guard.js`](src/auth/guard.js):
the login page (under two names), its script, the style sheet, the icon, `/api/health` and `/api/auth/login`.

A path that does not start with `/api/` is a file request and goes to
[`src/http/static.js`](src/http/static.js). `resolveFilePath` is the part to read: it decodes the path,
joins it to the `public` directory, and rejects the result unless it is still inside that directory.
Only six file types are served. Every file is sent with a Content Security Policy that allows
scripts, styles and requests from this server only.

## 4. Signing in

Start at `login` in [`src/auth/auth.service.js`](src/auth/auth.service.js). It reads like the list below.

1. **Is this address locked out?** [`src/auth/limiter.js`](src/auth/limiter.js): five failures in
   15 minutes lock the address for 15 minutes.
2. **Check the password.** [`src/auth/password.js`](src/auth/password.js): the password is run through
   scrypt with the stored salt and compared with the stored hash in constant time. At most four checks
   run at once, so a flood of login attempts cannot use all the CPU.
3. **Check the username** in constant time too. A wrong username and a wrong password give the same answer.
4. **Check the two-step code**, if it is turned on. [`src/auth/totp.js`](src/auth/totp.js) is the standard
   algorithm (RFC 6238) in 87 lines; the tests check it against the values published in the RFC.
   A code that was already used is refused.
5. **Create a session.** [`src/auth/sessions.js`](src/auth/sessions.js): 32 random bytes from the
   operating system. Sessions live in memory for 24 hours and are gone when the service restarts.
6. **Send the cookie.** [`src/http/cookies.js`](src/http/cookies.js): `HttpOnly` (scripts cannot read it),
   `Secure` (HTTPS only), `SameSite=Strict` (other sites cannot send it).
7. **Write it down.** `record` adds the event and the address to the activity trail and the system log.
   Passwords and usernames that were tried are never logged.

The account file is read and written only by [`src/auth/store.js`](src/auth/store.js). It holds the
username, the salt, the hash and the two-step secret. The password itself is not stored anywhere.

There is one account. There is no "forgot password" link, no default password and no second way in:
the only other way to change the password is the `lnxeasy passwd` command on the server, as root.

## 5. Where the data on the page comes from

| What you see | Source | File |
|--------------|--------|------|
| Hostname, address, kernel, uptime, CPU | Node.js `os` module | [`src/modules/system/system.service.js`](src/modules/system/system.service.js) |
| Load average | reads `/proc/loadavg` | same |
| Memory and swap | reads `/proc/meminfo` | same |
| Listening ports and processes | runs `ss -tulpnH` | [`src/modules/ports/ports.service.js`](src/modules/ports/ports.service.js) |

That is the complete list. Nothing else on the server is read: no files in `/home`, no logs,
no other configuration. The two `*.parser.js` files only turn text into objects.

lnxeasy is read-only today. No endpoint stops, starts or changes anything on the server.

## 6. Everything lnxeasy writes

| File | Written by | When |
|------|-----------|------|
| `/var/lib/lnxeasy/auth.json` | [`src/auth/store.js`](src/auth/store.js) | Password change, two-step on or off |
| `/etc/lnxeasy/lnxeasy.env` | [`cli.js`](cli.js), `writeAllowedAddresses` | Only when you run `lnxeasy allow` |
| The system log | `console.log`, `console.error` | Start-up line, sign-in events, unexpected errors |

The service could not write elsewhere even if the code tried: the systemd unit makes the file system
read-only for it, except for `/var/lib/lnxeasy`.

## 7. Every address the server answers

| Path | Login needed | Registered in |
|------|--------------|---------------|
| `GET /api/health` | no | [`server.js`](server.js) |
| `POST /api/auth/login` | no | [`src/auth/auth.routes.js`](src/auth/auth.routes.js) |
| `POST /api/auth/logout` | yes | same |
| `POST /api/auth/password` | yes, and the current password | same |
| `GET /api/auth/session` | yes | same |
| `GET /api/auth/events` | yes | same |
| `POST /api/auth/two-step/setup` | yes, and the current password | same |
| `POST /api/auth/two-step/enable` | yes | same |
| `POST /api/auth/two-step/disable` | yes, and the current password | same |
| `GET /api/system` | yes | [`src/modules/system/system.routes.js`](src/modules/system/system.routes.js) |
| `GET /api/ports` | yes | [`src/modules/ports/ports.routes.js`](src/modules/ports/ports.routes.js) |
| files in `public/` | yes, except the login page and its assets | [`src/http/static.js`](src/http/static.js) |

To confirm that the list is complete:

```bash
grep -rnE "router\.(get|post)\(" server.js src
```

It prints eleven lines, the eleven endpoints above.

## 8. The page in the browser

| File | What |
|------|------|
| [`public/login.html`](public/login.html), [`public/login.js`](public/login.js) | The sign-in form. Sends the form to `/api/auth/login` and nothing else. |
| [`public/index.html`](public/index.html) | The dashboard markup. |
| [`public/app.js`](public/app.js) | Fetches `/api/system` and `/api/ports` every five seconds and draws them. |
| [`public/styles.css`](public/styles.css) | The look. |

The page loads no fonts, scripts, images or styles from other servers, and the Content Security
Policy sent by `static.js` would block them if it tried. The only thing it stores in the browser is
whether you chose to hide the server address (`localStorage`, one key).

## 9. The `lnxeasy` command

File: [`cli.js`](cli.js). `main` at the bottom lists every command it accepts:
`passwd`, `passwd --generate`, `two-step --disable`, `allow`, `allowed`, `fingerprint`.
Anything else prints the usage text.

It needs root because the files it touches belong to root or to the `lnxeasy` user.
That is also what makes it safe as the recovery path: whoever can run it already controls the server.

## What this tour does not prove

Reading the code shows that it does what it says. It does not show that it has no mistakes.
lnxeasy is a young project and has not had an independent security audit.
[SECURITY.md](SECURITY.md) lists what it protects against, what it does not, and how to report a problem.

Two things are outside this repository and worth knowing:

- **Node.js itself** is downloaded from `nodejs.org` by the installer. Its checksum is verified against
  the list on the same site.
- **The installer is downloaded from GitHub.** To run exactly what you reviewed, download `install.sh`,
  read it, and run that copy instead of piping it from the network.
