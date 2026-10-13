const STATE_NAMES = {
    R: 'running',
    S: 'sleeping',
    D: 'waiting for disk',
    Z: 'zombie',
    T: 'stopped',
    t: 'traced',
    I: 'idle',
    X: 'dead'
}

export function parseProcessStat(text) {
    const nameStart = text.indexOf('(')
    const nameEnd = text.lastIndexOf(')')

    if (nameStart === -1 || nameEnd === -1 || nameEnd < nameStart) {
        throw new Error('Unexpected /proc/<pid>/stat content')
    }

    const pid = Number(text.slice(0, nameStart).trim())
    const fields = text.slice(nameEnd + 1).trim().split(' ')

    if (!Number.isInteger(pid) || fields.length < 20) {
        throw new Error('Unexpected /proc/<pid>/stat content')
    }

    const stateCode = fields[0]
    let state = STATE_NAMES[stateCode]
    if (state === undefined) {
        state = stateCode
    }

    return {
        pid: pid,
        name: text.slice(nameStart + 1, nameEnd),
        state: state,
        parentPid: Number(fields[1]),
        cpuTicks: Number(fields[11]) + Number(fields[12]),
        nice: Number(fields[16]),
        threads: Number(fields[17]),
        startTicks: Number(fields[19])
    }
}

function readStatusValue(text, name) {
    for (const line of text.split('\n')) {
        if (line.startsWith(name + ':')) {
            return line.slice(name.length + 1).trim()
        }
    }

    return null
}

export function parseProcessStatus(text) {
    const uidLine = readStatusValue(text, 'Uid')
    if (uidLine === null) {
        throw new Error('Unexpected /proc/<pid>/status content: Uid is missing')
    }

    const uid = Number(uidLine.split(/\s+/)[0])
    if (!Number.isInteger(uid)) {
        throw new Error('Unexpected /proc/<pid>/status content: Uid is not a number')
    }

    let memoryBytes = 0
    const memoryLine = readStatusValue(text, 'VmRSS')
    if (memoryLine !== null) {
        const kilobytes = Number(memoryLine.split(/\s+/)[0])
        if (Number.isInteger(kilobytes)) {
            memoryBytes = kilobytes * 1024
        }
    }

    return {
        uid: uid,
        memoryBytes: memoryBytes
    }
}

export function parseCommandLine(text) {
    return text.split('\0').join(' ').trim()
}

function parseCpuLine(line) {
    const parts = line.trim().split(/\s+/)
    let total = 0

    for (let index = 1; index <= 8 && index < parts.length; index = index + 1) {
        total = total + Number(parts[index])
    }

    const idle = Number(parts[4]) + Number(parts[5])

    return {
        name: parts[0],
        totalTicks: total,
        busyTicks: total - idle
    }
}

export function parseCpuTimes(text) {
    let all = null
    let bootTime = null
    const cores = []

    for (const line of text.split('\n')) {
        if (line.startsWith('cpu ')) {
            all = parseCpuLine(line)
        } else if (line.startsWith('cpu')) {
            cores.push(parseCpuLine(line))
        } else if (line.startsWith('btime ')) {
            bootTime = Number(line.slice(6).trim())
        }
    }

    if (all === null || bootTime === null || !Number.isInteger(bootTime)) {
        throw new Error('Unexpected /proc/stat content')
    }

    return {
        bootTime: bootTime,
        all: all,
        cores: cores
    }
}

export function parseUserNames(text) {
    const names = new Map()

    for (const line of text.split('\n')) {
        const parts = line.split(':')
        if (parts.length < 3) {
            continue
        }

        const uid = Number(parts[2])
        if (parts[0] !== '' && Number.isInteger(uid) && !names.has(uid)) {
            names.set(uid, parts[0])
        }
    }

    return names
}
