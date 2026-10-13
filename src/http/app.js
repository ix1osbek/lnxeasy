import {AppError} from '../core/errors.js'
import {sendError} from './response.js'


export class App {
    constructor(router, staticFiles) {
        this.router = router
        this.staticFiles = staticFiles
    }


    async handle(req, res) {
        try {
            const path = req.url.split('?')[0]

            if (path.startsWith('/api/')) {
                const handler = this.router.match(req.method, path)
                await handler(req, res)
            } else {
                await this.staticFiles.serve(req, res, path)
            }
        } catch (e) {
            if (!(e instanceof AppError)) {
                console.error(e)
            }

            sendError(res, e)
        }
    }
}