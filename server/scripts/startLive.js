// Cross-platform launcher (Windows/macOS/Linux) for live QuickBooks testing.
// Sets APP_ENV=production so loadEnv.js reads .env.production, then starts the server.
process.env.APP_ENV = "production";
await import("../server.js");
