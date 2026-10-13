export function parsePorts(text) {
    const ports = []
    const lines = text.split('\n')

    for (const line of lines) {
        if (line.trim() === '') {
            continue
        }

        ports.push(parsePortLine(line))
    }

    return ports
}

function parsePortLine(line) {
    const columns = line.trim().split(/\s+/)

    if (columns.length < 6) {
        throw new Error(`Unexpected ss output: ${line}`)
    }
    const localAddress = columns[4]
    const separatorIdx = localAddress.lastIndexOf(':')
    if (separatorIdx === -1) {
        throw new Error(`Unexpected ss output: ${line}`)
    }
    const address = localAddress.slice(0, separatorIdx)
    const port = Number(localAddress.slice(separatorIdx + 1))
    if (!Number.isInteger(port)) {
        throw new Error(`Unexpected ss output: ${line}`)
    }

    return {
        protocol: columns[0],
        state: columns[1],
        address: address,
        port: port,
        processes: readProcesses(line)
    }
}

function readProcesses(line) {
    const processes = []
    let position = line.indexOf('("')

    while (position !== -1) {
        const nameStart = position + 2
        const nameEnd = line.indexOf('"', nameStart)
        const pidLabel = line.indexOf('pid=', nameEnd)
        const pidEnd = line.indexOf(',', pidLabel)

        if (nameEnd === -1 || pidLabel === -1 || pidEnd === -1) {
            throw new Error(`Unexpected ss output: ${line}`)
        }
        const pid = Number(line.slice(pidLabel + 4, pidEnd))
        if (!Number.isInteger(pid)) {
            throw new Error(`Unexpected ss output: ${line}`)
        }

        processes.push({
            name: line.slice(nameStart, nameEnd),
            pid: pid
        })

        position = line.indexOf('("', pidEnd)

    }

    return processes
}