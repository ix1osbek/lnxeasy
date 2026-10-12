import {AppError} from '../core/errors.js'
import {sendError} from './response.js'


export class App {
    constructor(router) {
        this.router = router
    }

    async handle(req, res) {
        try {
            const path = req.url.split('?')[0]
            const handler = this.router.match(req.method, path)
            await handler(req, res)
        } catch (e) {
            if (!(e instanceof AppError)) {
                console.error(e)
            }

            sendError(res, e)
        }
    }
}