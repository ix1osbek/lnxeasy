import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Router } from '../src/http/router.js'
import { regPortsRoutes } from '../src/modules/ports/ports.routes.js'

function createFakeResponse() {
    const res = {
        headersSent: false,
        statusCode: null,
        headers: null,
        body: null,
    }

    res.writeHead = (statusCode, headers) => {
        res.statusCode = statusCode
        res.headers = headers
        res.headersSent = true
    }

    res.end = (body) => {
        res.body = body
    }

    return res
}

const PORTS = [
    { protocol: 'tcp', state: 'LISTEN', address: '0.0.0.0', port: 22, processes: [{ name: 'sshd', pid: 900 }] },
]

// A fake service: the routes file only needs an object with an async list().
function createFakePortsService() {
    return {
        list: async () => {
            return PORTS
        },
    }
}

test('regPortsRoutes registers GET /api/ports', () => {
    const router = new Router()

    regPortsRoutes(router, createFakePortsService())

    const handler = router.match('GET', '/api/ports')
    assert.equal(typeof handler, 'function')
})

test('GET /api/ports answers 200 with the list from the service', async () => {
    const router = new Router()
    regPortsRoutes(router, createFakePortsService())
    const handler = router.match('GET', '/api/ports')
    const res = createFakeResponse()

    await handler({}, res)

    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), { data: PORTS })
})

test('the ports handler asks the service again on every request', async () => {
    let calls = 0
    const service = {
        list: async () => {
            calls = calls + 1
            return []
        },
    }
    const router = new Router()
    regPortsRoutes(router, service)
    const handler = router.match('GET', '/api/ports')

    await handler({}, createFakeResponse())
    await handler({}, createFakeResponse())

    assert.equal(calls, 2)
})

test('the ports handler lets a service error reach the caller', async () => {
    const service = {
        list: async () => {
            throw new Error('ss failed')
        },
    }
    const router = new Router()
    regPortsRoutes(router, service)
    const handler = router.match('GET', '/api/ports')
    const res = createFakeResponse()

    await assert.rejects(handler({}, res), { message: 'ss failed' })
    assert.equal(res.headersSent, false)
})
