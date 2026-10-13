import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Router } from '../src/http/router.js'
import { regModules } from '../src/modules/index.js'

function createFakeOs() {
    return {
        hostname: () => 'test-server',
        platform: () => 'linux',
        release: () => '6.8.0-test',
        arch: () => 'x64',
        uptime: () => 100,
        cpus: () => [{ model: 'Test CPU' }],
        networkInterfaces: () => {
            return { eth0: [{ address: '203.0.113.10', family: 'IPv4', internal: false }] }
        },
    }
}

function createFakeReadFile() {
    return async (path) => {
        if (path === '/proc/loadavg') {
            return '0.10 0.20 0.30 1/100 42\n'
        }
        return 'MemTotal: 8 kB\nMemFree: 1 kB\nMemAvailable: 3 kB\nSwapTotal: 2 kB\nSwapFree: 1 kB\n'
    }
}

function createFakeRun() {
    return async () => {
        return { stdout: 'tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\n', stderr: '' }
    }
}

function createFakeDependencies() {
    return {
        os: createFakeOs(),
        readFile: createFakeReadFile(),
        run: createFakeRun(),
        readSocket: async () => '',
        helperSocket: null,
        fs: { readFile: async () => '', statfs: async () => ({}) },
        now: () => 0,
        sleep: async () => {},
    }
}

function createFakeResponse() {
    const res = { headersSent: false, statusCode: null, body: null }

    res.writeHead = (statusCode) => {
        res.statusCode = statusCode
        res.headersSent = true
    }

    res.end = (body) => {
        res.body = body
    }

    return res
}

test('regModules registers the system module routes', () => {
    const router = new Router()

    regModules(router, createFakeDependencies())

    const handler = router.match('GET', '/api/system')
    assert.equal(typeof handler, 'function')
})

test('the system module uses the dependencies it was given', async () => {
    const router = new Router()
    regModules(router, createFakeDependencies())
    const handler = router.match('GET', '/api/system')
    const res = createFakeResponse()

    await handler({}, res)

    const data = JSON.parse(res.body).data
    assert.equal(res.statusCode, 200)
    assert.equal(data.hostname, 'test-server')
    assert.equal(data.loadAverage.one, 0.1)
    assert.equal(data.memory.totalBytes, 8 * 1024)
})

test('regModules registers the ports module routes', () => {
    const router = new Router()

    regModules(router, createFakeDependencies())

    const handler = router.match('GET', '/api/ports')
    assert.equal(typeof handler, 'function')
})

test('the ports module uses the run function it was given', async () => {
    const router = new Router()
    regModules(router, createFakeDependencies())
    const handler = router.match('GET', '/api/ports')
    const res = createFakeResponse()

    await handler({}, res)

    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body).data, [
        { protocol: 'tcp', state: 'LISTEN', address: '0.0.0.0', port: 22, processes: [] },
    ])
})
