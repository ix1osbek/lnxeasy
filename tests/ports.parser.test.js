import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePorts } from '../src/modules/ports/ports.parser.js'

test('parsePorts reads protocol, state, address and port', () => {
    const ports = parsePorts('tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\n')

    assert.deepEqual(ports, [
        { protocol: 'tcp', state: 'LISTEN', address: '0.0.0.0', port: 22, processes: [] },
    ])
})

test('parsePorts reads the process that holds the port', () => {
    const ports = parsePorts('tcp LISTEN 0 511 127.0.0.1:4321 0.0.0.0:* users:(("node",pid=216472,fd=29))\n')

    assert.deepEqual(ports[0].processes, [{ name: 'node', pid: 216472 }])
})

test('parsePorts reads every process when several share one port', () => {
    const ports = parsePorts('tcp LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=7,fd=6),("nginx",pid=8,fd=6))\n')

    assert.deepEqual(ports[0].processes, [
        { name: 'nginx', pid: 7 },
        { name: 'nginx', pid: 8 },
    ])
})

test('parsePorts keeps a process name that contains a space', () => {
    const ports = parsePorts('udp UNCONN 0 0 0.0.0.0:5353 0.0.0.0:* users:(("Web Content",pid=42,fd=3))\n')

    assert.deepEqual(ports[0].processes, [{ name: 'Web Content', pid: 42 }])
})

test('parsePorts returns an empty process list when ss shows no process', () => {
    const ports = parsePorts('udp UNCONN 0 0 0.0.0.0:68 0.0.0.0:*\n')

    assert.deepEqual(ports[0].processes, [])
})

test('parsePorts splits an IPv6 address at the last colon', () => {
    const ports = parsePorts('tcp LISTEN 0 4096 [::]:22 [::]:*\n')

    assert.equal(ports[0].address, '[::]')
    assert.equal(ports[0].port, 22)
})

test('parsePorts keeps the interface name and the wildcard address', () => {
    const text = [
        'udp UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:*',
        'udp UNCONN 0 0 *:1716 *:*',
    ].join('\n')

    const ports = parsePorts(text)

    assert.equal(ports[0].address, '127.0.0.53%lo')
    assert.equal(ports[0].port, 53)
    assert.equal(ports[1].address, '*')
    assert.equal(ports[1].port, 1716)
})

test('parsePorts handles columns padded with many spaces', () => {
    const ports = parsePorts('tcp   LISTEN 0      4096                 0.0.0.0:9428  0.0.0.0:*           \n')

    assert.deepEqual(ports, [
        { protocol: 'tcp', state: 'LISTEN', address: '0.0.0.0', port: 9428, processes: [] },
    ])
})

test('parsePorts returns one entry per line and skips empty lines', () => {
    const text = [
        'tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:*',
        '',
        'udp UNCONN 0 0 0.0.0.0:68 0.0.0.0:*',
        '',
    ].join('\n')

    const ports = parsePorts(text)

    assert.equal(ports.length, 2)
    assert.equal(ports[0].port, 22)
    assert.equal(ports[1].port, 68)
})

test('parsePorts returns an empty list for empty text', () => {
    assert.deepEqual(parsePorts(''), [])
})

test('parsePorts throws when a line has too few columns', () => {
    assert.throws(() => parsePorts('not ss output'), {
        message: 'Unexpected ss output: not ss output',
    })
})

test('parsePorts throws when the local address has no port', () => {
    assert.throws(() => parsePorts('tcp LISTEN 0 128 localhost 0.0.0.0:*'), {
        message: 'Unexpected ss output: tcp LISTEN 0 128 localhost 0.0.0.0:*',
    })
})

test('parsePorts throws when the port is not a number', () => {
    assert.throws(() => parsePorts('tcp LISTEN 0 128 0.0.0.0:ssh 0.0.0.0:*'), {
        message: 'Unexpected ss output: tcp LISTEN 0 128 0.0.0.0:ssh 0.0.0.0:*',
    })
})

test('parsePorts throws when the process part is cut off', () => {
    assert.throws(() => parsePorts('tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd,pid=9'), {
        message: 'Unexpected ss output: tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd,pid=9',
    })
})
