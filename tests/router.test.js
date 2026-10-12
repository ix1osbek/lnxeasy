import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Router } from '../src/http/router.js'
import { NotFoundError } from '../src/core/errors.js'

test('match returns the handler registered with get', () => {
    const router = new Router()
    const handler = () => {}
    router.get('/api/system', handler)

    const found = router.match('GET', '/api/system')

    assert.equal(found, handler)
})

test('match picks the right handler among several routes', () => {
    const router = new Router()
    const systemHandler = () => {}
    const portsHandler = () => {}
    router.get('/api/system', systemHandler)
    router.get('/api/ports', portsHandler)

    assert.equal(router.match('GET', '/api/system'), systemHandler)
    assert.equal(router.match('GET', '/api/ports'), portsHandler)
})

test('match accepts a lowercase method', () => {
    const router = new Router()
    const handler = () => {}
    router.get('/api/system', handler)

    assert.equal(router.match('get', '/api/system'), handler)
})

test('match throws NotFoundError for an unknown path', () => {
    const router = new Router()
    router.get('/api/system', () => {})

    assert.throws(() => router.match('GET', '/api/unknown'), NotFoundError)
})

test('match throws NotFoundError when the method is different', () => {
    const router = new Router()
    router.get('/api/system', () => {})

    assert.throws(() => router.match('POST', '/api/system'), NotFoundError)
})

test('match throws NotFoundError when no routes are registered', () => {
    const router = new Router()

    assert.throws(() => router.match('GET', '/'), NotFoundError)
})

test('the thrown error carries status 404, a code and the requested route', () => {
    const router = new Router()

    assert.throws(() => router.match('GET', '/api/unknown'), {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Route not found: GET /api/unknown',
    })
})

test('a trailing slash is a different path', () => {
    const router = new Router()
    router.get('/api/system', () => {})

    assert.throws(() => router.match('GET', '/api/system/'), NotFoundError)
})

test('the first registered handler wins for a duplicate route', () => {
    const router = new Router()
    const firstHandler = () => {}
    const secondHandler = () => {}
    router.get('/api/system', firstHandler)
    router.get('/api/system', secondHandler)

    assert.equal(router.match('GET', '/api/system'), firstHandler)
})

test('add registers a route for any method', () => {
    const router = new Router()
    const handler = () => {}
    router.add('POST', '/api/processes/kill', handler)

    assert.equal(router.match('POST', '/api/processes/kill'), handler)
})
