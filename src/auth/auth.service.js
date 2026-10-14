import {createHash, timingSafeEqual} from 'node:crypto'
import {
    BadRequestError,
    InvalidCodeError,
    InvalidCredentialsError,
    ServiceBusyError,
    TooManyAttemptsError,
    TotpRequiredError,
    UnauthorizedError
} from '../core/errors.js'
import {checkNewPassword, hashPassword, verifyPassword} from './password.js'
import {buildTotpUri, findTotpStep, generateTotpSecret} from './totp.js'

const MAX_PASSWORD_CHECKS_AT_ONCE = 4
const MAX_EVENTS = 50

function textsAreEqual(first, second) {
    const firstDigest = createHash('sha256').update(first).digest()
    const secondDigest = createHash('sha256').update(second).digest()

    return timingSafeEqual(firstDigest, secondDigest)
}

export class AuthService {
    constructor(store, sessions, limiter, now, log) {
        this.store = store
        this.sessions = sessions
        this.limiter = limiter
        this.now = now
        this.log = log
        this.events = []
        this.activePasswordChecks = 0
        this.lastTotpStep = 0
        this.pendingTotpSecret = null
    }

    record(type, clientKey) {
        this.events.unshift({
            type: type,
            address: clientKey,
            time: new Date(this.now()).toISOString()
        })

        if (this.events.length > MAX_EVENTS) {
            this.events.pop()
        }

        this.log('auth ' + type + ' address=' + clientKey)
    }

    listEvents() {
        return this.events.slice()
    }

    checkNotLocked(clientKey) {
        const seconds = this.limiter.secondsUntilAllowed(clientKey)
        if (seconds > 0) {
            throw new TooManyAttemptsError(seconds)
        }
    }

    recordFailure(type, clientKey) {
        this.limiter.recordFailure(clientKey)
        this.record(type, clientKey)

        if (this.limiter.secondsUntilAllowed(clientKey) > 0) {
            this.record('address_locked', clientKey)
        }
    }

    async loadAccount() {
        const account = await this.store.load()
        if (account === null) {
            throw new Error('The admin account does not exist')
        }

        return account
    }

    async checkPassword(password, account) {
        if (this.activePasswordChecks >= MAX_PASSWORD_CHECKS_AT_ONCE) {
            throw new ServiceBusyError()
        }

        this.activePasswordChecks = this.activePasswordChecks + 1
        try {
            return await verifyPassword(password, account)
        } finally {
            this.activePasswordChecks = this.activePasswordChecks - 1
        }
    }

    async saveAccount(account, changes) {
        const next = {
            username: account.username,
            salt: account.salt,
            hash: account.hash,
            totpSecret: account.totpSecret,
            totpLastStep: account.totpLastStep
        }

        for (const key of Object.keys(changes)) {
            next[key] = changes[key]
        }

        await this.store.save(next)
    }

    async useTotpCode(account, secret, code) {
        const step = findTotpStep(secret, code, this.now())

        let lastStep = this.lastTotpStep
        if (account.totpLastStep > lastStep) {
            lastStep = account.totpLastStep
        }

        if (step === null || step <= lastStep) {
            return false
        }

        this.lastTotpStep = step
        account.totpLastStep = step
        await this.saveAccount(account, {})

        return true
    }

    requireSession(token) {
        const session = this.sessions.get(token)
        if (session === null) {
            throw new UnauthorizedError('Login required')
        }

        return session
    }

    async login(username, password, code, clientKey) {
        this.checkNotLocked(clientKey)

        if (typeof username !== 'string' || typeof password !== 'string') {
            throw new BadRequestError('Username and password are required')
        }

        const account = await this.loadAccount()
        const twoStep = account.totpSecret !== null

        if (twoStep && (code === undefined || code === null || code === '')) {
            throw new TotpRequiredError()
        }

        const passwordMatches = await this.checkPassword(password, account)
        const usernameMatches = textsAreEqual(username, account.username)

        if (!passwordMatches || !usernameMatches) {
            this.recordFailure('login_failed', clientKey)
            throw new InvalidCredentialsError(twoStep)
        }

        if (twoStep && !(await this.useTotpCode(account, account.totpSecret, code))) {
            this.recordFailure('code_failed', clientKey)
            throw new InvalidCredentialsError(true)
        }

        this.limiter.recordSuccess(clientKey)
        this.record('login', clientKey)

        return this.sessions.create(account.username)
    }

    getSession(token) {
        return this.sessions.get(token)
    }

    async getStatus(token) {
        const session = this.requireSession(token)
        const account = await this.loadAccount()

        return {
            username: session.username,
            totpEnabled: account.totpSecret !== null
        }
    }

    logout(token, clientKey) {
        if (this.sessions.get(token) !== null) {
            this.record('logout', clientKey)
        }

        this.sessions.delete(token)
    }

    async confirmPassword(password, clientKey) {
        this.checkNotLocked(clientKey)

        if (typeof password !== 'string') {
            throw new BadRequestError('The current password is required')
        }

        const account = await this.loadAccount()
        const passwordMatches = await this.checkPassword(password, account)

        if (!passwordMatches) {
            this.recordFailure('password_check_failed', clientKey)
            throw new InvalidCredentialsError()
        }

        return account
    }

    async changePassword(token, currentPassword, newPassword, clientKey) {
        this.requireSession(token)
        checkNewPassword(newPassword)

        const account = await this.confirmPassword(currentPassword, clientKey)
        const hashed = await hashPassword(newPassword)

        await this.saveAccount(account, {salt: hashed.salt, hash: hashed.hash})

        this.limiter.recordSuccess(clientKey)
        this.record('password_changed', clientKey)
        this.sessions.clear()

        return this.sessions.create(account.username)
    }

    async startTotpSetup(token, currentPassword, clientKey) {
        this.requireSession(token)

        const account = await this.confirmPassword(currentPassword, clientKey)
        this.pendingTotpSecret = generateTotpSecret()

        return {
            secret: this.pendingTotpSecret,
            uri: buildTotpUri(this.pendingTotpSecret, account.username)
        }
    }

    async enableTotp(token, code, clientKey) {
        this.requireSession(token)
        this.checkNotLocked(clientKey)

        if (this.pendingTotpSecret === null) {
            throw new BadRequestError('Start the setup first')
        }

        const account = await this.loadAccount()

        if (!(await this.useTotpCode(account, this.pendingTotpSecret, code))) {
            this.recordFailure('code_failed', clientKey)
            throw new InvalidCodeError()
        }

        await this.saveAccount(account, {totpSecret: this.pendingTotpSecret})

        this.pendingTotpSecret = null
        this.record('two_step_enabled', clientKey)
    }

    async disableTotp(token, currentPassword, clientKey) {
        this.requireSession(token)

        const account = await this.confirmPassword(currentPassword, clientKey)
        await this.saveAccount(account, {totpSecret: null, totpLastStep: 0})

        this.pendingTotpSecret = null
        this.record('two_step_disabled', clientKey)
    }
}
