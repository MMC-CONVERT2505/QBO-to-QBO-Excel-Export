import OAuthClient from "intuit-oauth";
import { logger } from "../utils/logger.js";
import { AppError } from "../utils/AppError.js";

// intuit-oauth is stateless per token set (it just signs/refreshes whatever
// token you hand it), so ONE client instance is fine - the actual token
// data always lives in req.session.qbo, never on this object.
const oauthClient = new OAuthClient({
    clientId: process.env.QBO_CLIENT_ID,
    clientSecret: process.env.QBO_CLIENT_SECRET,
    redirectUri: process.env.QBO_REDIRECT_URI,
    environment: process.env.QBO_ENVIRONMENT
});

// Non-secret startup report + sanity checks, so a wrong environment or
// redirect URI is visible in the log instead of only at Intuit's error page.
export const describeOAuthConfig = () => {
    const id = process.env.QBO_CLIENT_ID || "";
    const redirectUri = process.env.QBO_REDIRECT_URI || "";
    const environment = process.env.QBO_ENVIRONMENT || "";
    const problems = [];
    if (!id) problems.push("QBO_CLIENT_ID is empty");
    if (!process.env.QBO_CLIENT_SECRET) problems.push("QBO_CLIENT_SECRET is empty");
    if (!["sandbox", "production"].includes(environment)) problems.push("QBO_ENVIRONMENT must be 'sandbox' or 'production'");
    if (process.env.APP_ENV && process.env.APP_ENV !== environment) {
        problems.push(`APP_ENV=${process.env.APP_ENV} but QBO_ENVIRONMENT=${environment}`);
    }
    if (environment === "production" && !/^https:\/\//i.test(redirectUri)) {
        problems.push("production redirect URI must start with https://");
    }
    if (environment === "production" && /localhost|127\.0\.0\.1/i.test(redirectUri)) {
        problems.push("production redirect URI must not be localhost");
    }
    if (redirectUri.endsWith("/")) problems.push("redirect URI has a trailing slash");
    if (!redirectUri.endsWith("/api/auth/callback")) problems.push("redirect URI should end with /api/auth/callback");
    return {
        appEnv: process.env.APP_ENV || "(unset)",
        environment,
        clientIdMasked: id ? `${id.slice(0, 6)}...${id.slice(-4)}` : "(empty)",
        redirectUri,
        problems
    };
};

{
    const info = describeOAuthConfig();
    logger.info(`OAuth config -> APP_ENV=${info.appEnv} QBO_ENVIRONMENT=${info.environment} clientId=${info.clientIdMasked} redirect_uri=${info.redirectUri}`);
    info.problems.forEach((p) => logger.warn(`OAuth config problem: ${p}`));
}

export const getAuthorizationUrl = (state) => {
    return oauthClient.authorizeUri({
        scope: [OAuthClient.scopes.Accounting],
        state
    });
};

export const getOAuthClient = () => oauthClient;

export const getBaseUrl = () => {
    return process.env.QBO_ENVIRONMENT === "production"
        ? OAuthClient.environment.production
        : OAuthClient.environment.sandbox;
};

// Exchanges the callback URL (with ?code=...&state=...&realmId=...) for a
// fresh token set. Returns only what we need to persist in the session.
export const exchangeCodeForToken = async (callbackUrl) => {

    const authResponse = await oauthClient.createToken(callbackUrl);
    const token = authResponse.getJson();

    return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresIn: token.expires_in,
        xRefreshTokenExpiresIn: token.x_refresh_token_expires_in,
        obtainedAt: Date.now()
    };
};

// QBO access tokens last ~1 hour, refresh tokens ~100 days. This refreshes
// using intuit-oauth's own refreshUsingToken so we don't hand-roll the
// token endpoint call, then returns a new token set to persist.
export const refreshAccessToken = async (refreshToken) => {

    try {

        const authResponse = await oauthClient.refreshUsingToken(refreshToken);
        const token = authResponse.getJson();

        return {
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresIn: token.expires_in,
            xRefreshTokenExpiresIn: token.x_refresh_token_expires_in,
            obtainedAt: Date.now()
        };

    } catch (error) {

        logger.error("QBO token refresh failed:", error.message);

        throw new AppError(
            "Your QuickBooks connection has expired. Please reconnect.",
            401
        );

    }

};

// True once the access token is within 2 minutes of expiring (or already
// expired) - gives requireQboAuth middleware a safety margin to refresh
// before a QBO API call actually fails.
export const isAccessTokenExpiring = (qboSession) => {

    if (!qboSession?.obtainedAt || !qboSession?.expiresIn) return true;

    const expiresAt = qboSession.obtainedAt + (qboSession.expiresIn * 1000);
    const safetyMarginMs = 2 * 60 * 1000;

    return Date.now() >= (expiresAt - safetyMarginMs);
};

// Best-effort revoke at Intuit's side on logout. Session is cleared by the
// caller regardless of whether this succeeds.
export const revokeToken = async (token) => {

    try {
        await oauthClient.revoke({ token });
    } catch (error) {
        logger.warn("QBO token revoke failed (continuing with local logout):", error.message);
    }

};
