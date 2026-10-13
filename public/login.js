'use strict'

const form = document.getElementById('login-form')
const errorLine = document.getElementById('login-error')
const submitButton = document.getElementById('login-submit')
const codeField = document.getElementById('code-field')
const codeInput = document.getElementById('code')

function showError(text) {
    errorLine.textContent = text
    errorLine.hidden = false
}

function setBusy(busy) {
    submitButton.disabled = busy
    if (busy) {
        submitButton.textContent = 'Signing in…'
    } else {
        submitButton.textContent = 'Sign in'
    }
}

function askForCode() {
    codeField.hidden = false
    codeInput.required = true
    codeInput.value = ''
    codeInput.focus()
}

function withFullStop(text) {
    if (text.endsWith('.')) {
        return text
    }
    return text + '.'
}

async function signIn() {
    const credentials = {
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value
    }

    if (!codeField.hidden) {
        credentials.code = codeInput.value.trim()
    }

    let response = null
    try {
        response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(credentials)
        })
    } catch (e) {
        showError('The server does not answer.')
        return
    }

    if (response.ok) {
        window.location.replace('/')
        return
    }

    let code = ''
    let message = 'Could not sign in.'
    try {
        const body = await response.json()
        if (body.error) {
            code = body.error.code
            message = body.error.message
        }
    } catch (e) {
        message = 'Could not sign in.'
    }

    if (code === 'TOTP_REQUIRED') {
        askForCode()
        return
    }

    showError(withFullStop(message))

    if (code === 'INVALID_CODE') {
        codeInput.select()
    } else {
        document.getElementById('password').select()
    }
}

form.addEventListener('submit', async (event) => {
    event.preventDefault()
    errorLine.hidden = true
    setBusy(true)
    await signIn()
    setBusy(false)
})
