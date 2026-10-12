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