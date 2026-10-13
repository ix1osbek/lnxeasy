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
curl -fsSL https://raw.githubusercontent.com/ix1osbek/lnxeasy/main/install.sh | sudo bash
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
| Change the password | in the browser, or `sudo lnxeasy passwd` |
| Status | `systemctl status lnxeasy` |
| Log | `journalctl -u lnxeasy -f` |
| Settings | edit `/etc/lnxeasy/lnxeasy.env`, then `systemctl restart lnxeasy` |
| Update | run the installer again |
| Uninstall | `curl -fsSL https://raw.githubusercontent.com/ix1osbek/lnxeasy/main/install.sh \| sudo bash -s -- --uninstall` |

### Security

- The page and the API require a login. The password is stored only as an scrypt hash
  in `/var/lib/lnxeasy/auth.json`, readable by the `lnxeasy` user alone.
- Everything is served over HTTPS. The server refuses to listen on a public address without it.
- Five wrong passwords from one address lock that address out for 15 minutes.
- The session cookie is `HttpOnly`, `Secure` and `SameSite=Strict`, and requests that change
  something are rejected when they come from another site.
- The service runs as the unprivileged `lnxeasy` user. Because of that it only sees its own
  processes: ports held by other users are listed without a process name.
- To keep the panel off the internet, set `HOST=127.0.0.1` in the settings file and reach it
  through an SSH tunnel: `ssh -L 4321:127.0.0.1:4321 user@server`.
- To use your own certificate, point `TLS_CERT_FILE` and `TLS_KEY_FILE` in the settings file at it.

## Run from source

Requires Linux and Node.js 22.9 or newer.

```bash
git clone https://github.com/ix1osbek/lnxeasy.git
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
| `POST /api/auth/login` | Signs in with `{"username", "password"}` and sets the session cookie |
| `POST /api/auth/logout` | Signs out |
| `POST /api/auth/password` | Changes the password with `{"currentPassword", "newPassword"}` |

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
[`good first issue`](https://github.com/ix1osbek/lnxeasy/labels/good%20first%20issue).

## Contributors

Thanks to everyone who has helped build lnxeasy.

<a href="https://github.com/ix1osbek/lnxeasy/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ix1osbek/lnxeasy" alt="Contributors" />
</a>

## License

[MIT](LICENSE)
