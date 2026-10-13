import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StaticFiles } from '../src/http/static.js'
import { NotFoundError } from '../src/core/errors.js'

const ROOT = '/srv/public'

function createFakeResponse() {
    const res = { statusCode: null, headers: null, body: null, ended: false }

    res.writeHead = (statusCode, headers) => {
        res.statusCode = statusCode
        res.headers = headers
    }

    res.end = (body) => {
        res.body = body
        res.ended = true
    }

    return res
}

// A fake readFile: knows a few files and remembers every path it was asked for.
function createFakeReadFile() {
    const files = {
        '/srv/public/index.html': Buffer.from('<h1>home</h1>'),
        '/srv/public/app.js': Buffer.from('console.log(1)'),
        '/srv/public/styles.css': Buffer.from('body{}'),
        '/srv/public/docs/index.html': Buffer.from('<h1>docs</h1>'),
        '/srv/public/notes.txt': Buffer.from('private'),
    }
    const requested = []

    const readFile = async (filePath) => {
        requested.push(filePath)
        if (files[filePath] === undefined) {
            const error = new Error('no such file')
            error.code = 'ENOENT'
            throw error
        }
        return files[filePath]
    }

    return { readFile: readFile, requested: requested }
}

function createStaticFiles() {
    const fake = createFakeReadFile()
    return { staticFiles: new StaticFiles(ROOT, fake.readFile), requested: fake.requested }
}

test('serve sends index.html for the root path', async () => {
    const { staticFiles } = createStaticFiles()
    const res = createFakeResponse()

    await staticFiles.serve({ method: 'GET' }, res, '/')

    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8')
    assert.equal(res.body.toString(), '<h1>home</h1>')
})

test('serve sends index.html for a directory path', async () => {
    const { staticFiles } = createStaticFiles()
    const res = createFakeResponse()

    await staticFiles.serve({ method: 'GET' }, res, '/docs/')

    assert.equal(res.body.toString(), '<h1>docs</h1>')
})

test('serve picks the content type from the file extension', async () => {
    const { staticFiles } = createStaticFiles()
    const scriptRes = createFakeResponse()
    const styleRes = createFakeResponse()

    await staticFiles.serve({ method: 'GET' }, scriptRes, '/app.js')
    await staticFiles.serve({ method: 'GET' }, styleRes, '/styles.css')

    assert.equal(scriptRes.headers['Content-Type'], 'text/javascript; charset=utf-8')
    assert.equal(styleRes.headers['Content-Type'], 'text/css; charset=utf-8')
})

test('serve sets the length and the security headers', async () => {
    const { staticFiles } = createStaticFiles()
    const res = createFakeResponse()

    await staticFiles.serve({ method: 'GET' }, res, '/app.js')

    assert.equal(res.headers['Content-Length'], 14)
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(res.headers['X-Frame-Options'], 'DENY')
    assert.equal(res.headers['Content-Security-Policy'].includes("default-src 'self'"), true)
})

test('serve answers HEAD with headers and no body', async () => {
    const { staticFiles } = createStaticFiles()
    const res = createFakeResponse()

    await staticFiles.serve({ method: 'HEAD' }, res, '/app.js')

    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['Content-Length'], 14)
    assert.equal(res.body, undefined)
    assert.equal(res.ended, true)
})

test('serve rejects a missing file with NotFoundError', async () => {
    const { staticFiles } = createStaticFiles()

    await assert.rejects(staticFiles.serve({ method: 'GET' }, createFakeResponse(), '/nope.html'), NotFoundError)
})

test('serve rejects a file type that is not on the list without reading it', async () => {
    const { staticFiles, requested } = createStaticFiles()

    await assert.rejects(staticFiles.serve({ method: 'GET' }, createFakeResponse(), '/notes.txt'), NotFoundError)
    assert.deepEqual(requested, [])
})

test('serve rejects methods other than GET and HEAD', async () => {
    const { staticFiles, requested } = createStaticFiles()

    await assert.rejects(staticFiles.serve({ method: 'POST' }, createFakeResponse(), '/'), NotFoundError)
    assert.deepEqual(requested, [])
})

test('serve never reads a file outside the root directory', async () => {
    const attempts = [
        '/../secret.html',
        '/../../etc/passwd.html',
        '/%2e%2e/secret.html',
        '/..%2f..%2fsecret.html',
        '/docs/../../secret.html',
    ]

    for (const urlPath of attempts) {
        const { staticFiles, requested } = createStaticFiles()

        await assert.rejects(staticFiles.serve({ method: 'GET' }, createFakeResponse(), urlPath), NotFoundError)

        for (const filePath of requested) {
            assert.equal(filePath.startsWith(ROOT + '/'), true, urlPath + ' reached ' + filePath)
        }
    }
})

test('serve does not treat a sibling directory with the same prefix as the root', async () => {
    const { staticFiles, requested } = createStaticFiles()

    await assert.rejects(
        staticFiles.serve({ method: 'GET' }, createFakeResponse(), '/../public-backup/index.html'),
        NotFoundError
    )
    assert.deepEqual(requested, [])
})

test('serve rejects a path with a null byte or broken encoding', async () => {
    const { staticFiles, requested } = createStaticFiles()

    await assert.rejects(staticFiles.serve({ method: 'GET' }, createFakeResponse(), '/index.html%00.js'), NotFoundError)
    await assert.rejects(staticFiles.serve({ method: 'GET' }, createFakeResponse(), '/%zz.html'), NotFoundError)
    assert.deepEqual(requested, [])
})

test('serve lets an unexpected read error pass through', async () => {
    const readFile = async () => {
        const error = new Error('permission denied')
        error.code = 'EACCES'
        throw error
    }
    const staticFiles = new StaticFiles(ROOT, readFile)

    await assert.rejects(staticFiles.serve({ method: 'GET' }, createFakeResponse(), '/index.html'), { code: 'EACCES' })
})
