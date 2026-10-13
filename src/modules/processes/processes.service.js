import {NotFoundError} from '../../core/errors.js'
import {
    parseCommandLine,
    parseCpuTimes,
    parseProcessStat,
    parseProcessStatus,
    parseUserNames
} from './processes.parser.js'

const TICKS_PER_SECOND = 100
const FIRST_SAMPLE_GAP_MS = 250
const CACHE_MS = 1000
const GONE_CODES = ['ENOENT', 'ESRCH', 'EACCES', 'EPERM']

function percentOf(part, total) {
    if (total <= 0) {
        return 0
    }

    const percent = (part / total) * 100
    if (percent < 0) {
        return 0
    }

    return Math.round(percent * 10) / 10
}

function isProcessDirectory(name) {
    if (name === '') {
        return false
    }

    for (const character of name) {
        if (character < '0' || character > '9') {
            return false
        }
    }

    return true
}

export class ProcessesService {
    constructor(fs, now, sleep) {
        this.fs = fs
        this.now = now
        this.sleep = sleep
        this.previous = null
        this.lastResult = null
        this.lastResultTime = 0
    }

    async readProcess(pid) {
        const directory = '/proc/' + pid

        try {
            const texts = await Promise.all([
                this.fs.readFile(directory + '/stat', 'utf8'),
                this.fs.readFile(directory + '/status', 'utf8'),
                this.fs.readFile(directory + '/cmdline', 'utf8')
            ])
            const stat = parseProcessStat(texts[0])
            const status = parseProcessStatus(texts[1])
            const commandLine = parseCommandLine(texts[2])

            return {
                pid: stat.pid,
                parentPid: stat.parentPid,
                name: stat.name,
                state: stat.state,
                nice: stat.nice,
                threads: stat.threads,
                cpuTicks: stat.cpuTicks,
                startTicks: stat.startTicks,
                uid: status.uid,
                memoryBytes: status.memoryBytes,
                commandLine: commandLine
            }
        } catch (e) {
            if (GONE_CODES.includes(e.code)) {
                return null
            }
            throw e
        }
    }

    async readSnapshot() {
        const cpu = parseCpuTimes(await this.fs.readFile('/proc/stat', 'utf8'))
        const names = await this.fs.readdir('/proc')
        const pending = []

        for (const name of names) {
            if (isProcessDirectory(name)) {
                pending.push(this.readProcess(name))
            }
        }

        const processes = []
        for (const process of await Promise.all(pending)) {
            if (process !== null) {
                processes.push(process)
            }
        }

        return {
            time: this.now(),
            cpu: cpu,
            processes: processes
        }
    }

    async readTotalMemory() {
        const text = await this.fs.readFile('/proc/meminfo', 'utf8')

        for (const line of text.split('\n')) {
            if (line.startsWith('MemTotal:')) {
                return Number(line.slice(9).trim().split(/\s+/)[0]) * 1024
            }
        }

        return 0
    }

    async readUserNames() {
        try {
            return parseUserNames(await this.fs.readFile('/etc/passwd', 'utf8'))
        } catch (e) {
            return new Map()
        }
    }

    describeCores(previous, current) {
        const cores = []

        for (let index = 0; index < current.cpu.cores.length; index = index + 1) {
            const now = current.cpu.cores[index]
            const before = previous.cpu.cores[index]
            let percent = 0

            if (before !== undefined) {
                percent = percentOf(now.busyTicks - before.busyTicks, now.totalTicks - before.totalTicks)
            }

            cores.push({id: index, percent: percent})
        }

        return cores
    }

    describeProcesses(previous, current, totalMemory, userNames) {
        const previousTicks = new Map()
        for (const process of previous.processes) {
            previousTicks.set(process.pid, process)
        }

        const elapsedSeconds = (current.time - previous.time) / 1000
        const result = []

        for (const process of current.processes) {
            const before = previousTicks.get(process.pid)
            let cpuPercent = 0

            if (before !== undefined && before.startTicks === process.startTicks && elapsedSeconds > 0) {
                const usedSeconds = (process.cpuTicks - before.cpuTicks) / TICKS_PER_SECOND
                cpuPercent = percentOf(usedSeconds, elapsedSeconds)
            }

            let user = userNames.get(process.uid)
            if (user === undefined) {
                user = String(process.uid)
            }

            let command = process.commandLine
            const isKernelThread = command === ''
            if (isKernelThread) {
                command = '[' + process.name + ']'
            }

            result.push({
                pid: process.pid,
                parentPid: process.parentPid,
                name: process.name,
                user: user,
                state: process.state,
                nice: process.nice,
                threads: process.threads,
                cpuPercent: cpuPercent,
                memoryBytes: process.memoryBytes,
                memoryPercent: percentOf(process.memoryBytes, totalMemory),
                startedAt: new Date((current.cpu.bootTime + process.startTicks / TICKS_PER_SECOND) * 1000).toISOString(),
                command: command,
                kernelThread: isKernelThread
            })
        }

        return result
    }

    async list() {
        if (this.lastResult !== null && this.now() - this.lastResultTime < CACHE_MS) {
            return this.lastResult
        }

        let current = await this.readSnapshot()

        if (this.previous === null) {
            this.previous = current
            await this.sleep(FIRST_SAMPLE_GAP_MS)
            current = await this.readSnapshot()
        }

        const previous = this.previous
        const totalMemory = await this.readTotalMemory()
        const userNames = await this.readUserNames()
        const processes = this.describeProcesses(previous, current, totalMemory, userNames)

        let running = 0
        let threads = 0
        for (const process of processes) {
            threads = threads + process.threads
            if (process.state === 'running') {
                running = running + 1
            }
        }

        this.previous = current
        this.lastResult = {
            summary: {
                tasks: processes.length,
                running: running,
                threads: threads,
                cpuPercent: percentOf(
                    current.cpu.all.busyTicks - previous.cpu.all.busyTicks,
                    current.cpu.all.totalTicks - previous.cpu.all.totalTicks
                ),
                cores: this.describeCores(previous, current)
            },
            processes: processes
        }
        this.lastResultTime = this.now()

        return this.lastResult
    }

    async readArguments(pid) {
        let text = ''
        try {
            text = await this.fs.readFile('/proc/' + pid + '/cmdline', 'utf8')
        } catch (e) {
            return []
        }

        const parts = text.split('\0')
        while (parts.length > 0 && parts[parts.length - 1] === '') {
            parts.pop()
        }

        return parts
    }

    async readExecutable(pid) {
        try {
            return await this.fs.readlink('/proc/' + pid + '/exe')
        } catch (e) {
            return null
        }
    }

    async get(pid) {
        const listing = await this.list()
        let found = null
        let parent = null
        const children = []

        for (const process of listing.processes) {
            if (process.pid === pid) {
                found = process
            }
        }

        if (found === null) {
            throw new NotFoundError('Process not found: ' + pid)
        }

        for (const process of listing.processes) {
            if (process.pid === found.parentPid) {
                parent = {pid: process.pid, name: process.name}
            }
            if (process.parentPid === pid) {
                children.push({pid: process.pid, name: process.name})
            }
        }

        return {
            process: found,
            executable: await this.readExecutable(pid),
            arguments: await this.readArguments(pid),
            parent: parent,
            children: children
        }
    }
}
