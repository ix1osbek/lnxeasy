import {checkAddressEntry} from './http/address.js'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 4321
const MAX_PORT = 65535
const DEFAULT_AUTH_FILE = 'data/auth.json'


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

function readText(value, fallback) {
    if (value === undefined || value === '') {
        return fallback
    }

    return value
}

function readTls(env) {
    const certFile = readText(env.TLS_CERT_FILE, null)
    const keyFile = readText(env.TLS_KEY_FILE, null)

    if (certFile === null && keyFile === null) {
        return null
    }

    if (certFile === null || keyFile === null) {
        throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be set together.')
    }

    return {
        certFile: certFile,
        keyFile: keyFile
    }
}

function readAllowedAddresses(value) {
    const text = readText(value, '')
    const entries = []

    for (const part of text.split(',')) {
        const entry = part.trim()
        if (entry === '') {
            continue
        }

        try {
            checkAddressEntry(entry)
        } catch (e) {
            throw new Error('Invalid ALLOWED_IPS. ' + e.message)
        }

        entries.push(entry)
    }

    return entries
}

export function isLoopbackHost(host) {
    return host === 'localhost' || host === '::1' || host.startsWith('127.')
}

export function loadConfig(env) {
    return {
        host: readHost(env.HOST),
        port: readPort(env.PORT),
        authFile: readText(env.AUTH_FILE, DEFAULT_AUTH_FILE),
        tls: readTls(env),
        allowedAddresses: readAllowedAddresses(env.ALLOWED_IPS),
        allowInsecureHttp: env.ALLOW_INSECURE_HTTP === 'yes'
    }
}
