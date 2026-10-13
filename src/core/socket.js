import net from 'node:net'

const DEFAULT_TIMEOUT_MS = 5000
const MAX_BYTES = 5 * 1024 * 1024

export class SocketUnavailableError extends Error {
    constructor(socketPath, reason) {
        super('Cannot read from ' + socketPath + ': ' + reason)
        this.name = 'SocketUnavailableError'
    }
}

export function readSocket(socketPath, timeoutMs) {
    let timeout = DEFAULT_TIMEOUT_MS
    if (timeoutMs !== undefined) {
        timeout = timeoutMs
    }

    return new Promise((resolve, reject) => {
        const chunks = []
        let size = 0
        let finished = false

        const socket = net.createConnection({path: socketPath})

        function fail(reason) {
            if (finished) {
                return
            }

            finished = true
            socket.destroy()
            reject(new SocketUnavailableError(socketPath, reason))
        }

        socket.setTimeout(timeout, () => {
            fail('no answer in ' + timeout + ' ms')
        })

        socket.on('data', (chunk) => {
            size = size + chunk.length
            if (size > MAX_BYTES) {
                fail('the answer is too large')
                return
            }

            chunks.push(chunk)
        })

        socket.on('error', (error) => {
            fail(error.code)
        })

        socket.on('end', () => {
            if (finished) {
                return
            }

            finished = true
            resolve(Buffer.concat(chunks).toString('utf8'))
        })
    })
}
