// Minimal logger that guarantees OAuth secrets/tokens never hit stdout,
// even if a caller accidentally passes a session/token object to it.
const REDACT_KEYS = [
    "accessToken",
    "refreshToken",
    "access_token",
    "refresh_token",
    "clientSecret",
    "client_secret",
    "SESSION_SECRET"
];

function redact(value) {
    if (!value || typeof value !== "object") return value;

    const clone = Array.isArray(value) ? [...value] : { ...value };

    for (const key of Object.keys(clone)) {
        if (REDACT_KEYS.includes(key)) {
            clone[key] = "***REDACTED***";
        } else if (typeof clone[key] === "object") {
            clone[key] = redact(clone[key]);
        }
    }

    return clone;
}

export const logger = {
    info: (...args) => console.log("[INFO]", ...args.map(redact)),
    warn: (...args) => console.warn("[WARN]", ...args.map(redact)),
    error: (...args) => console.error("[ERROR]", ...args.map(redact))
};
