# lnxeasy

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.9-brightgreen.svg)](package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A small web panel for watching an Ubuntu server from the browser instead of the terminal.

It runs on the server as a single Node.js process that serves both the web page and a JSON API.
No external dependencies: only Node.js core modules on the server, plain HTML, CSS and JavaScript in the browser.

> Early stage. The system overview, storage, listening ports and processes are available so far.
> Services and server management are planned.

## Install on a server

```bash
curl -fsSL https://raw.githubusercontent.com/lnxeasy/lnxeasy/main/install.sh | sudo bash
```

If the server answers `sudo: command not found`, you are already root: leave `sudo` out.
You can run the command from any directory.

Root is needed once, to install: the script creates a system user, writes to `/opt`, `/etc` and
`/var/lib`, and registers a systemd service. After that lnxeasy itself runs as the unprivileged
`lnxeasy` user, never as root. [CODE_TOUR.md](CODE_TOUR.md) shows what every step does and where.

The installer needs a Linux server with systemd (x86_64 or aarch64), `curl` and `openssl`.
It does not need Node.js or git: it downloads its own copy of Node.js into `/opt/lnxeasy`.

When it finishes it prints the address, the username and a random password:

```
lnxeasy is running.

    Open:      https://203.0.113.10:4321
    Username:  admin
    Password:  k7qmx-39xtw-wz2pe-ab3cd
```

Open the address in the browser and sign in. The browser warns about the certificate once,
because the installer creates a self-signed one.

If the page keeps loading and never opens, a firewall is blocking TCP port 4321. The installer tells you
when `ufw` or `firewalld` on the server is the cause and prints the command to allow the port.
A firewall in your hosting provider's panel cannot be seen from the server: check it there.

The commands below need root. If you are not root, put `sudo` in front of them.

| Task | Command |
|------|---------|
| Change the password | **Security** in the top bar, or `lnxeasy passwd` |
| Turn on two-step sign-in | **Security** in the top bar |
| Lost the phone | `lnxeasy two-step --disable` |
| Let only your address in | `lnxeasy allow 203.0.113.7` (back to everyone: `lnxeasy allow --any`) |
| Check the certificate | `lnxeasy fingerprint` |
| Status | `systemctl status lnxeasy` |
| Log, including sign-ins | `journalctl -u lnxeasy -f` |
| Settings | edit `/etc/lnxeasy/lnxeasy.env`, then `systemctl restart lnxeasy` |
| Update | run the installer again |
| Uninstall | `curl -fsSL https://raw.githubusercontent.com/lnxeasy/lnxeasy/main/install.sh \| bash -s -- --uninstall` |

### Installer options

```bash
curl -fsSL https://raw.githubusercontent.com/lnxeasy/lnxeasy/main/install.sh | bash -s -- --allow-ip 203.0.113.7
```

| Option | Effect |
|--------|--------|
| `--port NUMBER` | Use this port instead of 4321, for example `--port 443` so the address needs no port. The installer stops before changing anything when the port is taken. |
| `--allow-ip ADDRESS` | Only this address or range can reach the panel. May be repeated. |
| `--cert FILE --key FILE` | Use your own HTTPS certificate, for example one from Let's Encrypt, instead of a self-signed one. |
| `--behind-proxy` | Listen on this machine only, for a web server that adds HTTPS and a domain. See below. |
| `--direct` | Go back from `--behind-proxy` to serving HTTPS directly on the port. |
| `--uninstall` | Remove lnxeasy and everything it created. |

Prefer to read a script before running it as root? Download it first:

```bash
curl -fsSLO https://raw.githubusercontent.com/lnxeasy/lnxeasy/main/install.sh
less install.sh
bash install.sh
```

### A name instead of an IP address

Typing `https://203.0.113.10:4321` every time is not pleasant. Without buying a domain you can give
the server a name that works on your own computer, by adding one line to the computer's `hosts` file.
Use the IP address of your server and any name you like; `lnxeasy.lan` is used here.

**Linux and macOS.** In a terminal on your computer, not on the server:

```bash
echo "203.0.113.10 lnxeasy.lan" | sudo tee -a /etc/hosts
```

The file belongs to the system, so it needs `sudo`. If you prefer an editor, open it with
`sudo nano /etc/hosts`; without `sudo`, nano shows "Permission denied" when you save.

**Windows.** Click Start, type `notepad`, right-click Notepad and choose *Run as administrator*.
Open the file `C:\Windows\System32\drivers\etc\hosts` (choose *All files* in the dialog to see it),
add this line at the end and save:

```
203.0.113.10 lnxeasy.lan
```

Now open `https://lnxeasy.lan:4321`. If the old address still shows up, clear the name cache:
`ipconfig /flushdns` on Windows, `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder` on macOS.

Things to know:

- The name works only on computers where you added the line. For a name that works everywhere you need a real domain.
- The `hosts` file maps a name to an address. It cannot hide the port. To drop `:4321` as well, either run
  lnxeasy on the standard HTTPS port, if nothing else on the server uses it (`--port 443`, then the address is
  just `https://lnxeasy.lan`), or put it behind your web server, described next.
- The browser still warns about the certificate once for the new name, because the certificate is self-signed.
- Do not pick a name that ends in `.local`: that ending is reserved and resolves slowly or not at all on some systems.

### A domain instead of a port

`https://203.0.113.10:4321` works, but `https://panel.example.com` is nicer: no port and no certificate
warning. For that, a web server that already serves HTTPS on the machine (nginx, Caddy) passes the
requests on to lnxeasy.

```bash
curl -fsSL https://raw.githubusercontent.com/lnxeasy/lnxeasy/main/install.sh | bash -s -- --behind-proxy
```

lnxeasy then listens on `http://127.0.0.1:4321` only, and the installer prints the lines to add to
your web server. For nginx, inside a server block that has a certificate for the domain:

```nginx
location / {
    proxy_pass http://127.0.0.1:4321;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

For Caddy, which gets the certificate by itself:

```
panel.example.com {
    reverse_proxy 127.0.0.1:4321
}
```

Both headers matter. `Host` is how lnxeasy tells its own pages from other sites, and
`X-Forwarded-For` is the visitor's address, used for the lockout, the address list and the activity log.
lnxeasy believes that header only from the addresses in `TRUSTED_PROXIES` (the installer sets `127.0.0.1`).
If the web server forgets to send it, the page shows the error `PROXY_HEADER_MISSING` instead of
quietly treating every visitor as one address.

If the web server runs in a container, it reaches the host through another address. Set these in
`/etc/lnxeasy/lnxeasy.env` by hand, with the addresses of your container network:

```
HOST=172.17.0.1
ALLOW_INSECURE_HTTP=yes
TRUSTED_PROXIES=172.16.0.0/12
```

### Process names

The service itself runs without privileges, so on its own it could only see its own processes.
The installer therefore adds a small helper: a separate systemd unit that runs one fixed command
as root, `ss -tulpnH`, and hands the output to lnxeasy over a local socket. It accepts no input.
[CODE_TOUR.md](CODE_TOUR.md) shows both unit files.

### Security

The panel requires a login and HTTPS, supports two-step sign-in, locks out an address after
five failed attempts, can be limited to chosen addresses and runs as an unprivileged user.
[SECURITY.md](SECURITY.md) lists everything it does, what it does not protect against,
and how to report a problem.

Want to check the code yourself before trusting it with a server? [CODE_TOUR.md](CODE_TOUR.md)
walks through every file, says what it does and why, and lists commands that prove the claims.

Recommended after installing:

1. `lnxeasy allow YOUR_IP_ADDRESS`
2. Turn on two-step sign-in under **Security**.
3. On the first visit, compare the certificate fingerprint in the browser with the one the installer printed.

## Run from source

Requires Linux and Node.js 22.9 or newer.

```bash
git clone https://github.com/lnxeasy/lnxeasy.git
cd lnxeasy
cp .env.example .env
npm run passwd    # create the admin account
npm start
```

Open `http://127.0.0.1:4321` and sign in as `admin`. Change `HOST` and `PORT` in `.env`.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Returns `{"data":{"status":"ok"}}` |
| `GET /api/system` | Hostname, IP address, kernel, uptime, CPU, load average, memory and swap |
| `GET /api/ports` | Listening TCP and UDP ports and the processes that hold them |
| `GET /api/disks` | Disks and other file systems with total, used and free space |
| `GET /api/processes` | Every process with its CPU, memory, owner and command, plus CPU use per core |
| `GET /api/process?pid=N` | One process with its parent, children and listening ports |
| `POST /api/auth/login` | Signs in with `{"username", "password", "code"}` and sets the session cookie |
| `POST /api/auth/logout` | Signs out |
| `POST /api/auth/password` | Changes the password with `{"currentPassword", "newPassword"}` |
| `GET /api/auth/session` | The signed-in user and whether two-step sign-in is on |
| `GET /api/auth/events` | Recent sign-ins and failed attempts |
| `POST /api/auth/two-step/setup`, `/enable`, `/disable` | Manage two-step sign-in |

Every endpoint except `/api/health` and `/api/auth/login` requires a session. Requests that change
something (`POST`) must also carry an `Origin` header matching the address of the panel; browsers add it
by themselves, scripts have to set it.

Successful responses look like `{ "data": ... }`, errors like
`{ "error": { "code": "NOT_FOUND", "message": "..." } }`.

## Development

```bash
npm run dev   # restart on file changes
npm test      # run the tests
```

## Contributing

Contributions are welcome: bug reports, ideas, documentation and code.
Read [CONTRIBUTING.md](CONTRIBUTING.md) to get started, or pick an issue labeled
[`good first issue`](https://github.com/lnxeasy/lnxeasy/labels/good%20first%20issue).

## Contributors

Thanks to everyone who has helped build lnxeasy.

<a href="https://github.com/lnxeasy/lnxeasy/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=lnxeasy/lnxeasy" alt="Contributors" />
</a>

## License

[MIT](LICENSE)
