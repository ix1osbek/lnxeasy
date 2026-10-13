import {parsePorts} from './ports.parser.js'

export class PortsService {
    constructor(run) {
        this.run = run
    }

    async list(){
        const result = await this.run('ss' , ['-tulpnH'])

        return parsePorts(result.stdout)
    }
}