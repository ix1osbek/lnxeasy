import {SocketUnavailableError} from '../../core/socket.js'

export class PortsSource {
    constructor(run, readSocket, helperSocket) {
        this.run = run
        this.readSocket = readSocket
        this.helperSocket = helperSocket
    }

    async readFromHelper() {
        let text = ''
        try {
            text = await this.readSocket(this.helperSocket)
        } catch (e) {
            if (e instanceof SocketUnavailableError) {
                return null
            }
            throw e
        }

        if (text.trim() === '') {
            return null
        }

        return text
    }

    async read() {
        if (this.helperSocket !== null) {
            const text = await this.readFromHelper()
            if (text !== null) {
                return text
            }
        }

        const result = await this.run('ss', ['-tulpnH'])

        return result.stdout
    }
}
