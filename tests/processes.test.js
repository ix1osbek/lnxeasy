import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    parseCommandLine,
    parseCpuTimes,
    parseProcessStat,
    parseProcessStatus,
    parseUserNames,
} from '../src/modules/processes/processes.parser.js'
import { ProcessesService } from '../src/modules/processes/processes.service.js'
import { regProcessesRoutes } from '../src/modules/processes/processes.routes.js'
import { Router } from '../src/http/router.js'
import { BadRequestError, NotFoundError } from '../src/core/errors.js'

// Builds a /proc/<pid>/stat line. Only the fields the parser reads are meaningful.
function statLine(pid, name, state, parentPid, userTicks, systemTicks, nice, threads, startTicks) {
    const fields = [state, parentPid, 1, 1, 0, -1, 4194304, 0, 0, 0, 0, userTicks, systemTicks, 0, 0, 20, nice, threads, 0, startTicks, 1000, 100]
    return pid + ' (' + name + ') ' + fields.join(' ') + '\n'
}

function statusText(uid, residentKilobytes) {
    let text = 'Name:\tx\nUid:\t' + uid + '\t' + uid + '\t' + uid + '\t' + uid + '\n'
    if (residentKilobytes !== null) {
        text = text + 'VmRSS:\t    ' + residentKilobytes + ' kB\n'
    }
    return text + 'Threads:\t1\n'
}

function cpuText(busy, idle) {
    return [
        'cpu  ' + busy * 2 + ' 0 0 ' + idle * 2 + ' 0 0 0 0 0 0',
        'cpu0 ' + busy + ' 0 0 ' + idle + ' 0 0 0 0 0 0',
        'cpu1 ' + busy + ' 0 0 ' + idle + ' 0 0 0 0 0 0',
        'intr 1 2 3',
        'btime 1700000000',
        '',
    ].join('\n')
}

// A fake /proc that the test can change between two readings.
function createFakeProc() {
    const proc = {
        files: {
            '/proc/meminfo': 'MemTotal:       1000000 kB\nMemFree: 1 kB\n',
            '/etc/passwd': 'root:x:0:0:root:/root:/bin/bash\nwww-data:x:33:33::/var/www:/usr/sbin/nologin\n',
        },
        links: {},
    }

    proc.setProcess = (pid, name, state, parentPid, cpuTicks, uid, residentKilobytes, commandLine, startTicks) => {
        proc.files['/proc/' + pid + '/stat'] = statLine(pid, name, state, parentPid, cpuTicks, 0, 0, 2, startTicks)
        proc.files['/proc/' + pid + '/status'] = statusText(uid, residentKilobytes)
        proc.files['/proc/' + pid + '/cmdline'] = commandLine
    }

    proc.removeProcess = (pid) => {
        delete proc.files['/proc/' + pid + '/stat']
        delete proc.files['/proc/' + pid + '/status']
        delete proc.files['/proc/' + pid + '/cmdline']
    }

    proc.fs = {
        readFile: async (path) => {
            if (proc.files[path] === undefined) {
                const error = new Error('no such file: ' + path)
                error.code = 'ENOENT'
                throw error
            }
            return proc.files[path]
        },
        readdir: async () => {
            const names = ['cpuinfo', 'self', 'sys']
            for (const path of Object.keys(proc.files)) {
                const parts = path.split('/')
                if (parts[1] === 'proc' && parts[3] === 'stat') {
                    names.push(parts[2])
                }
            }
            return names
        },
        readlink: async (path) => {
            if (proc.links[path] === undefined) {
                const error = new Error('permission denied')
                error.code = 'EACCES'
                throw error
            }
            return proc.links[path]
        },
    }

    return proc
}

// Two readings ten seconds apart: nginx used 5 seconds of CPU in between.
function createService() {
    const proc = createFakeProc()
    const clock = { time: 1000000 }

    proc.files['/proc/stat'] = cpuText(1000, 9000)
    proc.setProcess(1, 'systemd', 'S', 0, 100, 0, 8000, '/sbin/init\0splash\0', 10)
    proc.setProcess(40, 'nginx', 'R', 1, 200, 33, 50000, 'nginx: worker process\0', 5000)
    proc.setProcess(41, 'kworker/0:1', 'I', 2, 0, 0, null, '', 20)

    const sleep = async () => {
        clock.time = clock.time + 10000
        proc.files['/proc/stat'] = cpuText(1250, 9750)
        proc.setProcess(40, 'nginx', 'R', 1, 700, 33, 50000, 'nginx: worker process\0', 5000)
    }

    const service = new ProcessesService(proc.fs, () => clock.time, sleep)

    return { service: service, proc: proc, clock: clock }
}

test('parseProcessStat reads the fields by position', () => {
    const stat = parseProcessStat(statLine(812, 'nginx', 'S', 1, 150, 50, -5, 4, 9000))

    assert.deepEqual(stat, {
        pid: 812,
        name: 'nginx',
        state: 'sleeping',
        parentPid: 1,
        cpuTicks: 200,
        nice: -5,
        threads: 4,
        startTicks: 9000,
    })
})

test('parseProcessStat copes with spaces and brackets in the process name', () => {
    const stat = parseProcessStat(statLine(7, 'Web Content) R (x', 'R', 3, 1, 1, 0, 1, 5))

    assert.equal(stat.name, 'Web Content) R (x')
    assert.equal(stat.state, 'running')
    assert.equal(stat.parentPid, 3)
})

test('parseProcessStat rejects text that is not a stat line', () => {
    assert.throws(() => parseProcessStat('not a stat line'), /Unexpected/)
    assert.throws(() => parseProcessStat('12 (short) R 1 2'), /Unexpected/)
})

test('parseProcessStatus reads the owner and the memory in bytes', () => {
    assert.deepEqual(parseProcessStatus(statusText(33, 2048)), { uid: 33, memoryBytes: 2048 * 1024 })
})

test('parseProcessStatus gives zero memory to a kernel thread', () => {
    assert.deepEqual(parseProcessStatus(statusText(0, null)), { uid: 0, memoryBytes: 0 })
    assert.throws(() => parseProcessStatus('Name:\tx\n'), /Uid is missing/)
})

test('parseCommandLine joins the arguments with spaces', () => {
    assert.equal(parseCommandLine('/usr/bin/node\0server.js\0--port\x004321\0'), '/usr/bin/node server.js --port 4321')
    assert.equal(parseCommandLine(''), '')
})

test('parseCpuTimes separates busy time from idle time for every core', () => {
    const times = parseCpuTimes('cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 100 0 50 800 50 0 0 0 0 0\nbtime 1700000000\n')

    assert.equal(times.bootTime, 1700000000)
    assert.deepEqual(times.all, { name: 'cpu', totalTicks: 1000, busyTicks: 150 })
    assert.equal(times.cores.length, 1)
    assert.throws(() => parseCpuTimes('nothing here'), /Unexpected/)
})

test('parseUserNames maps user ids to names and ignores broken lines', () => {
    const names = parseUserNames('root:x:0:0::/root:/bin/sh\n# comment\n\nwww-data:x:33:33::/var/www:/bin/false\ntoor:x:0:0::/root:/bin/sh\n')

    assert.equal(names.get(0), 'root')
    assert.equal(names.get(33), 'www-data')
    assert.equal(names.size, 2)
})

test('list reports how much CPU each process used between two readings', async () => {
    const { service } = createService()

    const listing = await service.list()
    const nginx = listing.processes.find((process) => process.pid === 40)
    const systemd = listing.processes.find((process) => process.pid === 1)

    assert.equal(nginx.cpuPercent, 50)
    assert.equal(systemd.cpuPercent, 0)
    assert.equal(listing.summary.cpuPercent, 25)
    assert.deepEqual(listing.summary.cores, [{ id: 0, percent: 25 }, { id: 1, percent: 25 }])
})

test('list describes each process with its owner, memory and start time', async () => {
    const { service } = createService()

    const listing = await service.list()
    const nginx = listing.processes.find((process) => process.pid === 40)

    assert.deepEqual(nginx, {
        pid: 40,
        parentPid: 1,
        name: 'nginx',
        user: 'www-data',
        state: 'running',
        nice: 0,
        threads: 2,
        cpuPercent: 50,
        memoryBytes: 50000 * 1024,
        memoryPercent: 5,
        startedAt: new Date((1700000000 + 50) * 1000).toISOString(),
        command: 'nginx: worker process',
        kernelThread: false,
    })
})

test('list marks kernel threads and counts tasks, running tasks and threads', async () => {
    const { service } = createService()

    const listing = await service.list()
    const worker = listing.processes.find((process) => process.pid === 41)

    assert.equal(worker.kernelThread, true)
    assert.equal(worker.command, '[kworker/0:1]')
    assert.equal(worker.memoryBytes, 0)
    assert.deepEqual(
        { tasks: listing.summary.tasks, running: listing.summary.running, threads: listing.summary.threads },
        { tasks: 3, running: 1, threads: 6 }
    )
})

test('list shows the user id when the user has no name', async () => {
    const { service, proc } = createService()
    proc.setProcess(50, 'app', 'S', 1, 0, 1005, 100, 'app\0', 30)

    const listing = await service.list()

    assert.equal(listing.processes.find((process) => process.pid === 50).user, '1005')
})

test('list skips a process that ends while it is being read', async () => {
    const { service, proc } = createService()
    proc.setProcess(60, 'short', 'S', 1, 0, 0, 100, 'short\0', 40)
    delete proc.files['/proc/60/status']

    const listing = await service.list()

    assert.equal(listing.processes.some((process) => process.pid === 60), false)
    assert.equal(listing.summary.tasks, 3)
})

test('list does not credit a new process with the CPU time of an old one that had the same id', async () => {
    const { service, proc, clock } = createService()
    await service.list()

    clock.time = clock.time + 10000
    proc.setProcess(40, 'other', 'S', 1, 5, 0, 100, 'other\0', 99999)
    const listing = await service.list()

    assert.equal(listing.processes.find((process) => process.pid === 40).cpuPercent, 0)
})

test('list answers from memory when asked again within a second', async () => {
    const { service, proc, clock } = createService()
    const first = await service.list()

    proc.removeProcess(40)
    clock.time = clock.time + 500
    assert.equal(await service.list(), first)

    clock.time = clock.time + 600
    const later = await service.list()
    assert.equal(later.processes.some((process) => process.pid === 40), false)
})

test('get returns one process with its parent, children and executable', async () => {
    const { service, proc } = createService()
    proc.setProcess(45, 'nginx', 'S', 40, 0, 33, 100, 'nginx: cache\0', 6000)
    proc.links['/proc/40/exe'] = '/usr/sbin/nginx'

    const details = await service.get(40)

    assert.equal(details.process.pid, 40)
    assert.equal(details.executable, '/usr/sbin/nginx')
    assert.deepEqual(details.parent, { pid: 1, name: 'systemd' })
    assert.deepEqual(details.children, [{ pid: 45, name: 'nginx' }])
})

test('get leaves the executable empty when it may not be read, and rejects an unknown id', async () => {
    const { service } = createService()

    assert.equal((await service.get(1)).executable, null)
    await assert.rejects(service.get(99999), NotFoundError)
})

function createFakeResponse() {
    const res = { statusCode: null, body: null }
    res.writeHead = (statusCode) => {
        res.statusCode = statusCode
    }
    res.end = (body) => {
        res.body = body
    }
    return res
}

function createRouter() {
    const router = new Router()
    const asked = []
    const processesService = {
        list: async () => ({ summary: {}, processes: [] }),
        get: async (pid) => {
            asked.push(pid)
            return { process: { pid: pid }, executable: null, parent: null, children: [] }
        },
    }
    const portsService = {
        list: async () => [
            { protocol: 'tcp', state: 'LISTEN', address: '0.0.0.0', port: 80, processes: [{ name: 'nginx', pid: 40 }, { name: 'nginx', pid: 41 }] },
            { protocol: 'tcp', state: 'LISTEN', address: '0.0.0.0', port: 22, processes: [{ name: 'sshd', pid: 9 }] },
        ],
    }

    regProcessesRoutes(router, processesService, portsService)

    return { router: router, asked: asked }
}

test('GET /api/process adds the ports that the process listens on', async () => {
    const { router, asked } = createRouter()
    const res = createFakeResponse()

    await router.match('GET', '/api/process')({ url: '/api/process?pid=40' }, res)

    assert.deepEqual(asked, [40])
    assert.deepEqual(JSON.parse(res.body).data.ports, [{ protocol: 'tcp', address: '0.0.0.0', port: 80 }])
})

test('GET /api/process accepts only a positive whole number as the pid', async () => {
    const { router, asked } = createRouter()
    const handler = router.match('GET', '/api/process')

    for (const url of ['/api/process', '/api/process?pid=', '/api/process?pid=abc', '/api/process?pid=-1', '/api/process?pid=1.5', '/api/process?pid=1;ls', '/api/process?id=4']) {
        await assert.rejects(handler({ url: url }, createFakeResponse()), BadRequestError, url)
    }
    assert.deepEqual(asked, [])
})
