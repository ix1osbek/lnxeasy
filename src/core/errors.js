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

export class BadRequestError extends AppError {
    constructor(message) {
        super(400, 'BAD_REQUEST', message)
        this.name = 'BadRequestError'
    }
}


export class UnauthorizedError extends AppError {
    constructor(message) {
        super(401, 'UNAUTHORIZED', message)
        this.name = 'UnauthorizedError'
    }
}


export class InvalidCredentialsError extends AppError {
    constructor() {
        super(401, 'INVALID_CREDENTIALS', 'Wrong username or password')
        this.name = 'InvalidCredentialsError'
    }
}


export class ForbiddenError extends AppError {
    constructor(message) {
        super(403, 'FORBIDDEN', message)
        this.name = 'ForbiddenError'
    }
}


export class PayloadTooLargeError extends AppError {
    constructor() {
        super(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large')
        this.name = 'PayloadTooLargeError'
    }
}


export class TooManyAttemptsError extends AppError {
    constructor(retryAfterSeconds) {
        super(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Try again in ' + retryAfterSeconds + ' seconds.')
        this.name = 'TooManyAttemptsError'
        this.retryAfterSeconds = retryAfterSeconds
    }
}
