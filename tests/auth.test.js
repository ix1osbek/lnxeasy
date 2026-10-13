import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { checkNewPassword, generatePassword, hashPassword, verifyPassword } from '../src/auth/password.js'
import { AuthStore } from '../src/auth/store.js'
import { SessionStore } from '../src/auth/sessions.js'
import { LoginLimiter } from '../src/auth/limiter.js'
import { AuthService } from '../src/auth/auth.service.js'
import { AccessGuard } from '../src/auth/guard.js'
import { readJsonBody } from '../src/http/body.js'
import { buildCookie, buildExpiredCookie, readCookie } from '../src/http/cookies.js'
import {
    BadRequestError,
    ForbiddenError,
    InvalidCredentialsError,
    PayloadTooLargeError,
    TooManyAttemptsError,
    UnauthorizedError,
} from '../src/core/errors.js'

const MINUTE = 60 * 1000

// A clock the test moves by hand.
function createClock() {
    const clock = { time: 1000000 }
    clock.now = () => clock.time
    return clock
}

// An account store that lives in memory.
function createMemoryStore(account) {
    const store = { account: account, saves: 0 }
    store.load = async () => store.account
    store.save = async (next) => {
        store.account = next
        store.saves = store.saves + 1
    }
    return store
}

async function createService(password) {
    const clock = createClock()
    const hashed = await hashPassword(password)
    const store = createMemoryStore({ username: 'admin', salt: hashed.salt, hash: hashed.hash })
    const sessions = new SessionStore(60 * MINUTE, clock.now)
    const limiter = new LoginLimiter(clock.now)
    const service = new AuthService(store, sessions, limiter)

    return { service: service, store: store, sessions: sessions, clock: clock }
}

// A request body that arrives in the given chunks.
function createBodyRequest(contentType, chunks) {
    const req = new EventEmitter()
    req.headers = {}
    if (contentType !== null) {
        req.headers['content-type'] = contentType
    }

    setImmediate(() => {
        for (const chunk of chunks) {
            req.emit('data', Buffer.from(chunk))
        }
        req.emit('end')
    })

    return req
}

test('hashPassword gives a different salt and hash every time', async () => {
    const first = await hashPassword('correct horse battery')
    const second = await hashPassword('correct horse battery')

    assert.notEqual(first.salt, second.salt)
    assert.notEqual(first.hash, second.hash)
    assert.equal(first.hash.includes('correct'), false)
})

test('verifyPassword accepts the right password and rejects a wrong one', async () => {
    const record = await hashPassword('correct horse battery')

    assert.equal(await verifyPassword('correct horse battery', record), true)
    assert.equal(await verifyPassword('correct horse batterx', record), false)
    assert.equal(await verifyPassword('', record), false)
})

test('verifyPassword rejects a record with a damaged hash', async () => {
    const record = await hashPassword('correct horse battery')
    record.hash = record.hash.slice(0, 10)

    assert.equal(await verifyPassword('correct horse battery', record), false)
})

test('checkNewPassword rejects short, long and non-text passwords', () => {
    assert.throws(() => checkNewPassword('short'), BadRequestError)
    assert.throws(() => checkNewPassword('x'.repeat(201)), BadRequestError)
    assert.throws(() => checkNewPassword(undefined), BadRequestError)
    assert.doesNotThrow(() => checkNewPassword('long enough password'))
})

test('generatePassword makes long, different passwords that pass the check', () => {
    const first = generatePassword()
    const second = generatePassword()

    assert.notEqual(first, second)
    assert.equal(first.length, 23)
    assert.doesNotThrow(() => checkNewPassword(first))
})

test('AuthStore returns null when the file does not exist', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lnxeasy-test-'))
    const store = new AuthStore(path.join(directory, 'data', 'auth.json'), fs)

    assert.equal(await store.load(), null)

    await fs.rm(directory, { recursive: true })
})

test('AuthStore saves the account into a file only the owner can read', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lnxeasy-test-'))
    const filePath = path.join(directory, 'data', 'auth.json')
    const store = new AuthStore(filePath, fs)

    await store.save({ username: 'admin', salt: 'aa', hash: 'bb', extra: 'ignored' })

    assert.deepEqual(await store.load(), { username: 'admin', salt: 'aa', hash: 'bb' })
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600)
    assert.deepEqual(await fs.readdir(path.dirname(filePath)), ['auth.json'])

    await fs.rm(directory, { recursive: true })
})

test('AuthStore refuses a damaged file instead of treating it as empty', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lnxeasy-test-'))
    const filePath = path.join(directory, 'auth.json')
    const store = new AuthStore(filePath, fs)

    await fs.writeFile(filePath, 'not json')
    await assert.rejects(store.load(), /Invalid auth file/)

    await fs.writeFile(filePath, '{"username":"admin"}')
    await assert.rejects(store.load(), /Invalid auth file/)

    await fs.rm(directory, { recursive: true })
})

test('SessionStore creates unguessable tokens and finds the session', () => {
    const clock = createClock()
    const sessions = new SessionStore(60 * MINUTE, clock.now)

    const first = sessions.create('admin')
    const second = sessions.create('admin')

    assert.equal(first.length, 64)
    assert.notEqual(first, second)
    assert.equal(sessions.get(first).username, 'admin')
})

test('SessionStore does not know made-up, empty or missing tokens', () => {
    const sessions = new SessionStore(60 * MINUTE, createClock().now)
    sessions.create('admin')

    assert.equal(sessions.get('0'.repeat(64)), null)
    assert.equal(sessions.get(''), null)
    assert.equal(sessions.get(null), null)
    assert.equal(sessions.get(undefined), null)
})

test('SessionStore forgets a session when it expires or is deleted', () => {
    const clock = createClock()
    const sessions = new SessionStore(60 * MINUTE, clock.now)
    const expiring = sessions.create('admin')
    const deleted = sessions.create('admin')

    sessions.delete(deleted)
    clock.time = clock.time + 59 * MINUTE
    assert.notEqual(sessions.get(expiring), null)
    assert.equal(sessions.get(deleted), null)

    clock.time = clock.time + 1 * MINUTE
    assert.equal(sessions.get(expiring), null)
})

test('SessionStore drops the oldest session when it is full', () => {
    const sessions = new SessionStore(60 * MINUTE, createClock().now)
    const first = sessions.create('admin')

    for (let i = 0; i < 100; i = i + 1) {
        sessions.create('admin')
    }

    assert.equal(sessions.get(first), null)
    assert.equal(sessions.sessions.size, 100)
})

test('LoginLimiter locks a client after five failures and unlocks later', () => {
    const clock = createClock()
    const limiter = new LoginLimiter(clock.now)

    for (let i = 0; i < 4; i = i + 1) {
        limiter.recordFailure('1.2.3.4')
    }
    assert.equal(limiter.secondsUntilAllowed('1.2.3.4'), 0)

    limiter.recordFailure('1.2.3.4')
    assert.equal(limiter.secondsUntilAllowed('1.2.3.4'), 15 * 60)
    assert.equal(limiter.secondsUntilAllowed('5.6.7.8'), 0)

    clock.time = clock.time + 15 * MINUTE
    assert.equal(limiter.secondsUntilAllowed('1.2.3.4'), 0)
})

test('LoginLimiter forgets failures after a success or after the window', () => {
    const clock = createClock()
    const limiter = new LoginLimiter(clock.now)

    for (let i = 0; i < 4; i = i + 1) {
        limiter.recordFailure('a')
        limiter.recordFailure('b')
    }

    limiter.recordSuccess('a')
    limiter.recordFailure('a')
    assert.equal(limiter.secondsUntilAllowed('a'), 0)

    clock.time = clock.time + 16 * MINUTE
    limiter.recordFailure('b')
    assert.equal(limiter.secondsUntilAllowed('b'), 0)
})

test('login returns a session token for the right username and password', async () => {
    const { service } = await createService('correct horse battery')

    const token = await service.login('admin', 'correct horse battery', '1.2.3.4')

    assert.equal(service.getSession(token).username, 'admin')
})

test('login rejects a wrong password and a wrong username the same way', async () => {
    const { service } = await createService('correct horse battery')

    await assert.rejects(service.login('admin', 'wrong password!', '1.2.3.4'), InvalidCredentialsError)
    await assert.rejects(service.login('root', 'correct horse battery', '1.2.3.4'), InvalidCredentialsError)
})

test('login rejects input that is not text', async () => {
    const { service } = await createService('correct horse battery')

    await assert.rejects(service.login(undefined, undefined, '1.2.3.4'), BadRequestError)
    await assert.rejects(service.login('admin', { $ne: '' }, '1.2.3.4'), BadRequestError)
})

test('login locks out a client after five wrong passwords, even with the right one', async () => {
    const { service, clock } = await createService('correct horse battery')

    for (let i = 0; i < 5; i = i + 1) {
        await assert.rejects(service.login('admin', 'wrong password!', '1.2.3.4'), InvalidCredentialsError)
    }

    await assert.rejects(service.login('admin', 'correct horse battery', '1.2.3.4'), TooManyAttemptsError)
    assert.notEqual(await service.login('admin', 'correct horse battery', '9.9.9.9'), null)

    clock.time = clock.time + 15 * MINUTE
    assert.notEqual(await service.login('admin', 'correct horse battery', '1.2.3.4'), null)
})

test('logout ends the session', async () => {
    const { service } = await createService('correct horse battery')
    const token = await service.login('admin', 'correct horse battery', '1.2.3.4')

    service.logout(token)

    assert.equal(service.getSession(token), null)
})

test('changePassword replaces the password and signs out every other session', async () => {
    const { service, store } = await createService('correct horse battery')
    const other = await service.login('admin', 'correct horse battery', '5.5.5.5')
    const token = await service.login('admin', 'correct horse battery', '1.2.3.4')

    const nextToken = await service.changePassword(token, 'correct horse battery', 'a brand new password', '1.2.3.4')

    assert.equal(store.saves, 1)
    assert.equal(service.getSession(other), null)
    assert.equal(service.getSession(token), null)
    assert.equal(service.getSession(nextToken).username, 'admin')
    await assert.rejects(service.login('admin', 'correct horse battery', '1.2.3.4'), InvalidCredentialsError)
    assert.notEqual(await service.login('admin', 'a brand new password', '1.2.3.4'), null)
})

test('changePassword needs a session, the current password and a strong new one', async () => {
    const { service, store } = await createService('correct horse battery')
    const token = await service.login('admin', 'correct horse battery', '1.2.3.4')

    await assert.rejects(
        service.changePassword('made-up-token', 'correct horse battery', 'a brand new password', '1.2.3.4'),
        UnauthorizedError
    )
    await assert.rejects(
        service.changePassword(token, 'wrong password!', 'a brand new password', '1.2.3.4'),
        InvalidCredentialsError
    )
    await assert.rejects(
        service.changePassword(token, 'correct horse battery', 'short', '1.2.3.4'),
        BadRequestError
    )
    assert.equal(store.saves, 0)
    assert.notEqual(service.getSession(token), null)
})

test('AccessGuard knows which paths are open to everyone', () => {
    const guard = new AccessGuard({ getSession: () => null }, 'sid')

    assert.equal(guard.isPublic('/login'), true)
    assert.equal(guard.isPublic('/api/auth/login'), true)
    assert.equal(guard.isPublic('/api/health'), true)
    assert.equal(guard.isPublic('/'), false)
    assert.equal(guard.isPublic('/app.js'), false)
    assert.equal(guard.isPublic('/api/system'), false)
    assert.equal(guard.isPublic('/api/auth/password'), false)
    assert.equal(guard.isPublic('/login/../api/system'), false)
})

test('AccessGuard reads the session token from its own cookie', () => {
    const asked = []
    const authService = {
        getSession: (token) => {
            asked.push(token)
            if (token === 'good') {
                return { username: 'admin' }
            }
            return null
        },
    }
    const guard = new AccessGuard(authService, 'sid')

    assert.equal(guard.isAuthenticated({ headers: { cookie: 'theme=light; sid=good' } }), true)
    assert.equal(guard.isAuthenticated({ headers: { cookie: 'sid=bad' } }), false)
    assert.equal(guard.isAuthenticated({ headers: { cookie: 'other=good' } }), false)
    assert.equal(guard.isAuthenticated({ headers: {} }), false)
    assert.deepEqual(asked, ['good', 'bad', null, null])
})

test('AccessGuard lets reads through and checks where writes come from', () => {
    const guard = new AccessGuard({ getSession: () => null }, 'sid')
    const host = '203.0.113.10:4321'

    assert.doesNotThrow(() => guard.checkOrigin({ method: 'GET', headers: { host: host, origin: 'https://evil.example' } }))
    assert.doesNotThrow(() => guard.checkOrigin({ method: 'POST', headers: { host: host, origin: 'https://203.0.113.10:4321' } }))
    assert.doesNotThrow(() => guard.checkOrigin({ method: 'POST', headers: { host: host } }))

    assert.throws(() => guard.checkOrigin({ method: 'POST', headers: { host: host, origin: 'https://evil.example' } }), ForbiddenError)
    assert.throws(() => guard.checkOrigin({ method: 'POST', headers: { host: host, origin: 'https://203.0.113.10:9999' } }), ForbiddenError)
    assert.throws(() => guard.checkOrigin({ method: 'POST', headers: { host: host, origin: 'null' } }), ForbiddenError)
    assert.throws(() => guard.checkOrigin({ method: 'POST', headers: { host: host, 'sec-fetch-site': 'cross-site' } }), ForbiddenError)
    assert.throws(() => guard.checkOrigin({ method: 'DELETE', headers: { host: host, 'sec-fetch-site': 'same-site' } }), ForbiddenError)
})

test('readJsonBody parses a JSON object that arrives in pieces', async () => {
    const req = createBodyRequest('application/json; charset=utf-8', ['{"user', 'name":"admin"}'])

    assert.deepEqual(await readJsonBody(req), { username: 'admin' })
})

test('readJsonBody rejects other content types, broken JSON and non-objects', async () => {
    await assert.rejects(readJsonBody(createBodyRequest('text/plain', ['{}'])), BadRequestError)
    await assert.rejects(readJsonBody(createBodyRequest(null, ['{}'])), BadRequestError)
    await assert.rejects(readJsonBody(createBodyRequest('application/json', ['{oops'])), BadRequestError)
    await assert.rejects(readJsonBody(createBodyRequest('application/json', ['[1,2]'])), BadRequestError)
    await assert.rejects(readJsonBody(createBodyRequest('application/json', ['null'])), BadRequestError)
    await assert.rejects(readJsonBody(createBodyRequest('application/json', [''])), BadRequestError)
})

test('readJsonBody stops at the size limit', async () => {
    const req = createBodyRequest('application/json', ['{"a":"', 'x'.repeat(200), '"}'])

    await assert.rejects(readJsonBody(req, 100), PayloadTooLargeError)
})

test('readCookie finds a cookie by its exact name', () => {
    const req = { headers: { cookie: 'a=1; sid=abc=def; sidx=no' } }

    assert.equal(readCookie(req, 'sid'), 'abc=def')
    assert.equal(readCookie(req, 'a'), '1')
    assert.equal(readCookie(req, 'si'), null)
    assert.equal(readCookie({ headers: {} }, 'sid'), null)
})

test('buildCookie hides the cookie from scripts and from other sites', () => {
    assert.equal(buildCookie('sid', 'abc', 3600, false), 'sid=abc; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600')
    assert.equal(buildCookie('sid', 'abc', 3600, true), 'sid=abc; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600; Secure')
    assert.equal(buildExpiredCookie('sid', true), 'sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure')
})
