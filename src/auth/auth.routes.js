import {sendJson} from '../http/response.js'
import {readJsonBody} from '../http/body.js'
import {buildCookie, buildExpiredCookie, readCookie} from '../http/cookies.js'
import {readClientAddress} from '../http/address.js'

export function regAuthRoutes(router, authService, cookie) {
    function setSessionCookie(res, token) {
        res.setHeader('Set-Cookie', buildCookie(cookie.name, token, cookie.maxAgeSeconds, cookie.secure))
    }

    router.post('/api/auth/login', async (req, res) => {
        const body = await readJsonBody(req)
        const token = await authService.login(body.username, body.password, body.code, readClientAddress(req))

        setSessionCookie(res, token)
        sendJson(res, 200, {authenticated: true})
    })

    router.post('/api/auth/logout', async (req, res) => {
        authService.logout(readCookie(req, cookie.name), readClientAddress(req))

        res.setHeader('Set-Cookie', buildExpiredCookie(cookie.name, cookie.secure))
        sendJson(res, 200, {authenticated: false})
    })

    router.post('/api/auth/password', async (req, res) => {
        const body = await readJsonBody(req)
        const token = await authService.changePassword(
            readCookie(req, cookie.name),
            body.currentPassword,
            body.newPassword,
            readClientAddress(req)
        )

        setSessionCookie(res, token)
        sendJson(res, 200, {changed: true})
    })

    router.get('/api/auth/session', async (req, res) => {
        const status = await authService.getStatus(readCookie(req, cookie.name))
        sendJson(res, 200, status)
    })

    router.get('/api/auth/events', async (req, res) => {
        sendJson(res, 200, authService.listEvents())
    })

    router.post('/api/auth/two-step/setup', async (req, res) => {
        const body = await readJsonBody(req)
        const setup = await authService.startTotpSetup(
            readCookie(req, cookie.name),
            body.currentPassword,
            readClientAddress(req)
        )

        sendJson(res, 200, setup)
    })

    router.post('/api/auth/two-step/enable', async (req, res) => {
        const body = await readJsonBody(req)
        await authService.enableTotp(readCookie(req, cookie.name), body.code, readClientAddress(req))

        sendJson(res, 200, {totpEnabled: true})
    })

    router.post('/api/auth/two-step/disable', async (req, res) => {
        const body = await readJsonBody(req)
        await authService.disableTotp(readCookie(req, cookie.name), body.currentPassword, readClientAddress(req))

        sendJson(res, 200, {totpEnabled: false})
    })
}
