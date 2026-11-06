import { logger } from "../utils/logger.js";
import { AppError } from "../utils/AppError.js";

// Central error handler - the only place that turns a thrown error into an
// HTTP response. Guarantees no stack trace or internal detail ever reaches
// the frontend, and that AppError's intended status code is respected.
export const errorHandler = (error, req, res, next) => { // eslint-disable-line no-unused-vars

    const isKnown = error instanceof AppError;
    const statusCode = isKnown ? error.statusCode : 500;

    logger.error(`${req.method} ${req.originalUrl} ->`, error.message);

    res.status(statusCode).json({
        success: false,
        message: isKnown ? error.message : "Something went wrong. Please try again.",
        details: isKnown ? error.details : undefined
    });

};

export const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`
    });
};
