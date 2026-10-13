import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PortsService } from '../src/modules/ports/ports.service.js'
import { CommandNotFoundError } from '../src/core/errors.js'

const SS_TEXT = [
    'udp UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:*',
    'tcp LISTEN 0 511 127.0.0.1:4321 0.0.0.0:* users:(("node",pid=100,fd=29))',
    '',
].join('\n')

// A fake source: answers with fixed text instead of asking the system.
function createFakeSource(text) {
    const source = { reads: 0 }
    source.read = async () => {
        source.reads = source.reads + 1
        return text
    }
    return source
}

test('list reads the source once', async () => {
    const source = createFakeSource(SS_TEXT)
    const service = new PortsService(source)

    await service.list()

    assert.equal(source.reads, 1)
})

test('list returns the parsed ports', async () => {
    const service = new PortsService(createFakeSource(SS_TEXT))

    const ports = await service.list()

    assert.deepEqual(ports, [
        { protocol: 'udp', state: 'UNCONN', address: '127.0.0.53%lo', port: 53, processes: [] },
        { protocol: 'tcp', state: 'LISTEN', address: '127.0.0.1', port: 4321, processes: [{ name: 'node', pid: 100 }] },
    ])
})

test('list returns an empty list when nothing is listening', async () => {
    const service = new PortsService(createFakeSource(''))

    assert.deepEqual(await service.list(), [])
})

test('list lets an error from the source pass through', async () => {
    const source = {
        read: async () => {
            throw new CommandNotFoundError('ss')
        },
    }
    const service = new PortsService(source)

    await assert.rejects(service.list(), (error) => {
        assert.equal(error instanceof CommandNotFoundError, true)
        return true
    })
})

test('list fails when the source gives something unexpected', async () => {
    const service = new PortsService(createFakeSource('this is not ss output\n'))

    await assert.rejects(service.list(), {
        message: 'Unexpected ss output: this is not ss output',
    })
})
