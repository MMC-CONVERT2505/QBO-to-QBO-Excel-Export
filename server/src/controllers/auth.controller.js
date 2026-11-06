import crypto from "crypto";
import {
    getAuthorizationUrl,
    exchangeCodeForToken,
    revokeToken
} from "../services/qboAuth.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

// ========================================
// Start QBO OAuth
// ========================================
const STATE_COOKIE = "qbo_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;

// Minimal cookie reader (avoids adding cookie-parser just for one value)
const readCookie = (req, name) => {
    const header = req.headers.cookie || "";
    for (const part of header.split(";")) {
        const idx = part.indexOf("=");
        if (idx > -1 && part.slice(0, idx).trim() === name) {
            return decodeURIComponent(part.slice(idx + 1).trim());
        }
    }
    return null;
};

export const login = (req, res) => {

    const state = crypto.randomBytes(32).toString("hex");
    req.session.oauthState = state;

    // The state is ALSO kept in a short-lived httpOnly cookie. It still binds
    // the flow to this browser (CSRF protection), but - unlike the in-memory
    // session - it survives a backend restart or a session mix-up between the
    // moment the user clicks Connect and the moment Intuit sends them back.
    res.cookie(STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: STATE_TTL_MS,
        path: "/"
    });

    logger.info(`OAuth login: pid=${process.pid} sid=${req.sessionID.slice(0, 8)} host=${req.headers.host}`);

    const authorizationUrl = getAuthorizationUrl(state);

    logger.info("Redirecting to QBO for authorization");

    res.redirect(authorizationUrl);

};

// ========================================
// QBO OAuth Callback
// ========================================
export const callback = asyncHandler(async (req, res) => {

    const { state, realmId, code } = req.query;

    const cookieState = readCookie(req, STATE_COOKIE);
    const stateOk = Boolean(state) && (state === req.session.oauthState || state === cookieState);

    if (!stateOk) {
        logger.warn(
            `OAuth state check failed: pid=${process.pid} sid=${req.sessionID.slice(0, 8)} host=${req.headers.host} ` +
            `sessionHasState=${Boolean(req.session.oauthState)} stateCookiePresent=${Boolean(cookieState)} ` +
            `cookiePresent=${Boolean(req.headers.cookie)} stateInUrl=${Boolean(state)}`
        );
        throw new AppError("Invalid OAuth state. Please try connecting again.", 400);
    }

    res.clearCookie(STATE_COOKIE, { path: "/" });

    if (!code) {
        throw new AppError("Authorization code was not received from QuickBooks.", 400);
    }

    if (!realmId) {
        throw new AppError("QuickBooks did not return a company (realm) ID.", 400);
    }

    const tokenSet = await exchangeCodeForToken(req.url);

    req.session.qbo = {
        ...tokenSet,
        realmId
    };

    delete req.session.oauthState;

    logger.info("QBO connected successfully. Realm:", realmId);

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    res.redirect(`${frontendUrl}/dashboard?connected=1`);

});

// ========================================
// Connection Status
// ========================================
export const status = (req, res) => {

    const qbo = req.session.qbo;

    if (!qbo || !qbo.accessToken || !qbo.realmId) {
        return res.status(200).json({ connected: false });
    }

    res.status(200).json({
        connected: true,
        realmId: qbo.realmId,
        environment: process.env.QBO_ENVIRONMENT
    });

};

// ========================================
// Logout / Disconnect
// ========================================
export const logout = asyncHandler(async (req, res) => {

    const qbo = req.session.qbo;

    if (qbo?.refreshToken) {
        await revokeToken(qbo.refreshToken);
    }

    req.session.destroy((error) => {

        if (error) {
            logger.warn("Session destroy error on logout:", error.message);
        }

        res.clearCookie("connect.sid");
        res.status(200).json({ success: true, message: "Disconnected from QuickBooks." });

    });

});
