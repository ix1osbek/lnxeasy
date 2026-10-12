import {sendJson} from '../../http/response.js'

export function regSystemRoutes(router, systemService) {
    router.get('/api/system', async (req, res) => {
        const info = await systemService.getInfo()
        sendJson(res, 200, info)
    })
}