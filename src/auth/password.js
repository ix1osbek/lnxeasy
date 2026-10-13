import {randomBytes, randomInt, scrypt, timingSafeEqual} from 'node:crypto'
import {BadRequestError} from '../core/errors.js'

const SALT_BYTES = 16
const KEY_BYTES = 64
const SCRYPT_OPTIONS = {N: 16384, r: 8, p: 1}

const MIN_PASSWORD_LENGTH = 10
const MAX_PASSWORD_LENGTH = 200

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
}

export function generatePassword() {
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
