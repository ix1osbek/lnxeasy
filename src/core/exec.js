import {execFile} from 'node:child_process'
import {CommandFailedError, CommandNotFoundError, CommandTimeoutError} from './errors.js'

const DEFAULT_TIMEOUT_MS = 5000

export function run(command, args, timeoutMs) {
    let timeout = DEFAULT_TIMEOUT_MS
    if (timeoutMs !== undefined) {
        timeout = timeoutMs
    }

    return new Promise((resolve, reject) => {
        execFile(command, args, {timeout: timeout}, (error, stdout, stderr) => {
            if (!error) {
                resolve({
                    stdout: stdout,
                    stderr: stderr
                })
                return
            }
            if (error.code === 'ENOENT') {
                reject(new CommandNotFoundError(command))
                return
            }
            if (error.killed === true && error.code === null) {
                reject(new CommandTimeoutError(command, timeout))
                return
            }
            if (typeof error.code === 'number') {
                reject(new CommandFailedError(command, error.code, stderr))
                return
            }

            reject(error)
        })
    })
}
