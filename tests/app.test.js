import { test } from 'node:test'
import assert from 'node:assert/strict'
import { App } from '../src/http/app.js'
import { Router } from '../src/http/router.js'
import { sendJson } from '../src/http/response.js'
import { AppError } from '../src/core/errors.js'

function createFakeResponse() {
    const res = {
        headersSent: false,
        statusCode: null,
        headers: null,
        body: null,
        ended: false,
    }

    res.writeHead = (statusCode, headers) => {
        res.statusCode = statusCode
        res.headers = headers
        res.headersSent = true
    }

    res.end = (body) => {
        res.body = body
        res.ended = true
    }

    return res
}

// App only reads method and url from the request.
function createFakeRequest(method, url) {
    return { method: method, url: url }
}

test('handle calls the matching handler', async () => {
    const router = new Router()
    router.get('/api/hello', (req, res) => {
        sendJson(res, 200, { message: 'hi' })
    })
    const app = new App(router)
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/hello'), res)

    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), { data: { message: 'hi' } })
})

test('handle ignores the query string when matching', async () => {
    const router = new Router()
    router.get('/api/hello', (req, res) => {
        sendJson(res, 200, { message: 'hi' })
    })
    const app = new App(router)
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/hello?page=2'), res)

    assert.equal(res.statusCode, 200)
})

test('handle passes the request and response to the handler', async () => {
    const router = new Router()
    let receivedReq = null
    let receivedRes = null
    router.get('/api/hello', (req, res) => {
        receivedReq = req
        receivedRes = res
        sendJson(res, 200, {})
    })
    const app = new App(router)
    const req = createFakeRequest('GET', '/api/hello')
    const res = createFakeResponse()

    await app.handle(req, res)

    assert.equal(receivedReq, req)
    assert.equal(receivedRes, res)
})

test('handle waits for an async handler', async () => {
    const router = new Router()
    router.get('/api/slow', async (req, res) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        sendJson(res, 200, { slow: true })
    })
    const app = new App(router)
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/slow'), res)

    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), { data: { slow: true } })
})

test('handle answers 404 for an unknown route', async () => {
    const app = new App(new Router())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/unknown'), res)

    assert.equal(res.statusCode, 404)
    assert.deepEqual(JSON.parse(res.body), {
        error: { code: 'NOT_FOUND', message: 'Route not found: GET /api/unknown' },
    })
})

test('handle turns an AppError from a handler into its own response', async () => {
    const router = new Router()
    router.get('/api/bad', () => {
        throw new AppError(400, 'BAD_REQUEST', 'Bad input')
    })
    const app = new App(router)
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/bad'), res)

    assert.equal(res.statusCode, 400)
    assert.deepEqual(JSON.parse(res.body), {
        error: { code: 'BAD_REQUEST', message: 'Bad input' },
    })
})

// t.mock.method replaces console.error for this test only, so the expected
// error does not clutter the test output. It also counts the calls.
test('handle answers 500 and logs an unexpected error', async (t) => {
    const errorLog = t.mock.method(console, 'error', () => {})
    const router = new Router()
    router.get('/api/bug', () => {
        throw new TypeError('secret internal detail')
    })
    const app = new App(router)
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/bug'), res)

    assert.equal(res.statusCode, 500)
    assert.deepEqual(JSON.parse(res.body), {
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
    assert.equal(errorLog.mock.callCount(), 1)
})

test('handle catches an error thrown inside an async handler', async (t) => {
    t.mock.method(console, 'error', () => {})
    const router = new Router()
    router.get('/api/bug', async () => {
        await null
        throw new Error('boom')
    })
    const app = new App(router)
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/bug'), res)

    assert.equal(res.statusCode, 500)
})

test('handle does not log a 404', async (t) => {
    const errorLog = t.mock.method(console, 'error', () => {})
    const app = new App(new Router())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/unknown'), res)

    assert.equal(errorLog.mock.callCount(), 0)
})

// A fake StaticFiles: remembers the paths it was asked to serve.
function createFakeStaticFiles() {
    const served = []

    const serve = async (req, res, path) => {
        served.push(path)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h1>page</h1>')
    }

    return { serve: serve, served: served }
}

test('handle serves a file for a path outside /api/', async () => {
    const staticFiles = createFakeStaticFiles()
    const app = new App(new Router(), staticFiles)
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/styles.css?v=2'), res)

    assert.deepEqual(staticFiles.served, ['/styles.css'])
    assert.equal(res.statusCode, 200)
    assert.equal(res.body, '<h1>page</h1>')
})

test('handle does not ask for a file when the path is under /api/', async () => {
    const staticFiles = createFakeStaticFiles()
    const app = new App(new Router(), staticFiles)
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/unknown'), res)

    assert.deepEqual(staticFiles.served, [])
    assert.equal(res.statusCode, 404)
})

test('handle turns a missing file into a 404 response', async () => {
    const staticFiles = {
        serve: async (req, res, path) => {
            throw new AppError(404, 'NOT_FOUND', 'File not found: ' + path)
        },
    }
    const app = new App(new Router(), staticFiles)
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/nope.html'), res)

    assert.equal(res.statusCode, 404)
    assert.deepEqual(JSON.parse(res.body), {
        error: { code: 'NOT_FOUND', message: 'File not found: /nope.html' },
    })
})
