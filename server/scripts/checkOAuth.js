// Prints what the backend will REALLY send to Intuit. No secrets are shown.
// Usage (from server/):  npm run oauth:check
process.env.APP_ENV = process.env.APP_ENV || "production";
await import("../src/config/loadEnv.js");
const { getAuthorizationUrl, describeOAuthConfig } = await import("../src/services/qboAuth.service.js");

const info = describeOAuthConfig();
const sent = new URL(getAuthorizationUrl("check")).searchParams.get("redirect_uri");

console.log("\n=== OAuth configuration actually loaded ===");
console.log("APP_ENV            :", info.appEnv);
console.log("QBO_ENVIRONMENT    :", info.environment, info.environment === "production" ? "(use PRODUCTION keys + Production Redirect URIs)" : "(use DEVELOPMENT keys + Development Redirect URIs)");
console.log("Client ID (masked) :", info.clientIdMasked);
console.log("FRONTEND_URL       :", process.env.FRONTEND_URL);
console.log("redirect_uri SENT  :", sent);
console.log("\nRegister EXACTLY this in Intuit:", sent);

try {
    const res = await fetch(process.env.NGROK_API_URL || "http://127.0.0.1:4040/api/tunnels", { signal: AbortSignal.timeout(3000) });
    const tunnels = (await res.json()).tunnels || [];
    const https = tunnels.find((t) => t.public_url?.startsWith("https://"));
    if (!https) console.log("\n[ngrok] agent reachable but no https tunnel is running");
    else {
        const expected = `${https.public_url}/api/auth/callback`;
        console.log("\n[ngrok] active tunnel :", https.public_url, "->", https.config?.addr);
        console.log(expected === sent ? "[ngrok] MATCH: redirect_uri equals the active tunnel" : `[ngrok] MISMATCH: active tunnel gives ${expected}`);
    }
} catch {
    console.log("\n[ngrok] no local ngrok agent found on port 4040 -> the tunnel is NOT running");
}

if (info.problems.length) { console.log("\nPROBLEMS:"); info.problems.forEach((p) => console.log(" -", p)); process.exitCode = 1; }
else console.log("\nNo configuration problems detected.");
