import {SystemService} from './system/system.service.js'
import {regSystemRoutes} from './system/system.routes.js'
import {PortsService} from './ports/ports.service.js'
import {PortsSource} from './ports/ports.source.js'
import {regPortsRoutes} from './ports/ports.routes.js'
import {ProcessesService} from './processes/processes.service.js'
import {regProcessesRoutes} from './processes/processes.routes.js'


export function regModules(router, dependencies) {
    const systemService = new SystemService(dependencies.os, dependencies.readFile)
    regSystemRoutes(router, systemService)

    const portsSource = new PortsSource(dependencies.run, dependencies.readSocket, dependencies.helperSocket)
    const portService = new PortsService(portsSource)
    regPortsRoutes(router, portService)

    const processesService = new ProcessesService(dependencies.fs, dependencies.now, dependencies.sleep)
    regProcessesRoutes(router, processesService, portService)

}
