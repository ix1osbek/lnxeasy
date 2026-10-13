import {createHash, timingSafeEqual} from 'node:crypto'
import {BadRequestError, InvalidCredentialsError, TooManyAttemptsError, UnauthorizedError} from '../core/errors.js'
import {checkNewPassword, hashPassword, verifyPassword} from './password.js'

function textsAreEqual(first, second) {
    const firstDigest = createHash('sha256').update(first).digest()
    const secondDigest = createHash('sha256').update(second).digest()

    return timingSafeEqual(firstDigest, secondDigest)
}

export class AuthService {
    constructor(store, sessions, limiter) {
        this.store = store
        this.sessions = sessions
        this.limiter = limiter
    }

    checkNotLocked(clientKey) {
        const seconds = this.limiter.secondsUntilAllowed(clientKey)
        if (seconds > 0) {
            throw new TooManyAttemptsError(seconds)
        }
    }

    async loadAccount() {
        const account = await this.store.load()
        if (account === null) {
            throw new Error('The admin account does not exist')
        }

        return account
    }

    async login(username, password, clientKey) {
        this.checkNotLocked(clientKey)

        if (typeof username !== 'string' || typeof password !== 'string') {
            throw new BadRequestError('Username and password are required')
        }

        const account = await this.loadAccount()
        const passwordMatches = await verifyPassword(password, account)
        const usernameMatches = textsAreEqual(username, account.username)

        if (!passwordMatches || !usernameMatches) {
            this.limiter.recordFailure(clientKey)
            throw new InvalidCredentialsError()
        }

        this.limiter.recordSuccess(clientKey)

        return this.sessions.create(account.username)
    }

    getSession(token) {
        return this.sessions.get(token)
    }

    logout(token) {
        this.sessions.delete(token)
    }

    async changePassword(token, currentPassword, newPassword, clientKey) {
        const session = this.sessions.get(token)
        if (session === null) {
            throw new UnauthorizedError('Login required')
        }

        this.checkNotLocked(clientKey)

        if (typeof currentPassword !== 'string') {
            throw new BadRequestError('The current password is required')
        }

        checkNewPassword(newPassword)

        const account = await this.loadAccount()
        const passwordMatches = await verifyPassword(currentPassword, account)

        if (!passwordMatches) {
            this.limiter.recordFailure(clientKey)
            throw new InvalidCredentialsError()
        }

        const hashed = await hashPassword(newPassword)
        await this.store.save({
            username: account.username,
            salt: hashed.salt,
            hash: hashed.hash
        })

        this.limiter.recordSuccess(clientKey)
        this.sessions.clear()

        return this.sessions.create(account.username)
    }
}
