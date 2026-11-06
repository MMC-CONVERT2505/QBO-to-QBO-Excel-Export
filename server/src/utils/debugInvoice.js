// Complete Invoice JSON debug logging. DISABLED BY DEFAULT.
//
//   DEBUG_INVOICE_JSON=true            enable (raw + normalized + mapped)
//   DEBUG_INVOICE_IDS=1023,INV-77      optional: only these QBO Ids / DocNumbers
//
// !! The output contains CUSTOMER and FINANCIAL data. Use it only on your own
// !! machine for debugging, never in shared/production logs, and delete the
// !! terminal output afterwards.
//
// Nothing is truncated (no depth limit, no row limit). Any key that looks like
// a credential (token, secret, authorization, cookie, password, api key) is
// replaced with "***REDACTED***" before printing.

const SENSITIVE_KEY = /token|secret|authorization|cookie|password|api[-_]?key|bearer/i;

const sanitize = (value) => {
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? "***REDACTED***" : sanitize(v)])
        );
    }
    return value;
};

export const isInvoiceDebugEnabled = () => /^(true|1|on|yes)$/i.test(String(process.env.DEBUG_INVOICE_JSON || "").trim());

const idFilter = () =>
    String(process.env.DEBUG_INVOICE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

export const invoiceDebugMatches = (invoiceId, docNumber) => {
    const wanted = idFilter();
    if (!wanted.length) return true;
    return wanted.includes(String(invoiceId)) || wanted.includes(String(docNumber));
};

let bannerShown = false;

export const debugInvoiceJson = (stage, { invoiceId, docNumber, payload }) => {

    if (!isInvoiceDebugEnabled()) return;
    if (!invoiceDebugMatches(invoiceId, docNumber)) return;

    if (!bannerShown) {
        bannerShown = true;
        console.log(
            "\n############################################################\n" +
            "# DEBUG_INVOICE_JSON is ON - output contains SENSITIVE customer\n" +
            "# and financial data. Do not share or store these logs.\n" +
            "############################################################"
        );
    }

    console.log(
        `\n===== [DEBUG_INVOICE_JSON] SENSITIVE stage=${stage} invoiceId=${invoiceId} docNumber=${docNumber ?? ""} =====\n` +
        JSON.stringify(sanitize(payload), null, 2) +
        `\n===== [/DEBUG_INVOICE_JSON] ${stage} invoiceId=${invoiceId} =====`
    );
};

export const debugInvoiceNote = (title, payload) => {
    if (!isInvoiceDebugEnabled()) return;
    console.log(`\n===== [DEBUG_INVOICE_JSON] SENSITIVE ${title} =====\n${JSON.stringify(sanitize(payload), null, 2)}\n===== [/DEBUG_INVOICE_JSON] ${title} =====`);
};
