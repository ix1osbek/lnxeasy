# Ubuntu CLI UI

A small web panel for watching an Ubuntu server from the browser instead of the terminal.

It runs on the server as a single Node.js process and exposes a JSON API with system
information. No external dependencies: only Node.js core modules.

> Early stage. Only the system overview is available so far. Ports, disks, processes,
> services and a browser UI are planned.

## Requirements

- Linux
- Node.js 22.9 or newer

## Run

```bash
cp .env.example .env
npm start
```

The server listens on `http://127.0.0.1:4321` by default. Change `HOST` and `PORT` in `.env`.

There is no authentication yet, so keep it on `127.0.0.1` and reach a remote server
through an SSH tunnel:

```bash
ssh -L 4321:127.0.0.1:4321 user@server
```

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Returns `{"data":{"status":"ok"}}` |
| `GET /api/system` | Hostname, kernel, uptime, CPU, load average, memory and swap |

Successful responses look like `{ "data": ... }`, errors like
`{ "error": { "code": "NOT_FOUND", "message": "..." } }`.

## Development

```bash
npm run dev   # restart on file changes
npm test      # run the tests
```

## License

[MIT](LICENSE)
