import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SystemService } from '../src/modules/system/system.service.js'

// A fake os module with fixed values, so the expected result is always the same.
function createFakeOs() {
    return {
        hostname: () => 'test-server',
        platform: () => 'linux',
        release: () => '6.8.0-test',
        arch: () => 'x64',
        uptime: () => 86400.57,
        cpus: () => [
            { model: 'Test CPU', speed: 2400 },
            { model: 'Test CPU', speed: 2400 },
        ],
        networkInterfaces: () => {
            return {
                lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
                eth0: [
                    { address: 'fe80::1', family: 'IPv6', internal: false },
                    { address: '203.0.113.10', family: 'IPv4', internal: false },
                ],
                docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
            }
        },
    }
}

const LOADAVG_TEXT = '0.50 0.74 0.87 1/2693 678368\n'

const MEMINFO_TEXT = [
    'MemTotal: 8000 kB',
    'MemFree: 1000 kB',
    'MemAvailable: 3000 kB',
    'SwapTotal: 2000 kB',
    'SwapFree: 500 kB',
    '',
].join('\n')

// A fake readFile: it never touches the disk and returns prepared text by path.
function createFakeReadFile() {
    return async (path, encoding) => {
        if (path === '/proc/loadavg') {
            return LOADAVG_TEXT
        }
        if (path === '/proc/meminfo') {
            return MEMINFO_TEXT
        }
        throw new Error(`Unexpected path: ${path}`)
    }
}

test('getInfo returns the full system information', async () => {
    const service = new SystemService(createFakeOs(), createFakeReadFile())

    const info = await service.getInfo()

    assert.deepEqual(info, {
        hostname: 'test-server',
        ipAddress: '203.0.113.10',
        platform: 'linux',
        release: '6.8.0-test',
        arch: 'x64',
        uptimeSeconds: 86400,
        cpu: { model: 'Test CPU', cores: 2 },
        loadAverage: { one: 0.5, five: 0.74, fifteen: 0.87 },
        memory: {
            totalBytes: 8000 * 1024,
            freeBytes: 1000 * 1024,
            availableBytes: 3000 * 1024,
            usedBytes: 5000 * 1024,
        },
        swap: {
            totalBytes: 2000 * 1024,
            freeBytes: 500 * 1024,
            usedBytes: 1500 * 1024,
        },
    })
})

test('getInfo reads the proc files as utf8 text', async () => {
    const calls = []
    const readFile = async (path, encoding) => {
        calls.push({ path: path, encoding: encoding })
        return createFakeReadFile()(path, encoding)
    }
    const service = new SystemService(createFakeOs(), readFile)

    await service.getInfo()

    assert.deepEqual(calls, [
        { path: '/proc/loadavg', encoding: 'utf8' },
        { path: '/proc/meminfo', encoding: 'utf8' },
    ])
})

test('getInfo calculates used memory from total and available, not free', async () => {
    const service = new SystemService(createFakeOs(), createFakeReadFile())

    const info = await service.getInfo()

    assert.equal(info.memory.usedBytes, (8000 - 3000) * 1024)
})

test('getInfo rounds the uptime down to whole seconds', async () => {
    const fakeOs = createFakeOs()
    fakeOs.uptime = () => 59.99
    const service = new SystemService(fakeOs, createFakeReadFile())

    const info = await service.getInfo()

    assert.equal(info.uptimeSeconds, 59)
})

test('getInfo does not fail when the cpu list is empty', async () => {
    const fakeOs = createFakeOs()
    fakeOs.cpus = () => []
    const service = new SystemService(fakeOs, createFakeReadFile())

    const info = await service.getInfo()

    assert.deepEqual(info.cpu, { model: 'unknown', cores: 0 })
})

// assert.rejects is the async version of assert.throws.
test('getInfo fails when a proc file cannot be read', async () => {
    const readFile = async () => {
        throw new Error('ENOENT: no such file or directory')
    }
    const service = new SystemService(createFakeOs(), readFile)

    await assert.rejects(() => service.getInfo(), {
        message: 'ENOENT: no such file or directory',
    })
})

test('getInfo fails when a proc file has unexpected content', async () => {
    const readFile = async () => 'not a proc file'
    const service = new SystemService(createFakeOs(), readFile)

    await assert.rejects(() => service.getInfo(), Error)
})

test('getInfo picks the first IPv4 address that is not internal', async () => {
    const service = new SystemService(createFakeOs(), createFakeReadFile())

    const info = await service.getInfo()

    assert.equal(info.ipAddress, '203.0.113.10')
})

test('getInfo returns null as the IP address when only loopback exists', async () => {
    const fakeOs = createFakeOs()
    fakeOs.networkInterfaces = () => {
        return { lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] }
    }
    const service = new SystemService(fakeOs, createFakeReadFile())

    const info = await service.getInfo()

    assert.equal(info.ipAddress, null)
})
