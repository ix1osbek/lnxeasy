import {SystemService} from './system/system.service.js'
import {regSystemRoutes} from './system/system.routes.js'
import {PortsService} from './ports/ports.service.js'
import {regPortsRoutes} from './ports/ports.routes.js'


export function regModules(router, dependencies) {
    const systemService = new SystemService(dependencies.os, dependencies.readFile)
    regSystemRoutes(router, systemService)

    const portService = new PortsService(dependencies.run)
    regPortsRoutes(router, portService)

}
