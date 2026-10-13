import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import {readFile} from 'node:fs/promises'
import {loadConfig} from './src/config.js'
import {Router} from './src/http/router.js'
import {App} from './src/http/app.js'
import {StaticFiles} from './src/http/static.js'
import {sendJson} from './src/http/response.js'
import {regModules} from './src/modules/index.js'
import {run} from './src/core/exec.js'

const config = loadConfig(process.env)

const router = new Router()
router.get('/api/health', (req, res) => {
    sendJson(res, 200, {status: 'ok'})
})
regModules(router, {os: os, readFile: readFile, run: run})

const publicDirectory = path.join(import.meta.dirname, 'public')
const staticFiles = new StaticFiles(publicDirectory, readFile)

const app = new App(router, staticFiles)

const server = http.createServer()

server.on('request', (req, res) => {
    app.handle(req, res)
})

server.listen(config.port, config.host, () => {
    const address = server.address()
    console.log(`Server started on http://${address.address}:${address.port}`)
})
