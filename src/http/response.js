import {AppError} from '../core/errors.js'


export function sendJson(res, statusCode, data) {
    const body = JSON.stringify({data: data})
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    })
    res.end(body)
}


export function sendError(res, error) {

    if (res.headersSent) {
        res.end()
        return
    }

    let statusCode = 500
    let code = 'INTERNAL_ERROR'
    let message = 'Internal server error'

    if (error instanceof AppError) {
        statusCode = error.statusCode
        code = error.code
        message = error.message
    }

    const body = JSON.stringify({
        error: {
            code: code,
            message: message
        }
    })

    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    })

    res.end(body)
}