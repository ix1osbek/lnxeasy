import {sendJson} from '../http/response.js'
import {readJsonBody} from '../http/body.js'
import {buildCookie, buildExpiredCookie, readCookie} from '../http/cookies.js'

export function regAuthRoutes(router, authService, cookie) {
    router.post('/api/auth/login', async (req, res) => {
        const body = await readJsonBody(req)
        const token = await authService.login(body.username, body.password, req.socket.remoteAddress)

        res.setHeader('Set-Cookie', buildCookie(cookie.name, token, cookie.maxAgeSeconds, cookie.secure))
        sendJson(res, 200, {authenticated: true})
    })

    router.post('/api/auth/logout', async (req, res) => {
        authService.logout(readCookie(req, cookie.name))

        res.setHeader('Set-Cookie', buildExpiredCookie(cookie.name, cookie.secure))
        sendJson(res, 200, {authenticated: false})
    })

    router.post('/api/auth/password', async (req, res) => {
        const body = await readJsonBody(req)
        const token = await authService.changePassword(
            readCookie(req, cookie.name),
            body.currentPassword,
            body.newPassword,
            req.socket.remoteAddress
        )

        res.setHeader('Set-Cookie', buildCookie(cookie.name, token, cookie.maxAgeSeconds, cookie.secure))
        sendJson(res, 200, {changed: true})
    })

    router.get('/api/auth/session', async (req, res) => {
        const session = authService.getSession(readCookie(req, cookie.name))
        sendJson(res, 200, {username: session.username})
    })
}
