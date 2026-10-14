import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { readSocket, SocketUnavailableError } from '../src/core/socket.js'
import { PortsSource } from '../src/modules/ports/ports.source.js'
import { AddressFilter, ClientPolicy, isLoopback, readClientAddress } from '../src/http/address.js'
import { loadConfig } from '../src/config.js'

const SS_TEXT = 'tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=900,fd=3))\n'

// Starts a real unix socket server in a temporary directory and stops it after the test.
async function startSocketServer(t, onConnection) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lnxeasy-test-'))
    const socketPath = path.join(directory, 'helper.sock')
    const server = net.createServer(onConnection)

    await new Promise((resolve) => server.listen(socketPath, resolve))

    t.after(async () => {
        await new Promise((resolve) => server.close(resolve))
        await fs.rm(directory, { recursive: true })
    })

    return socketPath
}

test('readSocket returns everything the other side wrote before it closed', async (t) => {
    const socketPath = await startSocketServer(t, (socket) => {
        socket.write('first part, ')
        socket.end('second part')
    })

    assert.equal(await readSocket(socketPath), 'first part, second part')
})

test('readSocket fails with SocketUnavailableError when nothing listens there', async () => {
    await assert.rejects(readSocket('/nonexistent/lnxeasy/helper.sock'), SocketUnavailableError)
})

test('readSocket gives up when the other side never answers', async (t) => {
    const open = []
    const socketPath = await startSocketServer(t, (socket) => {
        open.push(socket)
    })
    t.after(() => {
        for (const socket of open) {
            socket.destroy()
        }
    })

    await assert.rejects(readSocket(socketPath, 100), /no answer in 100 ms/)
})

// A fake run that counts its calls.
function createFakeRun() {
    const fake = { calls: [] }
    fake.run = async (command, args) => {
        fake.calls.push({ command: command, args: args })
        return { stdout: 'tcp LISTEN 0 128 0.0.0.0:80 0.0.0.0:*\n', stderr: '' }
    }
    return fake
}

test('PortsSource runs ss itself when no helper is configured', async () => {
    const fake = createFakeRun()
    const source = new PortsSource(fake.run, async () => SS_TEXT, null)

    const text = await source.read()

    assert.equal(text, 'tcp LISTEN 0 128 0.0.0.0:80 0.0.0.0:*\n')
    assert.deepEqual(fake.calls, [{ command: 'ss', args: ['-tulpnH'] }])
})

test('PortsSource prefers the helper and does not run ss when it answers', async () => {
    const fake = createFakeRun()
    const asked = []
    const readSocket = async (socketPath) => {
        asked.push(socketPath)
        return SS_TEXT
    }
    const source = new PortsSource(fake.run, readSocket, '/run/lnxeasy/helper.sock')

    assert.equal(await source.read(), SS_TEXT)
    assert.deepEqual(asked, ['/run/lnxeasy/helper.sock'])
    assert.deepEqual(fake.calls, [])
})

test('PortsSource falls back to ss when the helper is unavailable or silent', async () => {
    const unavailable = createFakeRun()
    const failing = async (socketPath) => {
        throw new SocketUnavailableError(socketPath, 'ENOENT')
    }
    await new PortsSource(unavailable.run, failing, '/run/lnxeasy/helper.sock').read()
    assert.equal(unavailable.calls.length, 1)

    const silent = createFakeRun()
    await new PortsSource(silent.run, async () => '  \n', '/run/lnxeasy/helper.sock').read()
    assert.equal(silent.calls.length, 1)
})

test('PortsSource does not hide an unexpected error from the helper', async () => {
    const fake = createFakeRun()
    const broken = async () => {
        throw new TypeError('bug')
    }
    const source = new PortsSource(fake.run, broken, '/run/lnxeasy/helper.sock')

    await assert.rejects(source.read(), TypeError)
})

function createRequest(remoteAddress, forwardedFor) {
    const req = { socket: { remoteAddress: remoteAddress }, headers: {} }
    if (forwardedFor !== undefined) {
        req.headers['x-forwarded-for'] = forwardedFor
    }
    return req
}

test('ClientPolicy ignores X-Forwarded-For when no proxy is trusted', () => {
    const policy = new ClientPolicy(new AddressFilter([]), [])

    assert.equal(policy.identify(createRequest('198.51.100.9', '203.0.113.5')), '198.51.100.9')
    assert.equal(policy.identify(createRequest('127.0.0.1', '203.0.113.5')), '127.0.0.1')
})

test('ClientPolicy takes the address the trusted proxy added, not what the visitor claimed', () => {
    const policy = new ClientPolicy(new AddressFilter([]), ['127.0.0.1'])

    assert.equal(policy.identify(createRequest('127.0.0.1', '203.0.113.5')), '203.0.113.5')
    assert.equal(policy.identify(createRequest('::ffff:127.0.0.1', '10.0.0.1, 203.0.113.5')), '203.0.113.5')
    assert.equal(policy.identify(createRequest('127.0.0.1', '203.0.113.5, ::ffff:198.51.100.7')), '198.51.100.7')
})

test('ClientPolicy does not believe X-Forwarded-For from an address that is not a trusted proxy', () => {
    const policy = new ClientPolicy(new AddressFilter([]), ['127.0.0.1', '172.16.0.0/12'])

    assert.equal(policy.identify(createRequest('198.51.100.9', '203.0.113.5')), '198.51.100.9')
    assert.equal(policy.identify(createRequest('172.18.0.3', '203.0.113.5')), '203.0.113.5')
})

test('ClientPolicy cannot tell the visitor when the trusted proxy sends no usable header', () => {
    const policy = new ClientPolicy(new AddressFilter([]), ['127.0.0.1'])

    assert.equal(policy.identify(createRequest('127.0.0.1')), null)
    assert.equal(policy.identify(createRequest('127.0.0.1', 'unknown')), null)
    assert.equal(policy.identify(createRequest('127.0.0.1', '203.0.113.5, <script>')), null)
})

test('ClientPolicy lets this machine connect, so that the health check works with an address list', () => {
    const policy = new ClientPolicy(new AddressFilter(['203.0.113.5']), [])

    assert.equal(policy.allowsConnection('127.0.0.1'), true)
    assert.equal(policy.allowsConnection('::ffff:127.0.0.1'), true)
    assert.equal(policy.allowsConnection('::1'), true)
    assert.equal(policy.allows('127.0.0.1'), false)
})

test('isLoopback recognises only this machine', () => {
    assert.equal(isLoopback('127.0.0.1'), true)
    assert.equal(isLoopback('127.8.8.8'), true)
    assert.equal(isLoopback('::ffff:127.0.0.1'), true)
    assert.equal(isLoopback('::1'), true)
    assert.equal(isLoopback('127.example.com'), false)
    assert.equal(isLoopback('10.0.0.1'), false)
    assert.equal(isLoopback(undefined), false)
})

test('ClientPolicy applies the address list to the real client behind a proxy', () => {
    const policy = new ClientPolicy(new AddressFilter(['203.0.113.5']), ['172.18.0.3'])

    assert.equal(policy.allowsConnection('172.18.0.3'), true)
    assert.equal(policy.allowsConnection('198.51.100.9'), false)
    assert.equal(policy.allowsConnection('203.0.113.5'), true)

    assert.equal(policy.allows(policy.identify(createRequest('172.18.0.3', '203.0.113.5'))), true)
    assert.equal(policy.allows(policy.identify(createRequest('172.18.0.3', '198.51.100.9'))), false)
})

test('readClientAddress prefers the address that was already worked out for the request', () => {
    assert.equal(readClientAddress({ clientAddress: '203.0.113.5', socket: { remoteAddress: '127.0.0.1' } }), '203.0.113.5')
    assert.equal(readClientAddress({ socket: { remoteAddress: '::ffff:198.51.100.9' } }), '198.51.100.9')
})

test('loadConfig reads the proxy list and the helper socket', () => {
    const config = loadConfig({ TRUSTED_PROXIES: '127.0.0.1, 172.16.0.0/12', HELPER_SOCKET: '/run/lnxeasy/helper.sock' })

    assert.deepEqual(config.trustedProxies, ['127.0.0.1', '172.16.0.0/12'])
    assert.equal(config.helperSocket, '/run/lnxeasy/helper.sock')
    assert.deepEqual(loadConfig({}).trustedProxies, [])
    assert.equal(loadConfig({}).helperSocket, null)
    assert.throws(() => loadConfig({ TRUSTED_PROXIES: 'nginx' }), /Invalid TRUSTED_PROXIES/)
})
