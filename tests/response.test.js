import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendJson, sendError } from '../src/http/response.js'
import { AppError, NotFoundError } from '../src/core/errors.js'

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

test('sendJson writes the status, the JSON content type and wraps data', () => {
    const res = createFakeResponse()

    sendJson(res, 200, { hostname: 'server-1' })

    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8')
    assert.equal(res.headers['Content-Security-Policy'], "default-src 'none'; frame-ancestors 'none'")
    assert.deepEqual(JSON.parse(res.body), { data: { hostname: 'server-1' } })
    assert.equal(res.ended, true)
})

test('sendJson keeps the status code it was given', () => {
    const res = createFakeResponse()

    sendJson(res, 201, [1, 2, 3])

    assert.equal(res.statusCode, 201)
    assert.deepEqual(JSON.parse(res.body), { data: [1, 2, 3] })
})

test('sendError uses the status, code and message of an AppError', () => {
    const res = createFakeResponse()

    sendError(res, new AppError(400, 'BAD_REQUEST', 'Missing name'))

    assert.equal(res.statusCode, 400)
    assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8')
    assert.equal(res.headers['Content-Security-Policy'], "default-src 'none'; frame-ancestors 'none'")
    assert.deepEqual(JSON.parse(res.body), {
        error: { code: 'BAD_REQUEST', message: 'Missing name' },
    })
})

test('sendError treats NotFoundError as an AppError', () => {
    const res = createFakeResponse()

    sendError(res, new NotFoundError('Route not found: GET /x'))

    assert.equal(res.statusCode, 404)
    assert.deepEqual(JSON.parse(res.body), {
        error: { code: 'NOT_FOUND', message: 'Route not found: GET /x' },
    })
})

test('sendError hides the details of an unexpected error', () => {
    const res = createFakeResponse()

    sendError(res, new TypeError('secret internal detail'))

    assert.equal(res.statusCode, 500)
    assert.deepEqual(JSON.parse(res.body), {
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
})

test('sendError only ends the response when headers were already sent', () => {
    const res = createFakeResponse()
    res.writeHead(200, {})

    sendError(res, new NotFoundError('Too late'))

    assert.equal(res.statusCode, 200)
    assert.equal(res.body, undefined)
    assert.equal(res.ended, true)
})
