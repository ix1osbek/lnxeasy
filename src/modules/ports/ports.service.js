import {parsePorts} from './ports.parser.js'

export class PortsService {
    constructor(source) {
        this.source = source
    }

    async list() {
        const text = await this.source.read()

        return parsePorts(text)
    }
}
