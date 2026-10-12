import {SystemService} from './system/system.service.js'
import {regSystemRoutes} from './system/system.routes.js'

export function regModules(router , dependencies) {
    const systemService = new SystemService(dependencies.os , dependencies.readFile)
    regSystemRoutes(router , systemService)
}
