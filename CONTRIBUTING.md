# Contributing to lnxeasy

Thanks for taking the time to help. Bug reports, ideas, documentation fixes and code are all welcome.

## Ways to contribute

- **Report a bug.** Open an issue with the bug report form.
- **Suggest a feature.** Open an issue with the feature request form before writing code,
  so we can agree on the approach first.
- **Pick an issue.** Issues labeled [`good first issue`](https://github.com/ix1osbek/lnxeasy/labels/good%20first%20issue)
  are small and well described. Leave a comment on the issue so nobody else starts the same work.
- **Improve the docs.** Typos and unclear sentences are worth a pull request too.

## Getting started

You need Linux and Node.js 22.9 or newer. There is nothing to install: the project has no dependencies.

```bash
git clone https://github.com/<your-username>/lnxeasy.git
cd lnxeasy
cp .env.example .env
npm run passwd # create the admin account (once)
npm run dev    # start the server, restart on file changes
npm test       # run the tests
```

Then open `http://127.0.0.1:4321`.

## Project layout

```
server.js            Wires everything together: config, router, modules, app, listen
cli.js               The `lnxeasy` command: sets the admin password
install.sh           Installer for servers: Node.js, systemd service, certificate, admin account
src/
  config.js          Reads settings from the environment
  core/              Shared tools used by every module (errors, ...)
  http/              HTTP layer: App, Router, response helpers, static files
  auth/              Login: password hashing, sessions, login limiter, access guard
  modules/           One folder per feature
    index.js         The single place where modules are registered
    system/          Hostname, uptime, CPU, load average, memory
public/              The web page: plain HTML, CSS and JavaScript, no build step
tests/               Tests, run with node:test
```

Imports go in one direction only: `http/` → `modules/` → `core/`.

- `http/` knows about requests and responses, and nothing about Linux.
- `modules/` knows about Linux, and nothing about HTTP.
- `core/` imports from neither.

## Adding a module

Every module has the same shape. For a module called `disk`:

| File | Role |
|------|------|
| `src/modules/disk/disk.parser.js` | Pure functions: text in, objects out. Runs nothing. |
| `src/modules/disk/disk.service.js` | `class DiskService`: collects the data and passes it to the parser. |
| `src/modules/disk/disk.routes.js` | `regDiskRoutes(router, diskService)`: the endpoints of the module. |
| `tests/disk.parser.test.js` | Tests for the parser, using real command output as input. |

Then register it with one line in `src/modules/index.js`. Nothing else in the existing code should need to change.

Only `*.routes.js` may import from `src/http/`. Services and parsers never touch `req` or `res`.

## Rules

- **No dependencies.** Only Node.js core modules. Pull requests that add a package will not be merged.
- **ES modules.** Use `import` and `export`.
- **Simple code.** Write code a junior developer can read without looking anything up.
  Prefer a plain `if` and a clearly named variable over a clever one-liner.
- **English everywhere.** Error messages, logs, comments and API responses.
- **Classes for things with state or dependencies** (`Router`, `App`, `*Service`) and for error types.
  Parsers and helpers are plain functions. Inheritance is used only for `Error`.
- **Dependencies come in through the constructor.** A service does not import `os` or `readFile` itself,
  it receives them. This is what makes it testable without a real Linux machine.
- **Never pass input to a shell.** Commands are started with `execFile` or `spawn` and an array of arguments.
- **Throw, do not catch.** Route handlers do not use `try`/`catch`. Throw an `AppError` and `App` turns it into a JSON response.
- **No frameworks or CDNs in the browser.** The page in `public/` loads only its own files, and the server
  sends a Content Security Policy that blocks everything else. Put text on the page with `textContent`, never `innerHTML`.
- **Match the surrounding style.** Four spaces, single quotes, no semicolons.

## API shape

Every endpoint lives under `/api/` and answers in one of two shapes:

```
Success:  { "data": ... }
Error:    { "error": { "code": "NOT_FOUND", "message": "..." } }
```

## Tests

- Tests live in `tests/` and are named `<name>.test.js`.
- New parsers and services need tests. A parser test should include the unusual cases:
  empty input, missing fields, unexpected content.
- Tests must not depend on the machine they run on. Give the service fake dependencies
  instead of reading the real `/proc` or running real commands.
- `npm test` must pass before you open a pull request.
## Pull requests

1. Fork the repository and create a branch from `main`: `git checkout -b add-disk-module`.
2. Keep the change focused. One pull request should do one thing.
3. Add or update tests, and run `npm test`.
4. Update `README.md` if you added or changed an endpoint.
5. Open the pull request and fill in the template. Link the issue it closes.

Commit messages are short and written in the imperative: `Add disk module`, `Fix swap calculation`.

## Security

lnxeasy exposes information about a server. If you find a security problem, please do not open a public issue.
Use [private vulnerability reporting](https://github.com/ix1osbek/lnxeasy/security/advisories/new) instead.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
