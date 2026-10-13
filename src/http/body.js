import {BadRequestError, PayloadTooLargeError} from '../core/errors.js'

const DEFAULT_MAX_BYTES = 10 * 1024

function hasJsonContentType(req) {
    const contentType = req.headers['content-type']
    if (typeof contentType !== 'string') {
        return false
    }

    return contentType.toLowerCase().startsWith('application/json')
}

function parseJsonObject(text) {
    let value = null
    try {
        value = JSON.parse(text)
    } catch (e) {
        throw new BadRequestError('Request body is not valid JSON')
    }

    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestError('Request body must be a JSON object')
    }

    return value
}

export function readJsonBody(req, maxBytes) {
    let limit = DEFAULT_MAX_BYTES
    if (maxBytes !== undefined) {
        limit = maxBytes
    }

    return new Promise((resolve, reject) => {
        if (!hasJsonContentType(req)) {
            reject(new BadRequestError('Content-Type must be application/json'))
            return
        }

        const chunks = []
        let size = 0
        let rejected = false

        req.on('data', (chunk) => {
            if (rejected) {
                return
            }

            size = size + chunk.length
            if (size > limit) {
                rejected = true
                reject(new PayloadTooLargeError())
                return
            }

            chunks.push(chunk)
        })

        req.on('end', () => {
            if (rejected) {
                return
            }

            try {
                resolve(parseJsonObject(Buffer.concat(chunks).toString('utf8')))
            } catch (e) {
                reject(e)
            }
        })

        req.on('error', (error) => {
            if (rejected) {
                return
            }

            rejected = true
            reject(error)
        })
    })
}
