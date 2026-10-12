const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 4321
const MAX_PORT = 65535


function readHost(value) {
    if (value === undefined || value === '') {
        return DEFAULT_HOST
    }

    return value
}

function readPort(value) {
    if (value === undefined || value === '') {
        return DEFAULT_PORT
    }

    const port = Number(value)
    if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
        throw new Error(`Invalid PORT "${value}". Expected a whole number from 0 to ${MAX_PORT}.`)
    }

    return port
}

export function loadConfig(env) {
    return Object.freeze({
        host: readHost(env.HOST),
        port: readPort(env.PORT)
    })
}