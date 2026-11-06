// Loads environment variables BEFORE anything else reads process.env
// (qboAuth.service.js builds its OAuth client at import time, so this must
// be the very first import in server.js).
//
// Sandbox and Live (production) QuickBooks use DIFFERENT Client ID/Secret
// pairs in the Intuit Developer Portal, so they get separate env files:
//
//   APP_ENV unset        -> .env                (unchanged, existing behaviour)
//   APP_ENV=sandbox      -> .env.sandbox        (falls back to .env)
//   APP_ENV=production   -> .env.production     (falls back to .env)
//
// Run with e.g.:  APP_ENV=production npm start
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const appEnv = (process.env.APP_ENV || "").trim().toLowerCase();

// When APP_ENV is set explicitly we REQUIRE that environment's own file.
// Silently falling back to .env (the sandbox keys) would send the wrong
// client id / redirect URI to Intuit and cause "redirect_uri is invalid".
if (appEnv) {
    const required = path.join(serverRoot, `.env.${appEnv}`);
    if (!fs.existsSync(required)) {
        console.error(`[ERROR] APP_ENV=${appEnv} but ${path.basename(required)} was not found in ${serverRoot}.`);
        console.error("[ERROR] Create it (copy the .env." + appEnv + ".example). On Windows check it is not named .env." + appEnv + ".txt");
        process.exit(1);
    }
}

const candidates = appEnv ? [`.env.${appEnv}`] : [".env"];
const envFile = candidates.map((name) => path.join(serverRoot, name)).find((file) => fs.existsSync(file));

if (envFile) {
    dotenv.config({ path: envFile });
    console.log(`[INFO] Loaded environment from ${path.basename(envFile)}`);
} else {
    console.warn("[WARN] No .env file found - relying on already-set environment variables");
}
