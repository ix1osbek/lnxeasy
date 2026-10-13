import {parseMounts} from './disks.parser.js'

function percentOf(part, total) {
    if (total <= 0) {
        return 0
    }

    return Math.round((part / total) * 1000) / 10
}

export class DisksService {
    constructor(fs) {
        this.fs = fs
    }

    async readUsage(mount) {
        let stats = null
        try {
            stats = await this.fs.statfs(mount.mountPoint)
        } catch (e) {
            return null
        }

        const totalBytes = stats.blocks * stats.bsize
        const availableBytes = stats.bavail * stats.bsize
        const usedBytes = (stats.blocks - stats.bfree) * stats.bsize

        if (totalBytes <= 0) {
            return null
        }

        return {
            device: mount.device,
            mountPoint: mount.mountPoint,
            type: mount.type,
            totalBytes: totalBytes,
            usedBytes: usedBytes,
            availableBytes: availableBytes,
            usedPercent: percentOf(usedBytes, usedBytes + availableBytes)
        }
    }

    async list() {
        const mounts = parseMounts(await this.fs.readFile('/proc/mounts', 'utf8'))
        const disks = []

        for (const mount of mounts) {
            const usage = await this.readUsage(mount)
            if (usage !== null) {
                disks.push(usage)
            }
        }

        disks.sort((a, b) => {
            if (a.mountPoint < b.mountPoint) {
                return -1
            }
            if (a.mountPoint > b.mountPoint) {
                return 1
            }
            return 0
        })

        return disks
    }
}
