// Standard application error carrying an HTTP status code so the central
// error handler can format a clean, safe JSON response.
export class AppError extends Error {
    constructor(message, statusCode = 500, details = null) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
    }
}
