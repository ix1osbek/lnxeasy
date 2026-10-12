import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLoadAverage, parseMemInfo } from '../src/modules/system/system.parser.js'

test('parseLoadAverage reads the three load values', () => {
    const result = parseLoadAverage('0.50 0.74 0.87 1/2693 678368\n')

    assert.deepEqual(result, { one: 0.5, five: 0.74, fifteen: 0.87 })
})

test('parseLoadAverage works without a trailing newline', () => {
    const result = parseLoadAverage('1.00 2.00 3.00 2/100 42')

    assert.deepEqual(result, { one: 1, five: 2, fifteen: 3 })
})

test('parseLoadAverage reads loads above the number of cores', () => {
    const result = parseLoadAverage('12.35 8.10 4.02 5/900 1234\n')

    assert.deepEqual(result, { one: 12.35, five: 8.1, fifteen: 4.02 })
})

test('parseLoadAverage throws on empty text', () => {
    assert.throws(() => parseLoadAverage(''), {
        message: 'Unexpected /proc/loadavg content',
    })
})

test('parseLoadAverage throws when a value is not a number', () => {
    assert.throws(() => parseLoadAverage('abc 0.74 0.87 1/2693 678368\n'), Error)
})

test('parseLoadAverage throws when values are missing', () => {
    assert.throws(() => parseLoadAverage('0.50 0.74\n'), Error)
})

// A shortened copy of a real /proc/meminfo, including lines the parser must ignore.
const MEMINFO_TEXT = [
    'MemTotal:       16153476 kB',
    'MemFree:          256480 kB',
    'MemAvailable:    3931248 kB',
    'Buffers:          123992 kB',
    'Cached:          3532220 kB',
    'SwapTotal:       2097148 kB',
    'SwapFree:        1048576 kB',
    'HugePages_Total:       0',
    '',
].join('\n')

test('parseMemInfo reads memory and swap sizes in bytes', () => {
    const result = parseMemInfo(MEMINFO_TEXT)

    assert.deepEqual(result, {
        totalBytes: 16153476 * 1024,
        freeBytes: 256480 * 1024,
        availableBytes: 3931248 * 1024,
        swapTotalBytes: 2097148 * 1024,
        swapFreeBytes: 1048576 * 1024,
    })
})

test('parseMemInfo does not depend on the order of the lines', () => {
    const text = [
        'SwapFree: 5 kB',
        'MemAvailable: 3 kB',
        'SwapTotal: 4 kB',
        'MemFree: 2 kB',
        'MemTotal: 1 kB',
    ].join('\n')

    const result = parseMemInfo(text)

    assert.deepEqual(result, {
        totalBytes: 1024,
        freeBytes: 2048,
        availableBytes: 3072,
        swapTotalBytes: 4096,
        swapFreeBytes: 5120,
    })
})

test('parseMemInfo accepts zero swap', () => {
    const text = 'MemTotal: 10 kB\nMemFree: 5 kB\nMemAvailable: 7 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n'

    const result = parseMemInfo(text)

    assert.equal(result.swapTotalBytes, 0)
    assert.equal(result.swapFreeBytes, 0)
})

test('parseMemInfo throws on empty text', () => {
    assert.throws(() => parseMemInfo(''), {
        message: 'Unexpected /proc/meminfo content: MemTotal is missing',
    })
})

test('parseMemInfo names the field that is missing', () => {
    const text = 'MemTotal: 10 kB\nMemFree: 5 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n'

    assert.throws(() => parseMemInfo(text), {
        message: 'Unexpected /proc/meminfo content: MemAvailable is missing',
    })
})

test('parseMemInfo throws when a value is not a number', () => {
    const text = 'MemTotal: abc kB\nMemFree: 5 kB\nMemAvailable: 7 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n'

    assert.throws(() => parseMemInfo(text), Error)
})
