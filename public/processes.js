'use strict'

const PROCESSES_PAGE_SIZE = 25
const ACTIVE_CPU_PERCENT = 0.1

const processView = {
    processes: [],
    summary: null,
    system: null,
    search: '',
    kind: 'programs',
    activity: 'all',
    sortBy: 'cpuPercent',
    sortDescending: true,
    page: 1,
    openPid: null
}

function formatPercent(value) {
    return value.toFixed(1) + '%'
}

function formatAge(startedAt) {
    const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)

    if (seconds < 60) {
        return seconds + 's'
    }
    if (seconds < 3600) {
        return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's'
    }

    return formatDuration(seconds)
}

function describeState(state) {
    if (state === 'running') {
        return {label: 'Running', kind: 'running'}
    }
    if (state === 'zombie' || state === 'stopped' || state === 'dead') {
        return {label: state.charAt(0).toUpperCase() + state.slice(1), kind: 'trouble'}
    }

    return {label: state.charAt(0).toUpperCase() + state.slice(1), kind: 'quiet'}
}

function processMatchesFilters(process) {
    if (processView.kind === 'programs' && process.kernelThread) {
        return false
    }
    if (processView.kind === 'kernel' && !process.kernelThread) {
        return false
    }
    if (processView.activity === 'active' && process.cpuPercent < ACTIVE_CPU_PERCENT) {
        return false
    }
    if (processView.search === '') {
        return true
    }

    const searchable = (process.pid + ' ' + process.name + ' ' + process.user + ' ' + process.command).toLowerCase()

    for (const word of processView.search.split(' ')) {
        if (word !== '' && !searchable.includes(word)) {
            return false
        }
    }

    return true
}

function compareProcesses(a, b) {
    let first = a[processView.sortBy]
    let second = b[processView.sortBy]

    if (typeof first === 'string') {
        first = first.toLowerCase()
        second = second.toLowerCase()
    }

    let result = 0
    if (first < second) {
        result = -1
    }
    if (first > second) {
        result = 1
    }
    if (processView.sortBy === 'startedAt') {
        result = -result
    }
    if (processView.sortDescending) {
        result = -result
    }
    if (result === 0) {
        result = a.pid - b.pid
    }

    return result
}

function createProcessRow(process) {
    const row = document.createElement('tr')
    const state = describeState(process.state)

    row.appendChild(createElement('td', 'cell-number', String(process.pid)))
    row.appendChild(createElement('td', 'cell-strong', process.name))
    row.appendChild(createElement('td', '', process.user))

    const cpuCell = createElement('td', 'cell-number', formatPercent(process.cpuPercent))
    if (process.cpuPercent >= 80) {
        cpuCell.classList.add('cell-hot')
    } else if (process.cpuPercent >= 20) {
        cpuCell.classList.add('cell-warm')
    }
    row.appendChild(cpuCell)

    let memoryText = '—'
    if (process.memoryBytes > 0) {
        memoryText = formatBytes(process.memoryBytes) + ' · ' + formatPercent(process.memoryPercent)
    }
    row.appendChild(createElement('td', 'cell-number', memoryText))
    row.appendChild(createElement('td', 'cell-number', String(process.threads)))

    const stateCell = document.createElement('td')
    stateCell.appendChild(createElement('span', 'badge is-' + state.kind, state.label))
    row.appendChild(stateCell)

    row.appendChild(createElement('td', '', formatAge(process.startedAt)))

    const commandCell = createElement('td', 'cell-command', process.command)
    commandCell.title = process.command
    row.appendChild(commandCell)

    row.addEventListener('click', () => {
        openProcess(process.pid)
    })

    return row
}

function createCoreMeter(core) {
    const wrap = createElement('div', 'core')
    const meter = createElement('div', 'meter')
    const fill = createElement('div', 'meter-fill')

    let width = core.percent
    if (width > 100) {
        width = 100
    }
    fill.style.width = width + '%'
    fill.classList.toggle('is-warn', core.percent >= 70 && core.percent < 90)
    fill.classList.toggle('is-danger', core.percent >= 90)

    meter.appendChild(fill)
    wrap.appendChild(createElement('span', 'core-label', String(core.id)))
    wrap.appendChild(meter)
    wrap.appendChild(createElement('span', 'core-value', formatPercent(core.percent)))

    return wrap
}

function renderUsage() {
    const summary = processView.summary
    const cores = byId('cores')
    cores.textContent = ''

    for (const core of summary.cores) {
        cores.appendChild(createCoreMeter(core))
    }

    setText('cpu-total', formatPercent(summary.cpuPercent) + ' of ' + countCores(summary.cores.length))
    setText('processes-summary', summary.tasks + ' tasks · ' + summary.running + ' running · ' + summary.threads + ' threads')

    const system = processView.system
    if (system === null) {
        return
    }

    const memoryPercent = toPercent(system.memory.usedBytes, system.memory.totalBytes)
    setText('usage-memory-text', formatBytes(system.memory.usedBytes) + ' of ' + formatBytes(system.memory.totalBytes) + ' · ' + memoryPercent + '%')
    setMeter('usage-memory-bar', memoryPercent)

    if (system.swap.totalBytes === 0) {
        setText('usage-swap-text', 'not configured')
        setMeter('usage-swap-bar', 0)
    } else {
        const swapPercent = toPercent(system.swap.usedBytes, system.swap.totalBytes)
        setText('usage-swap-text', formatBytes(system.swap.usedBytes) + ' of ' + formatBytes(system.swap.totalBytes) + ' · ' + swapPercent + '%')
        setMeter('usage-swap-bar', swapPercent)
    }

    setText('usage-load', system.loadAverage.one.toFixed(2) + ' · ' + system.loadAverage.five.toFixed(2) + ' · ' + system.loadAverage.fifteen.toFixed(2))
}

function renderProcessSortHeaders() {
    for (const button of document.querySelectorAll('#processes-table .sort')) {
        const isActive = button.dataset.sort === processView.sortBy
        const arrow = button.querySelector('.sort-arrow')

        button.classList.toggle('is-active', isActive)

        if (!isActive) {
            arrow.textContent = ''
        } else if (processView.sortDescending) {
            arrow.textContent = '▼'
        } else {
            arrow.textContent = '▲'
        }
    }
}

function setKindCount(value, count) {
    document.querySelector('#filter-kind [data-count="' + value + '"]').textContent = String(count)
}

function renderProcesses() {
    const matching = []
    let kernelCount = 0

    for (const process of processView.processes) {
        if (process.kernelThread) {
            kernelCount = kernelCount + 1
        }
        if (processMatchesFilters(process)) {
            matching.push(process)
        }
    }
    matching.sort(compareProcesses)

    let pageCount = Math.ceil(matching.length / PROCESSES_PAGE_SIZE)
    if (pageCount < 1) {
        pageCount = 1
    }
    if (processView.page > pageCount) {
        processView.page = pageCount
    }

    const start = (processView.page - 1) * PROCESSES_PAGE_SIZE
    const body = byId('processes-body')
    body.textContent = ''

    for (const process of matching.slice(start, start + PROCESSES_PAGE_SIZE)) {
        body.appendChild(createProcessRow(process))
    }

    setKindCount('programs', processView.processes.length - kernelCount)
    setKindCount('kernel', kernelCount)
    setKindCount('all', processView.processes.length)

    byId('processes-empty').hidden = matching.length > 0
    byId('processes-search-clear').hidden = processView.search === ''

    renderProcessSortHeaders()
    drawPager('processes-pager', matching.length, processView.page, PROCESSES_PAGE_SIZE, (page) => {
        processView.page = page
        renderProcesses()
    })
}

async function refreshProcesses() {
    try {
        const listing = await fetchData('/api/processes')
        processView.processes = listing.processes
        processView.summary = listing.summary
        hideError('processes')
    } catch (error) {
        showError('processes', error)
        return false
    }

    renderUsage()
    renderProcesses()

    if (processView.openPid !== null && byId('process-dialog').open) {
        loadProcess(processView.openPid)
    }

    return true
}

function renderProcessDetails(details) {
    const process = details.process
    const state = describeState(process.state)
    const badge = byId('process-state')

    setText('process-name', process.name)
    setText('process-pid', 'PID ' + process.pid)
    badge.textContent = state.label
    badge.className = 'badge is-' + state.kind

    setText('process-cpu', formatPercent(process.cpuPercent))
    if (process.memoryBytes > 0) {
        setText('process-memory', formatBytes(process.memoryBytes) + ' · ' + formatPercent(process.memoryPercent))
    } else {
        setText('process-memory', '—')
    }
    setText('process-threads', String(process.threads))
    setText('process-user', process.user)
    setText('process-started', new Date(process.startedAt).toLocaleString())
    setText('process-age', formatAge(process.startedAt))
    setText('process-nice', String(process.nice))

    const parent = byId('process-parent')
    parent.textContent = ''
    if (details.parent === null) {
        parent.textContent = '—'
    } else {
        const link = createElement('button', 'process-link', details.parent.name)
        link.type = 'button'
        link.addEventListener('click', () => {
            openProcess(details.parent.pid)
        })
        parent.appendChild(link)
        parent.appendChild(createElement('span', 'chip-note', 'PID ' + details.parent.pid))
    }

    setText('process-command', process.command)
    if (details.executable !== null) {
        setText('process-executable', 'Program file: ' + details.executable)
    } else if (process.kernelThread) {
        setText('process-executable', 'A kernel thread: part of Linux itself, not a program file.')
    } else {
        setText('process-executable', 'The program file path is only visible for processes of the user lnxeasy runs as.')
    }

    const ports = byId('process-ports')
    ports.textContent = ''
    for (const port of details.ports) {
        const reach = describeReach(port.address)
        const row = document.createElement('tr')
        const reachCell = document.createElement('td')

        row.appendChild(createElement('td', 'cell-strong', String(port.port)))
        row.appendChild(createElement('td', '', port.protocol.toUpperCase()))
        row.appendChild(createElement('td', '', port.address))
        reachCell.appendChild(createElement('span', 'badge is-' + reach.kind, reach.label))
        row.appendChild(reachCell)
        ports.appendChild(row)
    }
    byId('process-ports-table').hidden = details.ports.length === 0
    byId('process-ports-empty').hidden = details.ports.length > 0

    const children = byId('process-children')
    children.textContent = ''
    for (const child of details.children) {
        const chip = createElement('button', 'chip', child.name)
        chip.type = 'button'
        chip.appendChild(createElement('span', 'chip-note', String(child.pid)))
        chip.addEventListener('click', () => {
            openProcess(child.pid)
        })
        children.appendChild(chip)
    }
    byId('process-children-empty').hidden = details.children.length > 0
}

async function loadProcess(pid) {
    let details = null

    try {
        details = await fetchData('/api/process?pid=' + pid)
    } catch (error) {
        if (processView.openPid !== pid) {
            return
        }

        byId('process-content').hidden = true
        byId('process-error').hidden = false
        if (error.code === 'NOT_FOUND') {
            setText('process-error', 'This process has ended.')
        } else {
            setText('process-error', error.message)
        }
        return
    }

    if (processView.openPid !== pid) {
        return
    }

    byId('process-error').hidden = true
    byId('process-content').hidden = false
    renderProcessDetails(details)
}

function openProcess(pid) {
    const dialog = byId('process-dialog')
    processView.openPid = pid

    if (!dialog.open) {
        setText('process-name', 'Loading…')
        setText('process-pid', 'PID ' + pid)
        byId('process-state').textContent = ''
        byId('process-state').className = 'badge'
        byId('process-content').hidden = true
        byId('process-error').hidden = true
        dialog.showModal()
    }

    loadProcess(pid)
}

function closeProcess() {
    processView.openPid = null
    byId('process-dialog').close()
}

function wireProcessSegments(groupId, key) {
    for (const button of document.querySelectorAll('#' + groupId + ' .segment')) {
        button.addEventListener('click', () => {
            processView[key] = button.dataset.value
            processView.page = 1
            for (const other of document.querySelectorAll('#' + groupId + ' .segment')) {
                other.classList.toggle('is-active', other === button)
            }
            renderProcesses()
        })
    }
}

function setProcessSearch(text) {
    processView.search = text.trim().toLowerCase()
    processView.page = 1
    renderProcesses()
}

wireProcessSegments('filter-kind', 'kind')
wireProcessSegments('filter-state', 'activity')

byId('processes-search').addEventListener('input', (event) => {
    setProcessSearch(event.target.value)
})

byId('processes-search-clear').addEventListener('click', () => {
    byId('processes-search').value = ''
    setProcessSearch('')
    byId('processes-search').focus()
})

for (const button of document.querySelectorAll('#processes-table .sort')) {
    button.addEventListener('click', () => {
        if (processView.sortBy === button.dataset.sort) {
            processView.sortDescending = !processView.sortDescending
        } else {
            processView.sortBy = button.dataset.sort
            processView.sortDescending = button.dataset.sort !== 'name' && button.dataset.sort !== 'user' && button.dataset.sort !== 'pid'
        }
        processView.page = 1
        renderProcesses()
    })
}

byId('process-close').addEventListener('click', closeProcess)

byId('process-dialog').addEventListener('close', () => {
    processView.openPid = null
})

startApp()
