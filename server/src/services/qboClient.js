import { debugJson } from "../utils/debugJson.js";
import { getBaseUrl } from "./qboAuth.service.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../utils/AppError.js";
import { rowTypeHistogram } from "./reportRows.js";

const MAX_RETRIES = 4;
const QBO_QUERY_PAGE_SIZE = 1000; // QBO's own hard cap per query response

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Low-level authenticated GET against the QBO Accounting API, with retry
// on rate limiting (429) and transient 5xx errors using exponential
// backoff. `qboSession` must already carry a valid (non-expired) access
// token - refreshing is the caller's (middleware's) job, not this client's.
const request = async (qboSession, path, { query, params } = {}) => {

    const baseUrl = getBaseUrl();
    const url = new URL(`${baseUrl}/v3/company/${qboSession.realmId}/${path}`);

    if (query) {
        url.searchParams.set("query", query);
    }

    if (params) {
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && value !== "") {
                url.searchParams.set(key, value);
            }
        }
    }

    url.searchParams.set("minorversion", "65");

    let attempt = 0;

    while (true) {

        const response = await fetch(url, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${qboSession.accessToken}`,
                Accept: "application/json"
            }
        });

        if (response.status === 429 || response.status >= 500) {

            attempt += 1;

            if (attempt > MAX_RETRIES) {
                throw new AppError(
                    `QBO API is currently unavailable (status ${response.status}). Please try again shortly.`,
                    502
                );
            }

            const backoffMs = Math.min(1000 * (2 ** attempt), 8000);

            logger.warn(`QBO API ${response.status} - retrying in ${backoffMs}ms (attempt ${attempt}/${MAX_RETRIES})`);

            await sleep(backoffMs);
            continue;

        }

        if (response.status === 401) {
            throw new AppError("QuickBooks session is no longer valid. Please reconnect.", 401);
        }

        if (!response.ok) {

            let details = null;

            try {
                details = await response.json();
            } catch {
                // response wasn't JSON - ignore, keep details null
            }

            logger.error("QBO API error:", response.status, details?.Fault ?? details);

            throw new AppError(
                "QuickBooks rejected the request.",
                response.status >= 400 && response.status < 500 ? 400 : 502,
                details?.Fault ?? null
            );

        }

        const body = await response.json();

        debugApiResponse(url, response.status, body);

        return body;

    }

};

// Prints the COMPLETE, untouched HTTP response body of every QBO API call
// (the exact JSON QBO sent, including the QueryResponse wrapper, paging
// fields and `time`). Off by default; the output contains real financial
// data. Only the URL (never the Authorization header) is printed.
//
//   DEBUG_QBO_API=true
//   DEBUG_QBO_API_FILTER=from Invoice      -> optional, comma list, substring match on the decoded URL
const debugApiResponse = (url, status, body) => {

    const flag = String(process.env.DEBUG_QBO_API || "").toLowerCase().trim();
    if (!["true", "1", "all", "on"].includes(flag)) return;

    const target = decodeURIComponent(`${url.pathname}${url.search}`.replace(/\+/g, " "));

    const filters = String(process.env.DEBUG_QBO_API_FILTER || "")
        .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

    if (filters.length && !filters.some((f) => target.toLowerCase().includes(f))) return;

    console.log(
        `\n===== [QBO_API_RESPONSE] HTTP ${status} GET ${target} =====\n` +
        JSON.stringify(body, null, 2) +
        `\n===== [/QBO_API_RESPONSE] =====\n`
    );

};

// Runs a QBO Reports API report (e.g. "AgedPayableDetail",
// "AgedReceivableDetail") and returns the raw report JSON - a nested
// { Header, Columns, Rows } structure, not a flat list of entities like
// queryAll(). `params` are the report's own query-string options (e.g.
// report_date, columns) - see QBO's Reports API docs per report name.
export const fetchReport = async (qboSession, reportName, params = {}) => {

    const report = await request(qboSession, `reports/${reportName}`, { params });

    // Safe diagnostics: request shape + report header + structure counts only.
    // No tokens, and no account names or amounts are ever logged.
    const header = report?.Header || {};
    const options = Object.fromEntries((header.Option || []).map((o) => [o.Name, o.Value]));
    const countRows = (rows) => (rows?.Row || []).reduce((n, r) => n + 1 + countRows(r.Rows), 0);

    logger.info(
        `QBO report ${reportName}: HTTP 200 params=${JSON.stringify(params)} ` +
        `period=${header.StartPeriod || "?"}..${header.EndPeriod || "?"} basis=${header.ReportBasis || "?"} ` +
        `currency=${header.Currency || "?"} NoReportData=${options.NoReportData ?? "n/a"} ` +
        `columns=${(report?.Columns?.Column || []).length} rowNodes=${countRows(report?.Rows)} rowTypes=${JSON.stringify(rowTypeHistogram(report?.Rows))}`
    );

    return report;

};

// Company preferences (read-only). Used to find the fiscal-year start month.
export const fetchPreferences = async (qboSession) => {

    const data = await request(qboSession, "preferences");
    return data.Preferences || {};

};

// Fetches CompanyInfo for the connected realm - used to detect the source
// company's country/region and display name.
export const fetchCompanyInfo = async (qboSession) => {

    const data = await request(
        qboSession,
        `companyinfo/${qboSession.realmId}`
    );

    return data.CompanyInfo;

};

// Runs a QBO SQL-like query across ALL pages and returns every record.
// QBO caps each response at 1000 rows via STARTPOSITION/MAXRESULTS, so
// large companies (the whole point of this tool) require looping.
export const queryAll = async (qboSession, baseQuery) => {

    const results = [];
    let startPosition = 1;

    while (true) {

        const pagedQuery = `${baseQuery} STARTPOSITION ${startPosition} MAXRESULTS ${QBO_QUERY_PAGE_SIZE}`;

        const data = await request(qboSession, "query", { query: pagedQuery });

        const queryResponse = data.QueryResponse || {};

        // QBO returns the matched entity under a key named after the
        // entity itself (e.g. QueryResponse.Account, QueryResponse.Invoice).
        const entityKey = Object.keys(queryResponse).find(
            (key) => Array.isArray(queryResponse[key])
        );

        const page = entityKey ? queryResponse[entityKey] : [];

        results.push(...page);

        if (page.length < QBO_QUERY_PAGE_SIZE) {
            break;
        }

        startPosition += QBO_QUERY_PAGE_SIZE;

    }

    debugJson("raw", baseQuery, results);

    return results;

};
