import {sendJson} from '../../http/response.js'

export function regPortsRoutes(router, portsService) {
    router.get('/api/ports', async (req, res) => {
        const ports = await portsService.list()
        sendJson(res, 200, ports)
    })
}