import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    AppError,
    NotFoundError,
    CommandNotFoundError,
    CommandFailedError,
    CommandTimeoutError,
} from '../src/core/errors.js'

test('AppError keeps the status code, the code and the message', () => {
    const error = new AppError(418, 'TEAPOT', 'I am a teapot')

    assert.equal(error instanceof Error, true)
    assert.equal(error.name, 'AppError')
    assert.equal(error.statusCode, 418)
    assert.equal(error.code, 'TEAPOT')
    assert.equal(error.message, 'I am a teapot')
})

test('NotFoundError is a 404 AppError', () => {
    const error = new NotFoundError('Route not found: GET /nope')

    assert.equal(error instanceof AppError, true)
    assert.equal(error.name, 'NotFoundError')
    assert.equal(error.statusCode, 404)
    assert.equal(error.code, 'NOT_FOUND')
    assert.equal(error.message, 'Route not found: GET /nope')
})

test('CommandNotFoundError builds its message from the command name', () => {
    const error = new CommandNotFoundError('ss')

    assert.equal(error instanceof AppError, true)
    assert.equal(error.name, 'CommandNotFoundError')
    assert.equal(error.statusCode, 500)
    assert.equal(error.code, 'COMMAND_NOT_FOUND')
    assert.equal(error.message, 'Command not found: ss')
    assert.equal(error.command, 'ss')
})

test('CommandFailedError keeps the exit code and stderr', () => {
    const error = new CommandFailedError('df', 1, 'df: no such file\n')

    assert.equal(error instanceof AppError, true)
    assert.equal(error.name, 'CommandFailedError')
    assert.equal(error.statusCode, 500)
    assert.equal(error.code, 'COMMAND_FAILED')
    assert.equal(error.message, 'Command "df" exited with code 1')
    assert.equal(error.command, 'df')
    assert.equal(error.exitCode, 1)
    assert.equal(error.stderr, 'df: no such file\n')
})

test('CommandFailedError does not put stderr into the message', () => {
    const error = new CommandFailedError('df', 1, 'secret path /home/admin')

    assert.equal(error.message.includes('secret'), false)
})

test('CommandTimeoutError is a 504 and keeps the timeout', () => {
    const error = new CommandTimeoutError('systemctl', 5000)

    assert.equal(error instanceof AppError, true)
    assert.equal(error.name, 'CommandTimeoutError')
    assert.equal(error.statusCode, 504)
    assert.equal(error.code, 'COMMAND_TIMEOUT')
    assert.equal(error.message, 'Command "systemctl" did not finish in 5000 ms')
    assert.equal(error.command, 'systemctl')
    assert.equal(error.timeoutMs, 5000)
})
