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
import { buildTotpUri, computeTotpCode, decodeBase32, encodeBase32, findTotpStep, generateTotpSecret, getTimeStep } from '../src/auth/totp.js'
import { AddressFilter, checkAddressEntry, normalizeAddress } from '../src/http/address.js'
import { RequestLimiter } from '../src/http/rate.js'
import { readJsonBody } from '../src/http/body.js'
import { buildCookie, buildExpiredCookie, readCookie } from '../src/http/cookies.js'
import {
    BadRequestError,
    ForbiddenError,
    InvalidCodeError,
    InvalidCredentialsError,
    RateLimitedError,
    ServiceBusyError,
    TotpRequiredError,
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
    const store = createMemoryStore({ username: 'admin', salt: hashed.salt, hash: hashed.hash, totpSecret: null })
    const sessions = new SessionStore(60 * MINUTE, clock.now)
    const limiter = new LoginLimiter(clock.now)
    const logLines = []
    const service = new AuthService(store, sessions, limiter, clock.now, (line) => logLines.push(line))

    return { service: service, store: store, sessions: sessions, clock: clock, logLines: logLines }
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
    assert.doesNotThrow(() => checkNewPassword('long enough phrase'))
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

    assert.deepEqual(await store.load(), { username: 'admin', salt: 'aa', hash: 'bb', totpSecret: null, totpLastStep: 0 })
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

    const token = await service.login('admin', 'correct horse battery', undefined, '1.2.3.4')

    assert.equal(service.getSession(token).username, 'admin')
})

test('login rejects a wrong password and a wrong username the same way', async () => {
    const { service } = await createService('correct horse battery')

    await assert.rejects(service.login('admin', 'wrong password!', undefined, '1.2.3.4'), InvalidCredentialsError)
    await assert.rejects(service.login('root', 'correct horse battery', undefined, '1.2.3.4'), InvalidCredentialsError)
})

test('login rejects input that is not text', async () => {
    const { service } = await createService('correct horse battery')

    await assert.rejects(service.login(undefined, undefined, undefined, '1.2.3.4'), BadRequestError)
    await assert.rejects(service.login('admin', { $ne: '' }, undefined, '1.2.3.4'), BadRequestError)
})

test('login locks out a client after five wrong passwords, even with the right one', async () => {
    const { service, clock } = await createService('correct horse battery')

    for (let i = 0; i < 5; i = i + 1) {
        await assert.rejects(service.login('admin', 'wrong password!', undefined, '1.2.3.4'), InvalidCredentialsError)
    }

    await assert.rejects(service.login('admin', 'correct horse battery', undefined, '1.2.3.4'), TooManyAttemptsError)
    assert.notEqual(await service.login('admin', 'correct horse battery', undefined, '9.9.9.9'), null)

    clock.time = clock.time + 15 * MINUTE
    assert.notEqual(await service.login('admin', 'correct horse battery', undefined, '1.2.3.4'), null)
})

test('logout ends the session', async () => {
    const { service } = await createService('correct horse battery')
    const token = await service.login('admin', 'correct horse battery', undefined, '1.2.3.4')

    service.logout(token)

    assert.equal(service.getSession(token), null)
})

test('changePassword replaces the password and signs out every other session', async () => {
    const { service, store } = await createService('correct horse battery')
    const other = await service.login('admin', 'correct horse battery', undefined, '5.5.5.5')
    const token = await service.login('admin', 'correct horse battery', undefined, '1.2.3.4')

    const nextToken = await service.changePassword(token, 'correct horse battery', 'fresh-secret-phrase-42', '1.2.3.4')

    assert.equal(store.saves, 1)
    assert.equal(service.getSession(other), null)
    assert.equal(service.getSession(token), null)
    assert.equal(service.getSession(nextToken).username, 'admin')
    await assert.rejects(service.login('admin', 'correct horse battery', undefined, '1.2.3.4'), InvalidCredentialsError)
    assert.notEqual(await service.login('admin', 'fresh-secret-phrase-42', undefined, '1.2.3.4'), null)
})

test('changePassword needs a session, the current password and a strong new one', async () => {
    const { service, store } = await createService('correct horse battery')
    const token = await service.login('admin', 'correct horse battery', undefined, '1.2.3.4')

    await assert.rejects(
        service.changePassword('made-up-token', 'correct horse battery', 'fresh-secret-phrase-42', '1.2.3.4'),
        UnauthorizedError
    )
    await assert.rejects(
        service.changePassword(token, 'wrong password!', 'fresh-secret-phrase-42', '1.2.3.4'),
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
    assert.doesNotThrow(() => guard.checkOrigin({ method: 'POST', headers: { host: host, 'sec-fetch-site': 'same-origin' } }))
    assert.throws(() => guard.checkOrigin({ method: 'POST', headers: { host: host } }), ForbiddenError)

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

test('checkNewPassword rejects passwords that are long but easy to guess', () => {
    assert.throws(() => checkNewPassword('123456789012'), /easy to guess/)
    assert.throws(() => checkNewPassword('abcdefghijklmnop'), /simple sequence/)
    assert.throws(() => checkNewPassword('zyxwvutsrqponm'), /simple sequence/)
    assert.throws(() => checkNewPassword('aaaaaaaaaaaaaaaa'), /simple sequence/)
    assert.throws(() => checkNewPassword('abababababababab'), /same few characters/)
    assert.throws(() => checkNewPassword('MyPassword2026!!'), /easy to guess/)
    assert.throws(() => checkNewPassword('qwertyuiop[]asd'), /easy to guess/)
    assert.throws(() => checkNewPassword('lnxeasy-server-1'), /easy to guess/)
    assert.throws(() => checkNewPassword('elevenchars'), /at least 12/)
})

test('computeTotpCode matches the test values from RFC 6238', () => {
    const secret = encodeBase32(Buffer.from('12345678901234567890'))

    assert.equal(computeTotpCode(secret, getTimeStep(59 * 1000)), '287082')
    assert.equal(computeTotpCode(secret, getTimeStep(1111111109 * 1000)), '081804')
    assert.equal(computeTotpCode(secret, getTimeStep(1234567890 * 1000)), '005924')
    assert.equal(computeTotpCode(secret, getTimeStep(2000000000 * 1000)), '279037')
})

test('base32 text survives a round trip and ignores spaces and case', () => {
    const bytes = Buffer.from('12345678901234567890')
    const text = encodeBase32(bytes)

    assert.equal(text, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    assert.deepEqual(decodeBase32(text), bytes)
    assert.deepEqual(decodeBase32('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'), bytes)
    assert.throws(() => decodeBase32('not-base32!'), /Invalid base32/)
})

test('generateTotpSecret makes a new 32-character secret each time', () => {
    const first = generateTotpSecret()

    assert.equal(first.length, 32)
    assert.notEqual(first, generateTotpSecret())
    assert.equal(buildTotpUri(first, 'admin').startsWith('otpauth://totp/lnxeasy:admin?secret=' + first), true)
})

test('findTotpStep accepts the current code and its neighbours, nothing else', () => {
    const secret = generateTotpSecret()
    const nowMs = 1700000000000
    const step = getTimeStep(nowMs)

    assert.equal(findTotpStep(secret, computeTotpCode(secret, step), nowMs), step)
    assert.equal(findTotpStep(secret, computeTotpCode(secret, step - 1), nowMs), step - 1)
    assert.equal(findTotpStep(secret, computeTotpCode(secret, step + 1), nowMs), step + 1)
    assert.equal(findTotpStep(secret, computeTotpCode(secret, step - 2), nowMs), null)
    assert.equal(findTotpStep(secret, '12345', nowMs), null)
    assert.equal(findTotpStep(secret, 123456, nowMs), null)
    assert.equal(findTotpStep(secret, undefined, nowMs), null)
})

async function createServiceWithTwoStep() {
    const context = await createService('correct horse battery')
    context.clock.time = 1700000000000
    const token = await context.service.login('admin', 'correct horse battery', undefined, '1.2.3.4')
    const setup = await context.service.startTotpSetup(token, 'correct horse battery', '1.2.3.4')
    const code = computeTotpCode(setup.secret, getTimeStep(context.clock.time))

    await context.service.enableTotp(token, code, '1.2.3.4')
    context.secret = setup.secret
    context.token = token

    return context
}

test('two-step setup stores the secret only after a correct code', async () => {
    const context = await createService('correct horse battery')
    context.clock.time = 1700000000000
    const token = await context.service.login('admin', 'correct horse battery', undefined, '1.2.3.4')

    await assert.rejects(context.service.enableTotp(token, '000000', '1.2.3.4'), BadRequestError)
    await assert.rejects(context.service.startTotpSetup(token, 'wrong password!', '1.2.3.4'), InvalidCredentialsError)

    const setup = await context.service.startTotpSetup(token, 'correct horse battery', '1.2.3.4')
    assert.equal(context.store.account.totpSecret, null)
    assert.equal((await context.service.getStatus(token)).totpEnabled, false)

    const wrong = computeTotpCode(setup.secret, getTimeStep(context.clock.time) + 50)
    await assert.rejects(context.service.enableTotp(token, wrong, '1.2.3.4'), InvalidCodeError)
    assert.equal(context.store.account.totpSecret, null)

    await context.service.enableTotp(token, computeTotpCode(setup.secret, getTimeStep(context.clock.time)), '1.2.3.4')
    assert.equal(context.store.account.totpSecret, setup.secret)
    assert.deepEqual(await context.service.getStatus(token), { username: 'admin', totpEnabled: true })
})

test('login asks for the code when two-step sign-in is on', async () => {
    const { service, clock, secret } = await createServiceWithTwoStep()
    clock.time = clock.time + MINUTE

    await assert.rejects(service.login('admin', 'correct horse battery', undefined, '1.2.3.4'), TotpRequiredError)
    await assert.rejects(service.login('admin', 'correct horse battery', '', '1.2.3.4'), TotpRequiredError)
    await assert.rejects(service.login('admin', 'wrong password!', '123456', '1.2.3.4'), InvalidCredentialsError)
    await assert.rejects(service.login('admin', 'correct horse battery', '000000', '1.2.3.4'), InvalidCredentialsError)

    const code = computeTotpCode(secret, getTimeStep(clock.time))
    const token = await service.login('admin', 'correct horse battery', code, '1.2.3.4')
    assert.equal(service.getSession(token).username, 'admin')
})

test('a two-step code cannot be used twice', async () => {
    const { service, clock, secret } = await createServiceWithTwoStep()
    clock.time = clock.time + MINUTE
    const code = computeTotpCode(secret, getTimeStep(clock.time))

    await service.login('admin', 'correct horse battery', code, '1.2.3.4')

    await assert.rejects(service.login('admin', 'correct horse battery', code, '7.7.7.7'), InvalidCredentialsError)
})

test('wrong two-step codes lock the address out like wrong passwords', async () => {
    const { service, clock } = await createServiceWithTwoStep()
    clock.time = clock.time + MINUTE

    for (let i = 0; i < 5; i = i + 1) {
        await assert.rejects(service.login('admin', 'correct horse battery', '000000', '6.6.6.6'), InvalidCredentialsError)
    }

    await assert.rejects(service.login('admin', 'correct horse battery', '000000', '6.6.6.6'), TooManyAttemptsError)
})

test('turning two-step sign-in off needs the password', async () => {
    const { service, store, token } = await createServiceWithTwoStep()

    await assert.rejects(service.disableTotp(token, 'wrong password!', '1.2.3.4'), InvalidCredentialsError)
    assert.notEqual(store.account.totpSecret, null)

    await service.disableTotp(token, 'correct horse battery', '1.2.3.4')
    assert.equal(store.account.totpSecret, null)
    assert.notEqual(await service.login('admin', 'correct horse battery', undefined, '1.2.3.4'), null)
})

test('changing the password keeps two-step sign-in on', async () => {
    const { service, store, token, secret } = await createServiceWithTwoStep()

    await service.changePassword(token, 'correct horse battery', 'fresh-secret-phrase-42', '1.2.3.4')

    assert.equal(store.account.totpSecret, secret)
})

test('the service keeps a trail of sign-ins and failures without the passwords', async () => {
    const { service, logLines } = await createService('correct horse battery')

    await assert.rejects(service.login('admin', 'wrong password!', undefined, '6.6.6.6'), InvalidCredentialsError)
    const token = await service.login('admin', 'correct horse battery', undefined, '1.2.3.4')
    service.logout(token, '1.2.3.4')
    service.logout('made-up-token', '9.9.9.9')

    const events = service.listEvents()
    assert.deepEqual(events.map((event) => event.type + ' ' + event.address), [
        'logout 1.2.3.4',
        'login 1.2.3.4',
        'login_failed 6.6.6.6',
    ])
    assert.equal(typeof events[0].time, 'string')
    assert.deepEqual(logLines, [
        'auth login_failed address=6.6.6.6',
        'auth login address=1.2.3.4',
        'auth logout address=1.2.3.4',
    ])
    assert.equal(logLines.join(' ').includes('wrong password!'), false)
})

test('the trail notes when an address gets locked and stays short', async () => {
    const { service } = await createService('correct horse battery')

    for (let i = 0; i < 5; i = i + 1) {
        await assert.rejects(service.login('admin', 'wrong password!', undefined, '6.6.6.6'), InvalidCredentialsError)
    }
    assert.equal(service.listEvents()[0].type, 'address_locked')

    for (let i = 0; i < 80; i = i + 1) {
        service.record('login', '1.2.3.4')
    }
    assert.equal(service.listEvents().length, 50)
})

test('the service refuses to check more than four passwords at once', async () => {
    const { service } = await createService('correct horse battery')
    const attempts = []

    for (let i = 0; i < 6; i = i + 1) {
        attempts.push(service.login('admin', 'correct horse battery', undefined, '10.0.0.' + i))
    }
    const results = await Promise.allSettled(attempts)

    const busy = results.filter((result) => result.status === 'rejected' && result.reason instanceof ServiceBusyError)
    const signedIn = results.filter((result) => result.status === 'fulfilled')
    assert.equal(busy.length, 2)
    assert.equal(signedIn.length, 4)
    assert.notEqual(await service.login('admin', 'correct horse battery', undefined, '10.0.0.9'), null)
})

test('AuthStore keeps the two-step secret', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lnxeasy-test-'))
    const store = new AuthStore(path.join(directory, 'auth.json'), fs)

    await store.save({ username: 'admin', salt: 'aa', hash: 'bb', totpSecret: 'GEZDGNBVGY3TQOJQ' })
    assert.equal((await store.load()).totpSecret, 'GEZDGNBVGY3TQOJQ')

    await store.save({ username: 'admin', salt: 'aa', hash: 'bb', totpSecret: null })
    assert.equal((await store.load()).totpSecret, null)

    await fs.rm(directory, { recursive: true })
})

test('normalizeAddress turns an IPv4 address written as IPv6 back into IPv4', () => {
    assert.equal(normalizeAddress('::ffff:203.0.113.10'), '203.0.113.10')
    assert.equal(normalizeAddress('203.0.113.10'), '203.0.113.10')
    assert.equal(normalizeAddress('2001:db8::1'), '2001:db8::1')
    assert.equal(normalizeAddress(undefined), '')
})

test('checkAddressEntry accepts addresses and ranges and rejects the rest', () => {
    assert.doesNotThrow(() => checkAddressEntry('203.0.113.10'))
    assert.doesNotThrow(() => checkAddressEntry('203.0.113.0/24'))
    assert.doesNotThrow(() => checkAddressEntry('2001:db8::/32'))
    assert.throws(() => checkAddressEntry('example.com'), /Invalid address/)
    assert.throws(() => checkAddressEntry('203.0.113.0/33'), /Invalid address range/)
    assert.throws(() => checkAddressEntry('203.0.113.0/'), /Invalid address range/)
    assert.throws(() => checkAddressEntry('203.0.113.0/24/1'), /Invalid address/)
})

test('AddressFilter lets everyone in when the list is empty', () => {
    const filter = new AddressFilter([])

    assert.equal(filter.allows('198.51.100.7'), true)
    assert.equal(filter.allows('2001:db8::1'), true)
})

test('AddressFilter lets in only the listed addresses, not even this machine', () => {
    const filter = new AddressFilter(['203.0.113.10', '10.8.0.0/16', '2001:db8::/32'])

    assert.equal(filter.allows('203.0.113.10'), true)
    assert.equal(filter.allows('::ffff:203.0.113.10'), true)
    assert.equal(filter.allows('10.8.200.3'), true)
    assert.equal(filter.allows('2001:db8:1::5'), true)
    assert.equal(filter.allows('127.0.0.1'), false)
    assert.equal(filter.allows('::1'), false)

    assert.equal(filter.allows('203.0.113.11'), false)
    assert.equal(filter.allows('10.9.0.1'), false)
    assert.equal(filter.allows('2001:db9::1'), false)
    assert.equal(filter.allows(undefined), false)
    assert.equal(filter.allows('not an address'), false)
})

test('RequestLimiter stops one address after its limit and starts again next window', () => {
    const clock = createClock()
    const limiter = new RequestLimiter(3, MINUTE, clock.now)
    const noisy = { socket: { remoteAddress: '6.6.6.6' } }
    const quiet = { socket: { remoteAddress: '1.2.3.4' } }

    limiter.check(noisy)
    limiter.check(noisy)
    limiter.check(noisy)
    assert.throws(() => limiter.check(noisy), RateLimitedError)
    assert.doesNotThrow(() => limiter.check(quiet))

    clock.time = clock.time + MINUTE
    assert.doesNotThrow(() => limiter.check(noisy))
})

test('with two-step sign-in on, a missing code is asked for before the password is checked', async () => {
    const { service, logLines } = await createServiceWithTwoStep()
    const before = logLines.length

    await assert.rejects(service.login('admin', 'wrong password!', undefined, '6.6.6.6'), TotpRequiredError)
    await assert.rejects(service.login('admin', 'correct horse battery', undefined, '6.6.6.6'), TotpRequiredError)

    assert.equal(logLines.length, before)
})

test('with two-step sign-in on, a wrong password and a wrong code give the same answer', async () => {
    const { service, clock } = await createServiceWithTwoStep()
    clock.time = clock.time + MINUTE
    const answers = []

    for (const password of ['wrong password!', 'correct horse battery']) {
        try {
            await service.login('admin', password, '000000', '6.6.6.' + answers.length)
        } catch (error) {
            answers.push(error.code + ' ' + error.message)
        }
    }

    assert.deepEqual(answers, [
        'INVALID_CREDENTIALS Wrong username, password or code',
        'INVALID_CREDENTIALS Wrong username, password or code',
    ])
})

test('a used two-step code stays used after lnxeasy restarts', async () => {
    const { store, clock, secret } = await createServiceWithTwoStep()
    clock.time = clock.time + MINUTE
    const code = computeTotpCode(secret, getTimeStep(clock.time))

    const first = new AuthService(store, new SessionStore(60 * MINUTE, clock.now), new LoginLimiter(clock.now), clock.now, () => {})
    await first.login('admin', 'correct horse battery', code, '1.2.3.4')

    const afterRestart = new AuthService(store, new SessionStore(60 * MINUTE, clock.now), new LoginLimiter(clock.now), clock.now, () => {})
    await assert.rejects(afterRestart.login('admin', 'correct horse battery', code, '1.2.3.4'), InvalidCredentialsError)
    assert.equal(store.account.totpLastStep, getTimeStep(clock.time))
})

test('changing the password keeps the record of the last used code', async () => {
    const { service, store, token } = await createServiceWithTwoStep()
    const lastStep = store.account.totpLastStep

    await service.changePassword(token, 'correct horse battery', 'fresh-secret-phrase-42', '1.2.3.4')

    assert.equal(store.account.totpLastStep, lastStep)
    assert.notEqual(lastStep, 0)
})

test('AuthStore keeps the step of the last used code and ignores a broken value', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lnxeasy-test-'))
    const filePath = path.join(directory, 'auth.json')
    const store = new AuthStore(filePath, fs)

    await store.save({ username: 'admin', salt: 'aa', hash: 'bb', totpSecret: 'GEZDGNBV', totpLastStep: 56666666 })
    assert.equal((await store.load()).totpLastStep, 56666666)

    await fs.writeFile(filePath, '{"username":"admin","salt":"aa","hash":"bb","totpLastStep":"soon"}')
    assert.equal((await store.load()).totpLastStep, 0)

    await fs.rm(directory, { recursive: true })
})

test('AccessGuard refuses a write that carries no hint of where it comes from', () => {
    const guard = new AccessGuard({ getSession: () => null }, 'sid')

    assert.throws(
        () => guard.checkOrigin({ method: 'POST', headers: { host: '203.0.113.10:4321' } }),
        { code: 'FORBIDDEN', message: 'Requests that change something must say where they come from (Origin header)' }
    )
})
