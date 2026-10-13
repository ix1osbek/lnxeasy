import {sendJson} from '../../http/response.js'

export function regDisksRoutes(router, disksService) {
    router.get('/api/disks', async (req, res) => {
        sendJson(res, 200, await disksService.list())
    })
}
