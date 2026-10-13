import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PortsService } from '../src/modules/ports/ports.service.js'
import { CommandNotFoundError } from '../src/core/errors.js'

const SS_TEXT = [
    'udp UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:*',
    'tcp LISTEN 0 511 127.0.0.1:4321 0.0.0.0:* users:(("node",pid=100,fd=29))',
    '',
].join('\n')

// A fake run: remembers how it was called and answers with fixed text instead of starting ss.
function createFakeRun(stdout) {
    const calls = []

    const run = async (command, args) => {
        calls.push({ command: command, args: args })
        return { stdout: stdout, stderr: '' }
    }

    return { run: run, calls: calls }
}

test('list runs ss once with the listening sockets flags', async () => {
    const fake = createFakeRun(SS_TEXT)
    const service = new PortsService(fake.run)

    await service.list()

    assert.deepEqual(fake.calls, [{ command: 'ss', args: ['-tulpnH'] }])
})

test('list returns the parsed ports', async () => {
    const fake = createFakeRun(SS_TEXT)
    const service = new PortsService(fake.run)

    const ports = await service.list()

    assert.deepEqual(ports, [
        { protocol: 'udp', state: 'UNCONN', address: '127.0.0.53%lo', port: 53, processes: [] },
        { protocol: 'tcp', state: 'LISTEN', address: '127.0.0.1', port: 4321, processes: [{ name: 'node', pid: 100 }] },
    ])
})

test('list returns an empty list when nothing is listening', async () => {
    const fake = createFakeRun('')
    const service = new PortsService(fake.run)

    assert.deepEqual(await service.list(), [])
})

test('list lets an error from run pass through', async () => {
    const run = async () => {
        throw new CommandNotFoundError('ss')
    }
    const service = new PortsService(run)

    await assert.rejects(service.list(), (error) => {
        assert.equal(error instanceof CommandNotFoundError, true)
        return true
    })
})

test('list fails when ss prints something unexpected', async () => {
    const fake = createFakeRun('this is not ss output\n')
    const service = new PortsService(fake.run)

    await assert.rejects(service.list(), {
        message: 'Unexpected ss output: this is not ss output',
    })
})
