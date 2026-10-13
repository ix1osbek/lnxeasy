import {createHmac, randomBytes} from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const SECRET_BYTES = 20
const STEP_SECONDS = 30
const DIGITS = 6
const ALLOWED_DRIFT_STEPS = 1

export function encodeBase32(buffer) {
    let bits = ''
    for (const byte of buffer) {
        bits = bits + byte.toString(2).padStart(8, '0')
    }

    let text = ''
    for (let index = 0; index < bits.length; index = index + 5) {
        const chunk = bits.slice(index, index + 5).padEnd(5, '0')
        text = text + BASE32_ALPHABET[parseInt(chunk, 2)]
    }

    return text
}

export function decodeBase32(text) {
    const cleaned = text.toUpperCase().replaceAll(' ', '').replaceAll('=', '')

    let bits = ''
    for (const character of cleaned) {
        const value = BASE32_ALPHABET.indexOf(character)
        if (value === -1) {
            throw new Error('Invalid base32 text')
        }
        bits = bits + value.toString(2).padStart(5, '0')
    }

    const bytes = []
    for (let index = 0; index + 8 <= bits.length; index = index + 8) {
        bytes.push(parseInt(bits.slice(index, index + 8), 2))
    }

    return Buffer.from(bytes)
}

export function generateTotpSecret() {
    return encodeBase32(randomBytes(SECRET_BYTES))
}

export function getTimeStep(nowMs) {
    return Math.floor(nowMs / 1000 / STEP_SECONDS)
}

export function computeTotpCode(secret, timeStep) {
    const counter = Buffer.alloc(8)
    counter.writeBigUInt64BE(BigInt(timeStep))

    const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest()
    const offset = digest[digest.length - 1] & 0x0f
    const number = digest.readUInt32BE(offset) & 0x7fffffff

    return String(number % (10 ** DIGITS)).padStart(DIGITS, '0')
}

export function findTotpStep(secret, code, nowMs) {
    if (typeof code !== 'string') {
        return null
    }

    const cleaned = code.replaceAll(' ', '')
    if (cleaned.length !== DIGITS) {
        return null
    }

    const currentStep = getTimeStep(nowMs)

    for (let drift = -ALLOWED_DRIFT_STEPS; drift <= ALLOWED_DRIFT_STEPS; drift = drift + 1) {
        if (computeTotpCode(secret, currentStep + drift) === cleaned) {
            return currentStep + drift
        }
    }

    return null
}

export function buildTotpUri(secret, username) {
    return 'otpauth://totp/lnxeasy:' + encodeURIComponent(username) +
        '?secret=' + secret + '&issuer=lnxeasy&algorithm=SHA1&digits=' + DIGITS + '&period=' + STEP_SECONDS
}
