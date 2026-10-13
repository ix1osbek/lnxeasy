import path from 'node:path'
import {NotFoundError} from '../core/errors.js'

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
}

const CONTENT_SECURITY_POLICY = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

export class StaticFiles {
    constructor(rootDirectory, readFile) {
        this.rootDirectory = path.resolve(rootDirectory)
        this.readFile = readFile
    }

    resolveFilePath(urlPath) {
        let decodedPath = ''
        try {
            decodedPath = decodeURIComponent(urlPath)
        } catch (e) {
            throw new NotFoundError('File not found: ' + urlPath)
        }

        if (decodedPath.includes('\0')) {
            throw new NotFoundError('File not found: ' + urlPath)
        }

        if (decodedPath.endsWith('/')) {
            decodedPath = decodedPath + 'index.html'
        }

        const filePath = path.join(this.rootDirectory, decodedPath)

        if (!filePath.startsWith(this.rootDirectory + path.sep)) {
            throw new NotFoundError('File not found: ' + urlPath)
        }

        return filePath
    }

    async serve(req, res, urlPath) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            throw new NotFoundError('File not found: ' + urlPath)
        }

        const filePath = this.resolveFilePath(urlPath)
        const contentType = CONTENT_TYPES[path.extname(filePath)]

        if (contentType === undefined) {
            throw new NotFoundError('File not found: ' + urlPath)
        }

        let content = null
        try {
            content = await this.readFile(filePath)
        } catch (e) {
            if (e.code === 'ENOENT' || e.code === 'EISDIR' || e.code === 'ENOTDIR') {
                throw new NotFoundError('File not found: ' + urlPath)
            }
            throw e
        }

        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': content.length,
            'Cache-Control': 'no-cache',
            'Content-Security-Policy': CONTENT_SECURITY_POLICY,
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer'
        })

        if (req.method === 'HEAD') {
            res.end()
            return
        }

        res.end(content)
    }
}
