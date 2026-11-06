import "./src/config/loadEnv.js";

import express from "express";
import session from "express-session";
import cors from "cors";

import authRoutes from "./src/routes/auth.routes.js";
import qboRoutes from "./src/routes/qbo.routes.js";
import mappingRoutes from "./src/routes/mapping.routes.js";
import taxMappingRoutes from "./src/routes/taxMapping.routes.js";
import exportRoutes from "./src/routes/export.routes.js";
import regionsRoutes from "./src/routes/regions.routes.js";

import { errorHandler, notFoundHandler } from "./src/middleware/errorHandler.js";
import { logger } from "./src/utils/logger.js";

const requiredEnvVars = [
    "QBO_CLIENT_ID",
    "QBO_CLIENT_SECRET",
    "QBO_REDIRECT_URI",
    "QBO_ENVIRONMENT",
    "SESSION_SECRET"
];

const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
    logger.error("Missing required environment variables:", missingEnvVars.join(", "));
    process.exit(1);
}

const app = express();

app.set("trust proxy", 1);

app.use(express.json());

app.use(
    cors({
        origin: process.env.FRONTEND_URL || "http://localhost:5173",
        credentials: true
    })
);

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 24 * 60 * 60 * 1000 // 24h - well under QBO's ~100 day refresh token life
        }
    })
);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/qbo", qboRoutes);
app.use("/api/mapping", mappingRoutes);
app.use("/api/tax-mapping", taxMappingRoutes);
app.use("/api/export", exportRoutes);
app.use("/api", regionsRoutes);

// Root
app.get("/", (req, res) => {
    res.json({ message: "QBO Accounting Data Export & Regional Template Mapping API 1.0" });
});

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
});
