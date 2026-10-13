# lnxeasy

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.9-brightgreen.svg)](package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A small web panel for watching an Ubuntu server from the browser instead of the terminal.

It runs on the server as a single Node.js process that serves both the web page and a JSON API.
No external dependencies: only Node.js core modules on the server, plain HTML, CSS and JavaScript in the browser.

> Early stage. The system overview and listening ports are available so far. Disks, processes,
> services, login and server management are planned.

## Install on a server

```bash
curl -fsSL https://raw.githubusercontent.com/ix1osbek/lnxeasy/main/install.sh | sudo bash
```

The installer needs a Linux server with systemd (x86_64 or aarch64). It does not need Node.js or git:
it downloads its own copy of Node.js into `/opt/lnxeasy`, creates a `lnxeasy` system user and
starts a systemd service.

There is no login yet, so the service listens on `127.0.0.1` only. Open it from your computer
through an SSH tunnel:

```bash
ssh -L 4321:127.0.0.1:4321 user@server
```

and then open `http://127.0.0.1:4321`.

| Task | Command |
|------|---------|
| Status | `systemctl status lnxeasy` |
| Log | `journalctl -u lnxeasy -f` |
| Settings | edit `/etc/lnxeasy/lnxeasy.env`, then `systemctl restart lnxeasy` |
| Update | run the installer again |
| Uninstall | `curl -fsSL https://raw.githubusercontent.com/ix1osbek/lnxeasy/main/install.sh \| sudo bash -s -- --uninstall` |

The service runs as an unprivileged user, so it only sees the processes of that user.
Ports held by other users are listed without a process name.

## Run from source

Requires Linux and Node.js 22.9 or newer.

```bash
git clone https://github.com/ix1osbek/lnxeasy.git
cd lnxeasy
cp .env.example .env
npm start
```

Open `http://127.0.0.1:4321` in the browser. Change `HOST` and `PORT` in `.env`.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Returns `{"data":{"status":"ok"}}` |
| `GET /api/system` | Hostname, IP address, kernel, uptime, CPU, load average, memory and swap |
| `GET /api/ports` | Listening TCP and UDP ports and the processes that hold them |

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
[`good first issue`](https://github.com/ix1osbek/lnxeasy/labels/good%20first%20issue).

## Contributors

Thanks to everyone who has helped build lnxeasy.

<a href="https://github.com/ix1osbek/lnxeasy/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ix1osbek/lnxeasy" alt="Contributors" />
</a>

## License

[MIT](LICENSE)
