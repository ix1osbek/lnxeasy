import {AppError, UnauthorizedError} from '../core/errors.js'
import {sendError} from './response.js'

const LOGIN_PATH = '/login'
const LOGIN_FILE = '/login.html'

export class App {
    constructor(router, staticFiles, guard, requestLimiter) {
        this.router = router
        this.staticFiles = staticFiles
        this.guard = guard
        this.requestLimiter = requestLimiter
    }

    async handleApi(req, res, path) {
        this.guard.checkOrigin(req)

        if (!this.guard.isPublic(path) && !this.guard.isAuthenticated(req)) {
            throw new UnauthorizedError('Login required')
        }

        const handler = this.router.match(req.method, path)
        await handler(req, res)
    }

    async handlePage(req, res, path) {
        if (!this.guard.isPublic(path) && !this.guard.isAuthenticated(req)) {
            res.writeHead(302, {
                'Location': LOGIN_PATH,
                'Cache-Control': 'no-store'
            })
            res.end()
            return
        }

        if (path === LOGIN_PATH) {
            await this.staticFiles.serve(req, res, LOGIN_FILE)
            return
        }

        await this.staticFiles.serve(req, res, path)
    }

    async handle(req, res) {
        try {
            this.requestLimiter.check(req)

            const path = req.url.split('?')[0]

            if (path.startsWith('/api/')) {
                await this.handleApi(req, res, path)
            } else {
                await this.handlePage(req, res, path)
            }
        } catch (e) {
            if (!(e instanceof AppError)) {
                console.error(e)
            }

            sendError(res, e)
        }
    }
}
