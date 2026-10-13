import {randomBytes} from 'node:crypto'

const TOKEN_BYTES = 32
const MAX_SESSIONS = 100

export class SessionStore {
    constructor(lifetimeMs, now) {
        this.lifetimeMs = lifetimeMs
        this.now = now
        this.sessions = new Map()
    }

    create(username) {
        if (this.sessions.size >= MAX_SESSIONS) {
            const oldestToken = this.sessions.keys().next().value
            this.sessions.delete(oldestToken)
        }

        const token = randomBytes(TOKEN_BYTES).toString('hex')
        this.sessions.set(token, {
            username: username,
            expiresAt: this.now() + this.lifetimeMs
        })

        return token
    }

    get(token) {
        if (typeof token !== 'string' || token === '') {
            return null
        }

        const session = this.sessions.get(token)
        if (session === undefined) {
            return null
        }

        if (session.expiresAt <= this.now()) {
            this.sessions.delete(token)
            return null
        }

        return session
    }

    delete(token) {
        this.sessions.delete(token)
    }

    clear() {
        this.sessions.clear()
    }
}
