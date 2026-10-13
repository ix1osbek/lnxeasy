export class AppError extends Error {
    constructor(statusCode, code, message) {
        super(message)
        this.name = 'AppError'
        this.statusCode = statusCode
        this.code = code
    }
}

export class NotFoundError extends AppError {
    constructor(message) {
        super(404, 'NOT_FOUND', message)
        this.name = 'NotFoundError'
    }
}

export class CommandNotFoundError extends AppError {
    constructor(command) {
        super(500, 'COMMAND_NOT_FOUND', 'Command not found: ' + command)
        this.name = 'CommandNotFoundError'
        this.command = command
    }
}


export class CommandFailedError extends AppError {
    constructor(command, exitCode, stderr) {
        super(500, 'COMMAND_FAILED', 'Command "' + command + '" exited with code ' + exitCode)
        this.name = "CommandFailedError"
        this.command = command
        this.exitCode = exitCode
        this.stderr = stderr
    }
}


export class CommandTimeoutError extends AppError {
    constructor(command, timeoutMs) {
        super(504, 'COMMAND_TIMEOUT', 'Command "' + command + '" did not finish in ' + timeoutMs + ' ms')
        this.name = 'CommandTimeoutError'
        this.command = command
        this.timeoutMs = timeoutMs
    }
}