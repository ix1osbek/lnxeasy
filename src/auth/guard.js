import {ForbiddenError} from '../core/errors.js'
import {readCookie} from '../http/cookies.js'

const PUBLIC_PATHS = [
    '/login',
    '/login.html',
    '/login.js',
    '/styles.css',
    '/favicon.svg',
    '/api/health',
    '/api/auth/login'
]

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

export class AccessGuard {
    constructor(authService, cookieName) {
        this.authService = authService
        this.cookieName = cookieName
    }

    isPublic(path) {
        return PUBLIC_PATHS.includes(path)
    }

    readToken(req) {
        return readCookie(req, this.cookieName)
    }

    isAuthenticated(req) {
        return this.authService.getSession(this.readToken(req)) !== null
    }

    checkOrigin(req) {
        if (SAFE_METHODS.includes(req.method)) {
            return
        }

        const fetchSite = req.headers['sec-fetch-site']
        if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
            throw new ForbiddenError('Cross-site request blocked')
        }

        const origin = req.headers.origin
        if (origin === undefined) {
            return
        }

        let originHost = ''
        try {
            originHost = new URL(origin).host
        } catch (e) {
            throw new ForbiddenError('Cross-site request blocked')
        }

        if (originHost !== req.headers.host) {
            throw new ForbiddenError('Cross-site request blocked')
        }
    }
}
