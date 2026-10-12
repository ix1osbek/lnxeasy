import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Router } from '../src/http/router.js'
import { regSystemRoutes } from '../src/modules/system/system.routes.js'

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

// A fake service: the routes file only needs an object with an async getInfo().
function createFakeSystemService() {
    return {
        getInfo: async () => {
            return { hostname: 'test-server' }
        },
    }
}

test('regSystemRoutes registers GET /api/system', () => {
    const router = new Router()

    regSystemRoutes(router, createFakeSystemService())

    const handler = router.match('GET', '/api/system')
    assert.equal(typeof handler, 'function')
})

test('GET /api/system answers 200 with the info from the service', async () => {
    const router = new Router()
    regSystemRoutes(router, createFakeSystemService())
    const handler = router.match('GET', '/api/system')
    const res = createFakeResponse()

    await handler({}, res)

    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), { data: { hostname: 'test-server' } })
})

test('the handler asks the service again on every request', async () => {
    let calls = 0
    const service = {
        getInfo: async () => {
            calls = calls + 1
            return {}
        },
    }
    const router = new Router()
    regSystemRoutes(router, service)
    const handler = router.match('GET', '/api/system')

    await handler({}, createFakeResponse())
    await handler({}, createFakeResponse())

    assert.equal(calls, 2)
})

test('the handler lets a service error reach the caller', async () => {
    const service = {
        getInfo: async () => {
            throw new Error('cannot read /proc')
        },
    }
    const router = new Router()
    regSystemRoutes(router, service)
    const handler = router.match('GET', '/api/system')
    const res = createFakeResponse()

    await assert.rejects(() => handler({}, res), { message: 'cannot read /proc' })
    assert.equal(res.statusCode, null)
})
