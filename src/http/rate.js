import {RateLimitedError} from '../core/errors.js'
import {readClientAddress} from './address.js'

const MAX_ENTRIES = 10000

export class RequestLimiter {
    constructor(maxRequests, windowMs, now) {
        this.maxRequests = maxRequests
        this.windowMs = windowMs
        this.now = now
        this.entries = new Map()
    }

    check(req) {
        const key = readClientAddress(req)
        const now = this.now()
        let entry = this.entries.get(key)

        if (entry === undefined || now - entry.windowStart >= this.windowMs) {
            if (this.entries.size >= MAX_ENTRIES) {
                this.entries.clear()
            }

            entry = {windowStart: now, count: 0}
            this.entries.set(key, entry)
        }

        entry.count = entry.count + 1

        if (entry.count > this.maxRequests) {
            throw new RateLimitedError()
        }
    }
}
