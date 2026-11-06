import {
    isAccessTokenExpiring,
    refreshAccessToken
} from "../services/qboAuth.service.js";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

// Guards any route that needs to call the QBO API. Ensures a connection
// exists, transparently refreshes the access token if it's about to
// expire, and exposes the live token set as req.qboSession so downstream
// controllers/services never touch req.session directly.
export const requireQboAuth = async (req, res, next) => {

    try {

        const qbo = req.session.qbo;

        if (!qbo || !qbo.accessToken || !qbo.realmId) {
            throw new AppError("No QuickBooks connection found. Please connect first.", 401);
        }

        if (isAccessTokenExpiring(qbo)) {

            logger.info("QBO access token expiring - refreshing");

            const refreshed = await refreshAccessToken(qbo.refreshToken);

            req.session.qbo = {
                ...qbo,
                ...refreshed
            };

        }

        req.qboSession = req.session.qbo;

        next();

    } catch (error) {

        next(error);

    }

};
