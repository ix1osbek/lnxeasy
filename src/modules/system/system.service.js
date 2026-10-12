import {parseLoadAverage, parseMemInfo} from './system.parser.js'

export class SystemService {
    constructor(os, readFile) {
        this.os = os
        this.readFile = readFile
    }

    async getInfo() {
        const cpus = this.os.cpus()

        let cpuModel = 'unknown'
        if (cpus.length > 0) {
            cpuModel = cpus[0].model
        }

        const loadText = await this.readFile('/proc/loadavg', 'utf8')
        const memText = await this.readFile('/proc/meminfo', 'utf8')
        const loadAverage = parseLoadAverage(loadText)
        const memInfo = parseMemInfo(memText)

        return {
            hostname: this.os.hostname(),
            platform: this.os.platform(),
            release: this.os.release(),
            arch: this.os.arch(),
            uptimeSeconds: Math.floor(this.os.uptime()),
            cpu: {
                model: cpuModel,
                cores: cpus.length,
            },
            loadAverage: loadAverage,
            memory: {
                totalBytes: memInfo.totalBytes,
                freeBytes: memInfo.freeBytes,
                availableBytes: memInfo.availableBytes,
                usedBytes: memInfo.totalBytes - memInfo.availableBytes,
            },
            swap: {
                totalBytes: memInfo.swapTotalBytes,
                freeBytes: memInfo.swapFreeBytes,
                usedBytes: memInfo.swapTotalBytes - memInfo.swapFreeBytes,
            },
        }
    }
}
