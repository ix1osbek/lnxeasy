export function readCookie(req, name) {
    const header = req.headers.cookie
    if (typeof header !== 'string') {
        return null
    }

    for (const part of header.split(';')) {
        const separatorIndex = part.indexOf('=')
        if (separatorIndex === -1) {
            continue
        }

        const cookieName = part.slice(0, separatorIndex).trim()
        if (cookieName === name) {
            return part.slice(separatorIndex + 1).trim()
        }
    }

    return null
}

export function buildCookie(name, value, maxAgeSeconds, secure) {
    let cookie = name + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAgeSeconds

    if (secure) {
        cookie = cookie + '; Secure'
    }

    return cookie
}

export function buildExpiredCookie(name, secure) {
    return buildCookie(name, '', 0, secure)
}
