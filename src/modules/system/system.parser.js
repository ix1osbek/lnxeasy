export function parseLoadAverage(text) {
    const parts = text.trim().split(' ')

    const one = Number(parts[0])
    const five = Number(parts[1])
    const fifteen = Number(parts[2])

    if (Number.isNaN(one) || Number.isNaN(five) || Number.isNaN(fifteen)) {
        throw new Error('Unexpected /proc/loadavg content')
    }

    return {
        one,
        five,
        fifteen
    }
}

export function parseMemInfo(text) {
    const values = {}

    const lines = text.split('\n')

    for (const line of lines) {
        const colonIndex = line.indexOf(':')
        if (colonIndex === -1) {
            continue
        }
        const name = line.slice(0, colonIndex)
        const rest = line.slice(colonIndex + 1).trim()
        const firstWord = rest.split(' ')[0]
        values[name] = Number(firstWord)
    }

    return {
        totalBytes: readKilobytesAsBytes(values, 'MemTotal'),
        freeBytes: readKilobytesAsBytes(values, 'MemFree'),
        availableBytes: readKilobytesAsBytes(values, 'MemAvailable'),
        swapTotalBytes: readKilobytesAsBytes(values, 'SwapTotal'),
        swapFreeBytes: readKilobytesAsBytes(values, 'SwapFree'),
    }
}

function readKilobytesAsBytes(values, name) {
    const kilobytes = values[name]
    if (kilobytes === undefined || Number.isNaN(kilobytes)) {
        throw new Error(`Unexpected /proc/meminfo content: ${name} is missing`)
    }

    return kilobytes * 1024
}