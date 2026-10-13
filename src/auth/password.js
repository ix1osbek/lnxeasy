import {randomBytes, randomInt, scrypt, timingSafeEqual} from 'node:crypto'
import {BadRequestError} from '../core/errors.js'

const SALT_BYTES = 16
const KEY_BYTES = 64
const SCRYPT_OPTIONS = {N: 16384, r: 8, p: 1}

const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 200
const MIN_DISTINCT_CHARACTERS = 6

const WEAK_WORDS = [
    'password', 'parol', 'qwerty', 'admin', 'lnxeasy', 'letmein', 'welcome', 'iloveyou',
    '123456', '654321', 'abcdef', 'asdfgh', 'zxcvbn', '111111', '000000'
]

const GENERATED_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const GENERATED_GROUPS = 4
const GENERATED_GROUP_LENGTH = 5

function deriveKey(password, salt) {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, key) => {
            if (error) {
                reject(error)
                return
            }

            resolve(key)
        })
    })
}

export async function hashPassword(password) {
    const salt = randomBytes(SALT_BYTES)
    const key = await deriveKey(password, salt)

    return {
        salt: salt.toString('hex'),
        hash: key.toString('hex')
    }
}

export async function verifyPassword(password, record) {
    const salt = Buffer.from(record.salt, 'hex')
    const expected = Buffer.from(record.hash, 'hex')
    const actual = await deriveKey(password, salt)

    if (expected.length !== actual.length) {
        return false
    }

    return timingSafeEqual(expected, actual)
}

function countDistinctCharacters(text) {
    return new Set(text).size
}

function isSimpleSequence(text) {
    const step = text.charCodeAt(1) - text.charCodeAt(0)
    if (step < -1 || step > 1) {
        return false
    }

    for (let index = 2; index < text.length; index = index + 1) {
        if (text.charCodeAt(index) - text.charCodeAt(index - 1) !== step) {
            return false
        }
    }

    return true
}

function findWeakWord(password) {
    const lowered = password.toLowerCase()

    for (const word of WEAK_WORDS) {
        if (lowered.includes(word)) {
            return word
        }
    }

    return null
}

export function checkNewPassword(password) {
    if (typeof password !== 'string') {
        throw new BadRequestError('The new password must be text')
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        throw new BadRequestError('The new password must be at least ' + MIN_PASSWORD_LENGTH + ' characters long')
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
        throw new BadRequestError('The new password must be at most ' + MAX_PASSWORD_LENGTH + ' characters long')
    }

    if (isSimpleSequence(password)) {
        throw new BadRequestError('The new password is a simple sequence. Choose something harder to guess')
    }

    if (countDistinctCharacters(password) < MIN_DISTINCT_CHARACTERS) {
        throw new BadRequestError('The new password repeats the same few characters. Use at least ' + MIN_DISTINCT_CHARACTERS + ' different ones')
    }

    const weakWord = findWeakWord(password)
    if (weakWord !== null) {
        throw new BadRequestError('The new password contains "' + weakWord + '", which is easy to guess')
    }
}

function generateCandidate() {
    const groups = []

    for (let groupIndex = 0; groupIndex < GENERATED_GROUPS; groupIndex = groupIndex + 1) {
        let group = ''
        for (let charIndex = 0; charIndex < GENERATED_GROUP_LENGTH; charIndex = charIndex + 1) {
            group = group + GENERATED_ALPHABET[randomInt(GENERATED_ALPHABET.length)]
        }
        groups.push(group)
    }

    return groups.join('-')
}

export function generatePassword() {
    for (;;) {
        const candidate = generateCandidate()

        try {
            checkNewPassword(candidate)
            return candidate
        } catch (e) {
            continue
        }
    }
}
