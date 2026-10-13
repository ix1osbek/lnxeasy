'use strict'

const REFRESH_INTERVAL_MS = 5000
const PAGE_SIZE = 25
const MASKED_ADDRESS = '•••.•••.•••.•••'
const IP_HIDDEN_KEY = 'lnxeasy.ipHidden'

const state = {
    rows: [],
    search: '',
    protocol: 'all',
    reach: 'all',
    process: 'all',
    sortBy: 'port',
    sortDescending: false,
    page: 1,
    paused: false,
    lastUpdate: null,
    serverAddress: null,
    ipHidden: readIpHidden()
}

function byId(id) {
    return document.getElementById(id)
}

function readIpHidden() {
    try {
        return localStorage.getItem(IP_HIDDEN_KEY) === 'yes'
    } catch (e) {
        return false
    }
}

function saveIpHidden(hidden) {
    try {
        if (hidden) {
            localStorage.setItem(IP_HIDDEN_KEY, 'yes')
        } else {
            localStorage.removeItem(IP_HIDDEN_KEY)
        }
    } catch (e) {
        return
    }
}

async function fetchData(path) {
    let response = null
    try {
        response = await fetch(path, {cache: 'no-store'})
    } catch (e) {
        throw createApiError('OFFLINE', 'The server does not answer.')
    }

    let body = null
    try {
        body = await response.json()
    } catch (e) {
        throw createApiError('BAD_RESPONSE', 'The server sent an answer that is not JSON.')
    }

    if (body.error) {
        if (body.error.code === 'UNAUTHORIZED') {
            window.location.replace('/login')
        }
        throw createApiError(body.error.code, body.error.message)
    }

    return body.data
}

async function postData(path, data) {
    let response = null
    try {
        response = await fetch(path, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        })
    } catch (e) {
        throw createApiError('OFFLINE', 'The server does not answer.')
    }

    let body = null
    try {
        body = await response.json()
    } catch (e) {
        throw createApiError('BAD_RESPONSE', 'The server sent an answer that is not JSON.')
    }

    if (body.error) {
        if (body.error.code === 'UNAUTHORIZED') {
            window.location.replace('/login')
        }
        throw createApiError(body.error.code, body.error.message)
    }

    return body.data
}

function createApiError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
}

function formatBytes(bytes) {
    const gibibyte = 1024 * 1024 * 1024
    const mebibyte = 1024 * 1024

    if (bytes >= gibibyte) {
        return (bytes / gibibyte).toFixed(1) + ' GiB'
    }

    return Math.round(bytes / mebibyte) + ' MiB'
}

function formatDuration(totalSeconds) {
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)

    if (days > 0) {
        return days + 'd ' + hours + 'h'
    }
    if (hours > 0) {
        return hours + 'h ' + minutes + 'm'
    }
    return minutes + 'm'
}

function toPercent(part, total) {
    if (total <= 0) {
        return 0
    }
    return Math.round((part / total) * 100)
}

function setText(id, text) {
    byId(id).textContent = text
}

function setMeter(id, percent) {
    const bar = byId(id)
    let width = percent
    if (width > 100) {
        width = 100
    }

    bar.style.width = width + '%'
    bar.classList.toggle('is-warn', percent >= 70 && percent < 90)
    bar.classList.toggle('is-danger', percent >= 90)
}

function createElement(tagName, className, text) {
    const element = document.createElement(tagName)
    if (className) {
        element.className = className
    }
    if (text !== undefined) {
        element.textContent = text
    }
    return element
}

function showError(prefix, error) {
    byId(prefix + '-error').hidden = false
    setText(prefix + '-error-title', error.code)
    setText(prefix + '-error-text', describeError(error))
}

function hideError(prefix) {
    byId(prefix + '-error').hidden = true
}

function describeError(error) {
    if (error.code === 'COMMAND_NOT_FOUND') {
        return error.message + '. Install it on the server (the "ss" command is part of the iproute2 package).'
    }
    if (error.code === 'COMMAND_TIMEOUT') {
        return error.message + '. The server may be overloaded.'
    }
    return error.message
}

function renderServerAddress() {
    const element = byId('server-ip')
    const button = byId('toggle-ip')

    if (state.serverAddress === null) {
        element.textContent = '—'
        document.title = 'lnxeasy'
        return
    }

    element.classList.toggle('is-masked', state.ipHidden)
    byId('icon-eye').hidden = state.ipHidden
    byId('icon-eye-off').hidden = !state.ipHidden

    if (state.ipHidden) {
        element.textContent = MASKED_ADDRESS
        button.title = 'Show the server address'
        button.setAttribute('aria-label', 'Show the server address')
        document.title = 'lnxeasy'
    } else {
        element.textContent = state.serverAddress
        button.title = 'Hide the server address'
        button.setAttribute('aria-label', 'Hide the server address')
        document.title = state.serverAddress + ' · lnxeasy'
    }
}

function renderSystem(info) {
    if (info.ipAddress) {
        state.serverAddress = info.ipAddress
    } else {
        state.serverAddress = info.hostname
    }
    renderServerAddress()

    setText('system-line', info.hostname + ' · ' + info.cpu.model + ' · ' + info.cpu.cores + ' cores · ' + info.platform + ' ' + info.arch)

    setText('uptime', formatDuration(info.uptimeSeconds))
    setText('kernel', 'Kernel ' + info.release)

    const loadPercent = toPercent(info.loadAverage.one, info.cpu.cores)
    setText('load-one', info.loadAverage.one.toFixed(2))
    setText('load-percent', loadPercent + '% of ' + info.cpu.cores + ' cores')
    setMeter('load-bar', loadPercent)
    setText('load-detail', '5 min ' + info.loadAverage.five.toFixed(2) + ' · 15 min ' + info.loadAverage.fifteen.toFixed(2))

    const memoryPercent = toPercent(info.memory.usedBytes, info.memory.totalBytes)
    setText('memory-used', formatBytes(info.memory.usedBytes))
    setText('memory-total', 'of ' + formatBytes(info.memory.totalBytes))
    setMeter('memory-bar', memoryPercent)
    setText('memory-detail', memoryPercent + '% used · ' + formatBytes(info.memory.availableBytes) + ' available')

    if (info.swap.totalBytes === 0) {
        setText('swap-used', 'None')
        setText('swap-total', '')
        setMeter('swap-bar', 0)
        setText('swap-detail', 'Swap is not configured')
    } else {
        const swapPercent = toPercent(info.swap.usedBytes, info.swap.totalBytes)
        setText('swap-used', formatBytes(info.swap.usedBytes))
        setText('swap-total', 'of ' + formatBytes(info.swap.totalBytes))
        setMeter('swap-bar', swapPercent)
        setText('swap-detail', swapPercent + '% used · ' + formatBytes(info.swap.freeBytes) + ' free')
    }
}

function describeReach(address) {
    const withoutInterface = address.split('%')[0]
    const hasInterface = address.includes('%')
    const plainAddress = withoutInterface.replace('[', '').replace(']', '')

    if (plainAddress.startsWith('127.') || plainAddress === '::1') {
        return {kind: 'local', label: 'This machine only'}
    }

    if (!hasInterface && (plainAddress === '0.0.0.0' || plainAddress === '::' || plainAddress === '*')) {
        return {kind: 'public', label: 'All interfaces'}
    }

    return {kind: 'interface', label: 'One network'}
}

function mergePorts(ports) {
    const rowsByKey = new Map()

    for (const port of ports) {
        const key = port.protocol + '|' + port.address + '|' + port.port
        let row = rowsByKey.get(key)

        if (row === undefined) {
            row = {
                protocol: port.protocol,
                address: port.address,
                port: port.port,
                reach: describeReach(port.address),
                processes: []
            }
            rowsByKey.set(key, row)
        }

        for (const process of port.processes) {
            let alreadyListed = false
            for (const listed of row.processes) {
                if (listed.pid === process.pid) {
                    alreadyListed = true
                }
            }
            if (!alreadyListed) {
                row.processes.push(process)
            }
        }
    }

    return Array.from(rowsByKey.values())
}

function rowMatchesFilters(row) {
    if (state.protocol !== 'all' && row.protocol !== state.protocol) {
        return false
    }

    if (state.reach !== 'all' && row.reach.kind !== state.reach) {
        return false
    }

    if (state.process === 'known' && row.processes.length === 0) {
        return false
    }

    if (state.process === 'hidden' && row.processes.length > 0) {
        return false
    }

    if (state.search === '') {
        return true
    }

    let searchable = row.port + ' ' + row.address + ' ' + row.protocol + ' ' + row.reach.label
    for (const process of row.processes) {
        searchable = searchable + ' ' + process.name + ' ' + process.pid
    }
    searchable = searchable.toLowerCase()

    for (const word of state.search.split(' ')) {
        if (word !== '' && !searchable.includes(word)) {
            return false
        }
    }

    return true
}

function sortValue(row) {
    if (state.sortBy === 'protocol') {
        return row.protocol
    }
    if (state.sortBy === 'address') {
        return row.address
    }
    if (state.sortBy === 'reach') {
        return row.reach.label
    }
    if (state.sortBy === 'process') {
        if (row.processes.length === 0) {
            return '￿'
        }
        return row.processes[0].name.toLowerCase()
    }
    return row.port
}

function compareRows(a, b) {
    const first = sortValue(a)
    const second = sortValue(b)
    let result = 0

    if (first < second) {
        result = -1
    }
    if (first > second) {
        result = 1
    }
    if (result === 0) {
        result = a.port - b.port
    }
    if (state.sortDescending) {
        result = -result
    }

    return result
}

function createPortRow(row) {
    const tr = document.createElement('tr')

    tr.appendChild(createElement('td', 'cell-port', String(row.port)))

    const protocolCell = document.createElement('td')
    protocolCell.appendChild(createElement('span', 'tag', row.protocol))
    tr.appendChild(protocolCell)

    tr.appendChild(createElement('td', '', row.address))

    const reachCell = document.createElement('td')
    reachCell.appendChild(createElement('span', 'badge is-' + row.reach.kind, row.reach.label))
    tr.appendChild(reachCell)

    const processCell = document.createElement('td')
    const pidCell = createElement('td', 'cell-pid')

    if (row.processes.length === 0) {
        processCell.className = 'cell-muted'
        processCell.textContent = 'hidden'
        pidCell.textContent = '—'
    } else {
        for (const process of row.processes) {
            processCell.appendChild(createElement('div', 'process-line', process.name))
            pidCell.appendChild(createElement('div', 'process-line', String(process.pid)))
        }
    }

    tr.appendChild(processCell)
    tr.appendChild(pidCell)

    return tr
}

function countRows(test) {
    let count = 0
    for (const row of state.rows) {
        if (test(row)) {
            count = count + 1
        }
    }
    return count
}

function setSegmentCount(groupId, value, count) {
    const element = document.querySelector('#' + groupId + ' [data-count="' + value + '"]')
    element.textContent = String(count)
}

function renderFilterCounts() {
    setSegmentCount('filter-protocol', 'all', state.rows.length)
    setSegmentCount('filter-protocol', 'tcp', countRows((row) => row.protocol === 'tcp'))
    setSegmentCount('filter-protocol', 'udp', countRows((row) => row.protocol === 'udp'))

    setSegmentCount('filter-reach', 'all', state.rows.length)
    setSegmentCount('filter-reach', 'public', countRows((row) => row.reach.kind === 'public'))
    setSegmentCount('filter-reach', 'interface', countRows((row) => row.reach.kind === 'interface'))
    setSegmentCount('filter-reach', 'local', countRows((row) => row.reach.kind === 'local'))

    setSegmentCount('filter-process', 'all', state.rows.length)
    setSegmentCount('filter-process', 'known', countRows((row) => row.processes.length > 0))
    setSegmentCount('filter-process', 'hidden', countRows((row) => row.processes.length === 0))
}

function createPageButton(label, page, isActive, isDisabled) {
    const button = createElement('button', 'page-button', label)
    button.type = 'button'
    button.disabled = isDisabled

    if (isActive) {
        button.classList.add('is-active')
        button.setAttribute('aria-current', 'page')
    }

    button.addEventListener('click', () => {
        state.page = page
        renderPorts()
    })

    return button
}

function renderPager(total, pageCount) {
    const buttons = byId('pager-buttons')
    buttons.textContent = ''

    if (total === 0) {
        setText('pager-range', '')
        return
    }

    const first = (state.page - 1) * PAGE_SIZE + 1
    let last = state.page * PAGE_SIZE
    if (last > total) {
        last = total
    }
    setText('pager-range', 'Showing ' + first + '–' + last + ' of ' + total)

    if (pageCount === 1) {
        return
    }

    buttons.appendChild(createPageButton('Previous', state.page - 1, false, state.page === 1))

    let previousShown = 0
    for (let page = 1; page <= pageCount; page = page + 1) {
        const isEdge = page === 1 || page === pageCount
        const isNear = page >= state.page - 1 && page <= state.page + 1

        if (!isEdge && !isNear) {
            continue
        }

        if (page - previousShown > 1) {
            buttons.appendChild(createElement('span', 'page-gap', '…'))
        }

        buttons.appendChild(createPageButton(String(page), page, page === state.page, false))
        previousShown = page
    }

    buttons.appendChild(createPageButton('Next', state.page + 1, false, state.page === pageCount))
}

function renderSortHeaders() {
    for (const button of document.querySelectorAll('.sort')) {
        const isActive = button.dataset.sort === state.sortBy
        const arrow = button.querySelector('.sort-arrow')

        button.classList.toggle('is-active', isActive)

        if (!isActive) {
            arrow.textContent = ''
        } else if (state.sortDescending) {
            arrow.textContent = '▼'
        } else {
            arrow.textContent = '▲'
        }
    }
}

function filtersAreActive() {
    return state.search !== '' || state.protocol !== 'all' || state.reach !== 'all' || state.process !== 'all'
}

function renderPorts() {
    const matching = []
    for (const row of state.rows) {
        if (rowMatchesFilters(row)) {
            matching.push(row)
        }
    }
    matching.sort(compareRows)

    let pageCount = Math.ceil(matching.length / PAGE_SIZE)
    if (pageCount < 1) {
        pageCount = 1
    }
    if (state.page > pageCount) {
        state.page = pageCount
    }
    if (state.page < 1) {
        state.page = 1
    }

    const start = (state.page - 1) * PAGE_SIZE
    const visible = matching.slice(start, start + PAGE_SIZE)

    const body = byId('ports-body')
    body.textContent = ''
    for (const row of visible) {
        body.appendChild(createPortRow(row))
    }

    if (matching.length === state.rows.length) {
        setText('ports-count', state.rows.length + ' ports')
    } else {
        setText('ports-count', matching.length + ' of ' + state.rows.length + ' ports')
    }

    byId('ports-empty').hidden = matching.length > 0
    byId('ports-hint').hidden = countRows((row) => row.processes.length === 0) === 0
    byId('filters-reset').hidden = !filtersAreActive()
    byId('ports-search-clear').hidden = state.search === ''

    renderFilterCounts()
    renderSortHeaders()
    renderPager(matching.length, pageCount)
}

function setStatus(kind, text) {
    const status = byId('status')
    status.classList.toggle('is-online', kind === 'online')
    status.classList.toggle('is-offline', kind === 'offline')
    status.classList.toggle('is-paused', kind === 'paused')
    setText('status-text', text)
}

function renderUpdated() {
    if (state.lastUpdate === null) {
        setText('updated', '')
        return
    }

    const seconds = Math.round((Date.now() - state.lastUpdate) / 1000)
    if (seconds < 2) {
        setText('updated', 'Updated just now')
    } else {
        setText('updated', 'Updated ' + seconds + 's ago')
    }
}

async function refresh() {
    let anySuccess = false

    try {
        renderSystem(await fetchData('/api/system'))
        hideError('system')
        anySuccess = true
    } catch (error) {
        showError('system', error)
    }

    try {
        state.rows = mergePorts(await fetchData('/api/ports'))
        hideError('ports')
        anySuccess = true
    } catch (error) {
        state.rows = []
        showError('ports', error)
    }
    renderPorts()

    if (anySuccess) {
        state.lastUpdate = Date.now()
    }

    if (state.paused) {
        setStatus('paused', 'Paused')
    } else if (anySuccess) {
        setStatus('online', 'Online')
    } else {
        setStatus('offline', 'Offline')
    }

    renderUpdated()
}

function tick() {
    if (state.paused || document.hidden) {
        return
    }
    refresh()
}

function selectSegment(groupId, value) {
    for (const button of document.querySelectorAll('#' + groupId + ' .segment')) {
        button.classList.toggle('is-active', button.dataset.value === value)
    }
}

function wireSegments(groupId, stateKey) {
    for (const button of document.querySelectorAll('#' + groupId + ' .segment')) {
        button.addEventListener('click', () => {
            state[stateKey] = button.dataset.value
            state.page = 1
            selectSegment(groupId, button.dataset.value)
            renderPorts()
        })
    }
}

function setSearch(text) {
    state.search = text.trim().toLowerCase()
    state.page = 1
    renderPorts()
}

wireSegments('filter-protocol', 'protocol')
wireSegments('filter-reach', 'reach')
wireSegments('filter-process', 'process')

byId('ports-search').addEventListener('input', (event) => {
    setSearch(event.target.value)
})

byId('ports-search-clear').addEventListener('click', () => {
    byId('ports-search').value = ''
    setSearch('')
    byId('ports-search').focus()
})

byId('filters-reset').addEventListener('click', () => {
    byId('ports-search').value = ''
    state.search = ''
    state.protocol = 'all'
    state.reach = 'all'
    state.process = 'all'
    state.page = 1
    selectSegment('filter-protocol', 'all')
    selectSegment('filter-reach', 'all')
    selectSegment('filter-process', 'all')
    renderPorts()
})

for (const button of document.querySelectorAll('.sort')) {
    button.addEventListener('click', () => {
        if (state.sortBy === button.dataset.sort) {
            state.sortDescending = !state.sortDescending
        } else {
            state.sortBy = button.dataset.sort
            state.sortDescending = false
        }
        state.page = 1
        renderPorts()
    })
}

byId('toggle-ip').addEventListener('click', () => {
    state.ipHidden = !state.ipHidden
    saveIpHidden(state.ipHidden)
    renderServerAddress()
})

byId('toggle-refresh').addEventListener('click', () => {
    state.paused = !state.paused

    if (state.paused) {
        setText('toggle-refresh', 'Resume')
        setStatus('paused', 'Paused')
    } else {
        setText('toggle-refresh', 'Pause')
        refresh()
    }
})

byId('sign-out').addEventListener('click', async () => {
    try {
        await postData('/api/auth/logout', {})
    } catch (error) {
        window.location.replace('/login')
        return
    }
    window.location.replace('/login')
})

function resetPasswordDialog() {
    byId('password-form').reset()
    byId('password-error').hidden = true
    byId('password-success').hidden = true
    byId('password-submit').disabled = false
}

function showPasswordError(text) {
    setText('password-error', text)
    byId('password-error').hidden = false
}

byId('open-password').addEventListener('click', () => {
    resetPasswordDialog()
    byId('password-dialog').showModal()
})

byId('password-cancel').addEventListener('click', () => {
    byId('password-dialog').close()
})

byId('password-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    byId('password-error').hidden = true
    byId('password-success').hidden = true

    const currentPassword = byId('current-password').value
    const newPassword = byId('new-password').value

    if (newPassword !== byId('repeat-password').value) {
        showPasswordError('The new passwords do not match.')
        return
    }

    byId('password-submit').disabled = true

    try {
        await postData('/api/auth/password', {currentPassword: currentPassword, newPassword: newPassword})
    } catch (error) {
        byId('password-submit').disabled = false
        if (error.code === 'INVALID_CREDENTIALS') {
            showPasswordError('The current password is wrong.')
        } else {
            showPasswordError(error.message)
        }
        return
    }

    byId('password-form').reset()
    byId('password-submit').disabled = false
    byId('password-success').hidden = false
})

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !state.paused) {
        refresh()
    }
})

setInterval(tick, REFRESH_INTERVAL_MS)
setInterval(renderUpdated, 1000)
refresh()
