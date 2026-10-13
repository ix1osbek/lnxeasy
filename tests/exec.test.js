import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../src/core/exec.js'
import { AppError, CommandFailedError, CommandNotFoundError, CommandTimeoutError } from '../src/core/errors.js'

// The tests run Node.js itself as the command, because it exists on every machine that runs them.
const NODE = process.execPath

test('run resolves with the text the command wrote to stdout', async () => {
    const result = await run(NODE, ['-e', 'console.log("hello")'])

    assert.equal(result.stdout, 'hello\n')
    assert.equal(result.stderr, '')
})

test('run resolves with the text the command wrote to stderr', async () => {
    const result = await run(NODE, ['-e', 'console.error("warning")'])

    assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'warning\n')
})

test('run passes every argument to the command', async () => {
    const result = await run(NODE, ['-e', 'console.log(process.argv.slice(1).join(","))', 'one', 'two'])

    assert.equal(result.stdout, 'one,two\n')
})

test('run does not let a shell interpret the arguments', async () => {
    const dangerous = '$HOME; echo hacked'

    const result = await run(NODE, ['-e', 'console.log(process.argv[1])', dangerous])

    assert.equal(result.stdout, dangerous + '\n')
})

test('run rejects with CommandFailedError when the command exits with a non-zero code', async () => {
    await assert.rejects(
        run(NODE, ['-e', 'console.error("broken"); process.exit(3)']),
        (error) => {
            assert.equal(error instanceof CommandFailedError, true)
            assert.equal(error.command, NODE)
            assert.equal(error.exitCode, 3)
            assert.equal(error.stderr, 'broken\n')
            return true
        }
    )
})

test('run rejects with CommandNotFoundError when the command does not exist', async () => {
    await assert.rejects(
        run('lnxeasy-command-that-does-not-exist', []),
        (error) => {
            assert.equal(error instanceof CommandNotFoundError, true)
            assert.equal(error.command, 'lnxeasy-command-that-does-not-exist')
            return true
        }
    )
})

test('run rejects with CommandTimeoutError when the command runs longer than the timeout', async () => {
    await assert.rejects(
        run(NODE, ['-e', 'setTimeout(() => {}, 10000)'], 200),
        (error) => {
            assert.equal(error instanceof CommandTimeoutError, true)
            assert.equal(error.command, NODE)
            assert.equal(error.timeoutMs, 200)
            return true
        }
    )
})

test('run does not time out a command that finishes in time', async () => {
    const result = await run(NODE, ['-e', 'console.log("fast")'], 5000)

    assert.equal(result.stdout, 'fast\n')
})

test('run passes an error it does not recognise through unchanged', async () => {
    // A file that exists but is not executable makes the system answer with EACCES.
    await assert.rejects(
        run(import.meta.filename, []),
        (error) => {
            assert.equal(error instanceof AppError, false)
            assert.equal(error.code, 'EACCES')
            return true
        }
    )
})
