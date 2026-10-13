'use strict'

const form = document.getElementById('login-form')
const errorLine = document.getElementById('login-error')
const submitButton = document.getElementById('login-submit')

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

async function signIn() {
    const credentials = {
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value
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

    let message = 'Could not sign in.'
    try {
        const body = await response.json()
        if (body.error && body.error.message) {
            message = body.error.message
        }
    } catch (e) {
        message = 'Could not sign in.'
    }

    showError(message + (message.endsWith('.') ? '' : '.'))
    document.getElementById('password').select()
}

form.addEventListener('submit', async (event) => {
    event.preventDefault()
    errorLine.hidden = true
    setBusy(true)
    await signIn()
    setBusy(false)
})
