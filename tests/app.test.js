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

// A guard that lets everything through, for tests that are not about access control.
function createOpenGuard() {
    return {
        checkOrigin: () => {},
        isPublic: () => true,
        isAuthenticated: () => true,
    }
}

// A client policy that lets every address in.
function createOpenPolicy() {
    return {
        identify: () => '203.0.113.5',
        allows: () => true,
    }
}

// A request limiter that never says no.
function createOpenLimiter() {
    return { check: () => {} }
}

// A guard with a fixed answer: public paths are listed, and the visitor is signed in or not.
function createGuard(publicPaths, authenticated) {
    return {
        checkOrigin: () => {},
        isPublic: (path) => publicPaths.includes(path),
        isAuthenticated: () => authenticated,
    }
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
    const app = new App(router, null, createOpenGuard(), createOpenLimiter(), createOpenPolicy())
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
    const app = new App(router, null, createOpenGuard(), createOpenLimiter(), createOpenPolicy())
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
    const app = new App(router, null, createOpenGuard(), createOpenLimiter(), createOpenPolicy())
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
    const app = new App(router, null, createOpenGuard(), createOpenLimiter(), createOpenPolicy())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/slow'), res)

    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), { data: { slow: true } })
})

test('handle answers 404 for an unknown route', async () => {
    const app = new App(new Router(), null, createOpenGuard(), createOpenLimiter(), createOpenPolicy())
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
    const app = new App(router, null, createOpenGuard(), createOpenLimiter(), createOpenPolicy())
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
    const app = new App(router, null, createOpenGuard(), createOpenLimiter(), createOpenPolicy())
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
    const app = new App(router, null, createOpenGuard(), createOpenLimiter(), createOpenPolicy())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/bug'), res)

    assert.equal(res.statusCode, 500)
})

test('handle does not log a 404', async (t) => {
    const errorLog = t.mock.method(console, 'error', () => {})
    const app = new App(new Router(), null, createOpenGuard(), createOpenLimiter(), createOpenPolicy())
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
    const app = new App(new Router(), staticFiles, createOpenGuard(), createOpenLimiter(), createOpenPolicy())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/styles.css?v=2'), res)

    assert.deepEqual(staticFiles.served, ['/styles.css'])
    assert.equal(res.statusCode, 200)
    assert.equal(res.body, '<h1>page</h1>')
})

test('handle does not ask for a file when the path is under /api/', async () => {
    const staticFiles = createFakeStaticFiles()
    const app = new App(new Router(), staticFiles, createOpenGuard(), createOpenLimiter(), createOpenPolicy())
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
    const app = new App(new Router(), staticFiles, createOpenGuard(), createOpenLimiter(), createOpenPolicy())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/nope.html'), res)

    assert.equal(res.statusCode, 404)
    assert.deepEqual(JSON.parse(res.body), {
        error: { code: 'NOT_FOUND', message: 'File not found: /nope.html' },
    })
})

test('handle answers 401 for a protected endpoint without a session', async () => {
    const router = new Router()
    let called = false
    router.get('/api/secret', (req, res) => {
        called = true
        sendJson(res, 200, {})
    })
    const app = new App(router, createFakeStaticFiles(), createGuard([], false), createOpenLimiter(), createOpenPolicy())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/secret'), res)

    assert.equal(called, false)
    assert.equal(res.statusCode, 401)
    assert.deepEqual(JSON.parse(res.body), {
        error: { code: 'UNAUTHORIZED', message: 'Login required' },
    })
})

test('handle does not reveal whether a protected endpoint exists', async () => {
    const app = new App(new Router(), createFakeStaticFiles(), createGuard([], false), createOpenLimiter(), createOpenPolicy())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/unknown'), res)

    assert.equal(res.statusCode, 401)
})

test('handle serves a public endpoint without a session', async () => {
    const router = new Router()
    router.get('/api/health', (req, res) => {
        sendJson(res, 200, { status: 'ok' })
    })
    const app = new App(router, createFakeStaticFiles(), createGuard(['/api/health'], false), createOpenLimiter(), createOpenPolicy())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/health'), res)

    assert.equal(res.statusCode, 200)
})

test('handle serves a protected endpoint with a session', async () => {
    const router = new Router()
    router.get('/api/secret', (req, res) => {
        sendJson(res, 200, { secret: 1 })
    })
    const app = new App(router, createFakeStaticFiles(), createGuard([], true), createOpenLimiter(), createOpenPolicy())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/secret'), res)

    assert.equal(res.statusCode, 200)
})

test('handle redirects a protected page to the login page without a session', async () => {
    const staticFiles = createFakeStaticFiles()
    const app = new App(new Router(), staticFiles, createGuard(['/login'], false), createOpenLimiter(), createOpenPolicy())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/'), res)

    assert.equal(res.statusCode, 302)
    assert.equal(res.headers['Location'], '/login')
    assert.deepEqual(staticFiles.served, [])
})

test('handle serves the login page file for /login', async () => {
    const staticFiles = createFakeStaticFiles()
    const app = new App(new Router(), staticFiles, createGuard(['/login'], false), createOpenLimiter(), createOpenPolicy())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/login'), res)

    assert.equal(res.statusCode, 200)
    assert.deepEqual(staticFiles.served, ['/login.html'])
})

test('handle blocks a request the guard rejects before the handler runs', async () => {
    const router = new Router()
    let called = false
    router.post('/api/change', (req, res) => {
        called = true
        sendJson(res, 200, {})
    })
    const guard = createGuard([], true)
    guard.checkOrigin = () => {
        throw new AppError(403, 'FORBIDDEN', 'Cross-site request blocked')
    }
    const app = new App(router, createFakeStaticFiles(), guard, createOpenLimiter(), createOpenPolicy())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('POST', '/api/change'), res)

    assert.equal(called, false)
    assert.equal(res.statusCode, 403)
})

test('handle answers 429 when the request limiter says no, before anything else runs', async () => {
    const router = new Router()
    let called = false
    router.get('/api/health', (req, res) => {
        called = true
        sendJson(res, 200, {})
    })
    const limiter = {
        check: () => {
            throw new AppError(429, 'RATE_LIMITED', 'Too many requests')
        },
    }
    const app = new App(router, createFakeStaticFiles(), createOpenGuard(), limiter, createOpenPolicy())
    const res = createFakeResponse()

    await app.handle(createFakeRequest('GET', '/api/health'), res)

    assert.equal(called, false)
    assert.equal(res.statusCode, 429)
})

test('handle hangs up without an answer when the client address is not allowed', async () => {
    const router = new Router()
    let called = false
    router.get('/api/health', (req, res) => {
        called = true
        sendJson(res, 200, {})
    })
    const policy = {
        identify: () => '198.51.100.9',
        allows: () => false,
    }
    const app = new App(router, createFakeStaticFiles(), createOpenGuard(), createOpenLimiter(), policy)
    const req = createFakeRequest('GET', '/api/health')
    let destroyed = false
    req.socket = { destroy: () => { destroyed = true } }
    const res = createFakeResponse()

    await app.handle(req, res)

    assert.equal(called, false)
    assert.equal(destroyed, true)
    assert.equal(res.statusCode, null)
})

test('handle stores the client address the policy found on the request', async () => {
    const router = new Router()
    let seen = null
    router.get('/api/health', (req, res) => {
        seen = req.clientAddress
        sendJson(res, 200, {})
    })
    const app = new App(router, createFakeStaticFiles(), createOpenGuard(), createOpenLimiter(), createOpenPolicy())

    await app.handle(createFakeRequest('GET', '/api/health'), createFakeResponse())

    assert.equal(seen, '203.0.113.5')
})
