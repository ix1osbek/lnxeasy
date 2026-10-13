# lnxeasy

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.9-brightgreen.svg)](package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A small web panel for watching an Ubuntu server from the browser instead of the terminal.

It runs on the server as a single Node.js process that serves both the web page and a JSON API.
No external dependencies: only Node.js core modules on the server, plain HTML, CSS and JavaScript in the browser.

> Early stage. The system overview and listening ports are available so far. Disks, processes,
> services and server management are planned.

## Install on a server

```bash
curl -fsSL https://raw.githubusercontent.com/lnxeasy/lnxeasy/main/install.sh | sudo bash
```

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
because the installer creates a self-signed one. If the page does not open, allow TCP port 4321
in the firewall of the server and of your cloud provider.

| Task | Command |
|------|---------|
| Change the password | **Security** in the top bar, or `sudo lnxeasy passwd` |
| Turn on two-step sign-in | **Security** in the top bar |
| Lost the phone | `sudo lnxeasy two-step --disable` |
| Let only your address in | `sudo lnxeasy allow 203.0.113.7` (back to everyone: `sudo lnxeasy allow --any`) |
| Check the certificate | `sudo lnxeasy fingerprint` |
| Status | `systemctl status lnxeasy` |
| Log, including sign-ins | `journalctl -u lnxeasy -f` |
| Settings | edit `/etc/lnxeasy/lnxeasy.env`, then `systemctl restart lnxeasy` |
| Update | run the installer again |
| Uninstall | `curl -fsSL https://raw.githubusercontent.com/lnxeasy/lnxeasy/main/install.sh \| sudo bash -s -- --uninstall` |

### Installer options

```bash
curl -fsSL https://raw.githubusercontent.com/lnxeasy/lnxeasy/main/install.sh | sudo bash -s -- --allow-ip 203.0.113.7
```

| Option | Effect |
|--------|--------|
| `--allow-ip ADDRESS` | Only this address or range can reach the panel. May be repeated. |
| `--cert FILE --key FILE` | Use your own HTTPS certificate, for example one from Let's Encrypt, instead of a self-signed one. |
| `--uninstall` | Remove lnxeasy and everything it created. |

Prefer to read a script before running it as root? Download it first:

```bash
curl -fsSLO https://raw.githubusercontent.com/lnxeasy/lnxeasy/main/install.sh
less install.sh
sudo bash install.sh
```

### Security

The panel requires a login and HTTPS, supports two-step sign-in, locks out an address after
five failed attempts, can be limited to chosen addresses and runs as an unprivileged user.
[SECURITY.md](SECURITY.md) lists everything it does, what it does not protect against,
and how to report a problem.

Recommended after installing:

1. `sudo lnxeasy allow YOUR_IP_ADDRESS`
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
| `POST /api/auth/login` | Signs in with `{"username", "password", "code"}` and sets the session cookie |
| `POST /api/auth/logout` | Signs out |
| `POST /api/auth/password` | Changes the password with `{"currentPassword", "newPassword"}` |
| `GET /api/auth/session` | The signed-in user and whether two-step sign-in is on |
| `GET /api/auth/events` | Recent sign-ins and failed attempts |
| `POST /api/auth/two-step/setup`, `/enable`, `/disable` | Manage two-step sign-in |

Every endpoint except `/api/health` and `/api/auth/login` requires a session.

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
