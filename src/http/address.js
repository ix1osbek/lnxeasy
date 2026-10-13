import {BlockList, isIP} from 'node:net'

const MAPPED_IPV4_PREFIX = '::ffff:'

export function normalizeAddress(address) {
    if (typeof address !== 'string') {
        return ''
    }

    if (address.startsWith(MAPPED_IPV4_PREFIX) && isIP(address.slice(MAPPED_IPV4_PREFIX.length)) === 4) {
        return address.slice(MAPPED_IPV4_PREFIX.length)
    }

    return address
}

export function readClientAddress(req) {
    return normalizeAddress(req.socket.remoteAddress)
}

function familyName(address) {
    const version = isIP(address)
    if (version === 4) {
        return 'ipv4'
    }
    if (version === 6) {
        return 'ipv6'
    }
    return null
}

export function checkAddressEntry(entry) {
    const parts = entry.split('/')
    const family = familyName(parts[0])

    if (family === null || parts.length > 2) {
        throw new Error('Invalid address "' + entry + '". Use an IP address like 203.0.113.10 or a range like 203.0.113.0/24.')
    }

    if (parts.length === 1) {
        return
    }

    const prefix = Number(parts[1])
    let maxPrefix = 32
    if (family === 'ipv6') {
        maxPrefix = 128
    }

    if (parts[1] === '' || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
        throw new Error('Invalid address range "' + entry + '".')
    }
}

export class AddressFilter {
    constructor(entries) {
        this.restricted = entries.length > 0
        this.list = new BlockList()

        for (const entry of entries) {
            checkAddressEntry(entry)

            const parts = entry.split('/')
            const family = familyName(parts[0])

            if (parts.length === 2) {
                this.list.addSubnet(parts[0], Number(parts[1]), family)
            } else {
                this.list.addAddress(parts[0], family)
            }
        }

        this.list.addSubnet('127.0.0.0', 8, 'ipv4')
        this.list.addAddress('::1', 'ipv6')
    }

    allows(address) {
        if (!this.restricted) {
            return true
        }

        const normalized = normalizeAddress(address)
        const family = familyName(normalized)
        if (family === null) {
            return false
        }

        return this.list.check(normalized, family)
    }
}
