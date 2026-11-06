// Wraps an async controller so rejected promises reach Express's error handler
// instead of crashing the process or hanging the request.
export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
