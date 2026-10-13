const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000
const MAX_ENTRIES = 10000

export class LoginLimiter {
    constructor(now) {
        this.now = now
        this.entries = new Map()
    }

    secondsUntilAllowed(key) {
        const entry = this.entries.get(key)
        if (entry === undefined) {
            return 0
        }

        const remainingMs = entry.lockedUntil - this.now()
        if (remainingMs <= 0) {
            return 0
        }

        return Math.ceil(remainingMs / 1000)
    }

    recordFailure(key) {
        const now = this.now()
        let entry = this.entries.get(key)

        if (entry === undefined || now - entry.firstFailureAt > WINDOW_MS) {
            this.makeRoom()
            entry = {failures: 0, firstFailureAt: now, lockedUntil: 0}
            this.entries.set(key, entry)
        }

        entry.failures = entry.failures + 1

        if (entry.failures >= MAX_FAILURES) {
            entry.failures = 0
            entry.firstFailureAt = now
            entry.lockedUntil = now + LOCK_MS
        }
    }

    recordSuccess(key) {
        this.entries.delete(key)
    }

    makeRoom() {
        if (this.entries.size < MAX_ENTRIES) {
            return
        }

        const now = this.now()
        for (const [key, entry] of this.entries) {
            if (entry.lockedUntil <= now && now - entry.firstFailureAt > WINDOW_MS) {
                this.entries.delete(key)
            }
        }

        if (this.entries.size >= MAX_ENTRIES) {
            const oldestKey = this.entries.keys().next().value
            this.entries.delete(oldestKey)
        }
    }
}
