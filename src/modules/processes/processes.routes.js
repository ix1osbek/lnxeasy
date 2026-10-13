import {sendJson} from '../../http/response.js'
import {BadRequestError} from '../../core/errors.js'

function readPid(req) {
    const query = req.url.split('?')[1]
    if (query === undefined) {
        throw new BadRequestError('The pid parameter is required')
    }

    for (const part of query.split('&')) {
        if (part.startsWith('pid=')) {
            const pid = Number(part.slice(4))
            if (Number.isInteger(pid) && pid > 0) {
                return pid
            }
        }
    }

    throw new BadRequestError('The pid parameter must be a positive whole number')
}

export function regProcessesRoutes(router, processesService, portsService) {
    router.get('/api/processes', async (req, res) => {
        sendJson(res, 200, await processesService.list())
    })

    router.get('/api/process', async (req, res) => {
        const pid = readPid(req)
        const details = await processesService.get(pid)
        const ports = []

        for (const port of await portsService.list()) {
            for (const process of port.processes) {
                if (process.pid === pid) {
                    ports.push({protocol: port.protocol, address: port.address, port: port.port})
                }
            }
        }

        details.ports = ports
        sendJson(res, 200, details)
    })
}
