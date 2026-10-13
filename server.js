import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import os from 'node:os'
import * as fs from 'node:fs/promises'
import {isLoopbackHost, loadConfig} from './src/config.js'
import {Router} from './src/http/router.js'
import {App} from './src/http/app.js'
import {StaticFiles} from './src/http/static.js'
import {sendJson} from './src/http/response.js'
import {regModules} from './src/modules/index.js'
import {run} from './src/core/exec.js'
import {AuthStore} from './src/auth/store.js'
import {SessionStore} from './src/auth/sessions.js'
import {LoginLimiter} from './src/auth/limiter.js'
import {AuthService} from './src/auth/auth.service.js'
import {AccessGuard} from './src/auth/guard.js'
import {regAuthRoutes} from './src/auth/auth.routes.js'

const SESSION_COOKIE_NAME = 'lnxeasy_session'
const SESSION_LIFETIME_SECONDS = 24 * 60 * 60

function stop(message) {
    console.error(message)
    process.exit(1)
}

const config = loadConfig(process.env)

if (config.tls === null && !isLoopbackHost(config.host) && !config.allowInsecureHttp) {
    stop(
        'Refusing to listen on ' + config.host + ' without HTTPS: the password would travel unencrypted.\n' +
        'Set TLS_CERT_FILE and TLS_KEY_FILE, or set HOST=127.0.0.1.\n' +
        'Behind a reverse proxy that adds HTTPS, set ALLOW_INSECURE_HTTP=yes.'
    )
}

const authStore = new AuthStore(config.authFile, fs)

if ((await authStore.load()) === null) {
    stop(
        'No admin account found in ' + config.authFile + '.\n' +
        'Create one with: npm run passwd'
    )
}

const now = () => Date.now()
const sessions = new SessionStore(SESSION_LIFETIME_SECONDS * 1000, now)
const authService = new AuthService(authStore, sessions, new LoginLimiter(now))
const guard = new AccessGuard(authService, SESSION_COOKIE_NAME)

const router = new Router()
router.get('/api/health', (req, res) => {
    sendJson(res, 200, {status: 'ok'})
})
regAuthRoutes(router, authService, {
    name: SESSION_COOKIE_NAME,
    maxAgeSeconds: SESSION_LIFETIME_SECONDS,
    secure: config.tls !== null
})
regModules(router, {os: os, readFile: fs.readFile, run: run})

const publicDirectory = path.join(import.meta.dirname, 'public')
const staticFiles = new StaticFiles(publicDirectory, fs.readFile)

const app = new App(router, staticFiles, guard)

let server = null
let scheme = 'http'

if (config.tls === null) {
    server = http.createServer()
} else {
    scheme = 'https'
    server = https.createServer({
        cert: await fs.readFile(config.tls.certFile),
        key: await fs.readFile(config.tls.keyFile)
    })
}

server.on('request', (req, res) => {
    app.handle(req, res)
})

server.listen(config.port, config.host, () => {
    const address = server.address()
    console.log(`Server started on ${scheme}://${address.address}:${address.port}`)
})
