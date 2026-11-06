import { queryAll, fetchCompanyInfo, fetchReport, fetchPreferences } from "./qboClient.js";
import { collectLeafRows } from "./reportRows.js";
import { buildTxnDateQuery } from "../utils/dateRange.js";
import { normalizeCollection, normalizeCustomer, resolveItemRelations, resolveItemAccounts, unresolvedItemAccountIds, normalizeARAgingRow, normalizeAPAgingRow, normalizeOpenBalanceRows, normalizeBillDetailRecords, normalizeInvoiceDetailRecords, normalizeCreditMemoDetailRecords, normalizeInvoicePaymentRecords, normalizeJournalRecords, normalizeOverpaymentRecords, normalizeBillOverpaymentRecords, normalizeEstimateRecords, normalizePurchaseOrderRecords, parseJournalReportLines, normalizeOtherJournalRecords, normalizeInvoiceCreditAllocationRecords, normalizeBillCreditAllocationRecords, normalizeBillPaymentRecords, normalizeBillCreditRecords, normalizeExpenseRecords, normalizeTransferRecords, normalizeDepositRecords } from "./normalize.service.js";
import { ENTITIES, resolveFetchOrder, OTHER_JOURNAL_TRANSACTION_TYPES } from "../config/entities.js";
import { buildInvoiceNumberMap, buildDocumentNumberMap } from "./flatten.service.js";
import { debugInvoiceJson, debugInvoiceNote, isInvoiceDebugEnabled } from "../utils/debugInvoice.js";
import { debugJson } from "../utils/debugJson.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../utils/AppError.js";

export { fetchCompanyInfo };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// AR and AP are built from QBO's own "Aged Receivable/Payable Detail"
// reports - the exact same report visible in the QBO UI (Reports ->
// A/R or A/P Aging Detail) - rather than reconstructed by us from
// individual Invoice/Bill/Payment/Credit entities. QBO does its own
// "is this still open" calculation for these reports, so there's no
// more guessing at partial applications, unapplied payments, or
// used-up credits - the report already reflects all of that.
//
// The Reports API returns a nested { Header, Columns, Rows } structure,
// not a flat list of entities like queryAll() - aging reports group
// their rows into "Section"s by days-past-due bucket, with the actual
// transaction rows nested inside each section.

// Recursively walks a report's Rows tree and collects only the leaf
// "Data" rows (the actual transactions). Section headers and any
// Total/Summary rows are skipped.
const collectDataRows = (rows) => {

    if (!rows || !Array.isArray(rows.Row)) return [];

    let collected = [];

    for (const row of rows.Row) {

        if (row.type === "Data") {
            collected.push(row);
        }

        if (row.Rows) {
            collected = collected.concat(collectDataRows(row.Rows));
        }

    }

    return collected;

};

// A row's column values are positional (ColData[i] lines up with
// Columns.Column[i]), not named - this maps a row's ColData to a plain
// object keyed by the report's own (lowercased) column titles, e.g.
// { "date": "...", "due date": "...", "open balance": "..." }.
const mapRowByColumnTitle = (row, columnTitles) => {

    const fields = {};

    (row.ColData || []).forEach((cell, index) => {
        const title = (columnTitles[index] || "").trim().toLowerCase();
        if (title) fields[title] = cell.value ?? "";
    });

    return fields;

};

const findColumn = (fields, ...candidateTitles) => {
    for (const title of candidateTitles) {
        if (Object.prototype.hasOwnProperty.call(fields, title)) return fields[title];
    }
    return "";
};

const toNumber = (value) => {
    const n = parseFloat(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
};

// Fetches an Aged Receivable/Payable Detail report and flattens it into
// plain per-transaction row objects.
const fetchAgingRows = async (qboSession, reportName, asOfDate) => {

    const params = {};

    if (asOfDate && ISO_DATE.test(asOfDate)) {
        params.report_date = asOfDate;
    }

    logger.info(`Fetching ${reportName} report from source QBO${params.report_date ? ` (as of ${params.report_date})` : ""}...`);

    const report = await fetchReport(qboSession, reportName, params);

    const columnTitles = (report.Columns?.Column || []).map((col) => col.ColTitle || "");
    const dataRows = collectDataRows(report.Rows);

    logger.info(`Fetched ${dataRows.length} row(s) from ${reportName}`);

    return dataRows.map((row) => {

        const fields = mapRowByColumnTitle(row, columnTitles);

        return {
            txnType: findColumn(fields, "transaction type", "type"),
            docNumber: findColumn(fields, "no.", "num", "no", "doc num"),
            partyName: findColumn(fields, "supplier display name", "customer display name", "vendor", "customer", "supplier", "name"),
            locationName: findColumn(fields, "location full name", "location"),
            txnDate: findColumn(fields, "date"),
            dueDate: findColumn(fields, "due date"),
            termName: findColumn(fields, "terms", "term"),
            memo: findColumn(fields, "memo"),
            amount: toNumber(findColumn(fields, "amount")),
            openBalance: toNumber(findColumn(fields, "open balance", "open ba", "open bal"))
        };

    });

};

const fetchAR = async (qboSession, asOfDate) => {
    const rows = await fetchAgingRows(qboSession, "AgedReceivableDetail", asOfDate);
    return rows.map(normalizeARAgingRow);
};

const fetchAP = async (qboSession, asOfDate) => {
    const rows = await fetchAgingRows(qboSession, "AgedPayableDetail", asOfDate);
    return rows.map(normalizeAPAgingRow);
};

// Open Balance = the opening trial-balance journal, built from QBO's own
// "Trial Balance" report as of the conversion cutoff date - this is QBO's
// own authoritative per-account balance calculation, not something
// reconstructed from CurrentBalance (which reflects today, not a
// historical as-of date).
//
// A Trial Balance report row's first column (the account name) carries
// the account's QBO id as `ColData[0].id`, which is used below to look
// the account back up in the already-fetched Account dataset so its
// AccountType is known (needed to detect Accounts Receivable/Payable
// control accounts - see normalize.service.js). If a row has no id for
// some reason, falls back to matching by name.
export const parseTrialBalanceRow = (row, columnTitles) => {

    const cells = row.ColData || [];
    const nameCell = cells[0] || {};

    const fields = {};
    cells.forEach((cell, index) => {
        const title = (columnTitles[index] || "").trim().toLowerCase();
        if (title) fields[title] = cell.value ?? "";
    });

    return {
        accountId: nameCell.id || "",
        accountName: nameCell.value || "",
        debit: toNumber(findColumn(fields, "debit")),
        credit: toNumber(findColumn(fields, "credit"))
    };

};

const MONTH_NAMES = ["january","february","march","april","may","june","july","august","september","october","november","december"];

// First day of the fiscal year that contains `asOfDate` (YYYY-MM-DD), based
// on the company's own FirstMonthOfFiscalYear preference. Falls back to
// 1 January if the preference can't be read.
export const resolveFiscalYearStart = async (qboSession, asOfDate) => {

    let monthIndex = 0;

    try {
        const prefs = await fetchPreferences(qboSession);
        const name = String(prefs?.AccountingInfoPrefs?.FirstMonthOfFiscalYear || "").trim().toLowerCase();
        const idx = MONTH_NAMES.indexOf(name);
        if (idx >= 0) monthIndex = idx;
    } catch (error) {
        logger.warn(`Could not read fiscal-year preference (assuming January): ${error.message}`);
    }

    const [year, month] = asOfDate.split("-").map(Number);
    const startYear = month - 1 >= monthIndex ? year : year - 1;

    return `${startYear}-${String(monthIndex + 1).padStart(2, "0")}-01`;

};

const fetchOpenBalance = async (qboSession, asOfDate, accountRecords) => {

    if (!asOfDate || !ISO_DATE.test(asOfDate)) {
        throw new AppError(
            "A conversion cutoff date is required to fetch opening balances for the Open Balance module.",
            400
        );
    }

    // QBO's TrialBalance report does NOT take a single "report_date" (that
    // parameter belongs to the aging/balance-sheet style reports - on a
    // TrialBalance QBO silently ignores it and falls back to its default
    // period). It takes a start_date/end_date range (or a date_macro):
    // Balance Sheet accounts are cumulative up to end_date, P&L accounts are
    // the activity between start_date and end_date, and earlier-year profit
    // is rolled into Retained Earnings by QBO itself. So the cutoff is
    // sent as end_date, with start_date = first day of the fiscal year that
    // contains the cutoff.
    const startDate = await resolveFiscalYearStart(qboSession, asOfDate);
    const params = { start_date: startDate, end_date: asOfDate, accounting_method: "Accrual" };

    logger.info(`Fetching TrialBalance report from source QBO (${startDate} to ${asOfDate}, Accrual)...`);

    const report = await fetchReport(qboSession, "TrialBalance", params);
    const columnTitles = (report.Columns?.Column || []).map((col) => col.ColTitle || "");

    const leafRows = collectLeafRows(report.Rows);
    const parsedRows = leafRows.map((row) => parseTrialBalanceRow(row, columnTitles));
    const dataRows = parsedRows.filter((row) => row.accountName && row.accountName.trim().toLowerCase() !== "total");

    logger.info(
        `TrialBalance stages: columns=[${columnTitles.map((t) => t || "(blank)").join("|")}] ` +
        `leafRows=${leafRows.length} withAccountName=${dataRows.length} ` +
        `withNonZeroAmount=${dataRows.filter((r) => r.debit !== 0 || r.credit !== 0).length}`
    );

    if (leafRows.length === 0) {
        logger.warn(
            "TrialBalance returned no account rows. Check: connected company/environment, the date range " +
            `(${startDate}..${asOfDate}), and the NoReportData flag in the line above.`
        );
    }

    const accountsById = new Map();
    const accountsByName = new Map();

    for (const account of accountRecords || []) {
        if (account.id) accountsById.set(String(account.id), account);
        const nameKey = (account.fullyQualifiedName || account.name || "").trim().toLowerCase();
        if (nameKey) accountsByName.set(nameKey, account);
    }

    const resolved = dataRows.map((row) => {
        const account = (row.accountId && accountsById.get(String(row.accountId)))
            || accountsByName.get(row.accountName.trim().toLowerCase())
            || null;
        return {
            accountName: row.accountName,
            accountType: account?.accountType || "",
            debit: row.debit,
            credit: row.credit
        };
    });

    const unmatched = resolved.filter((r) => !r.accountType).length;
    const normalized = normalizeOpenBalanceRows(resolved, asOfDate);

    logger.info(
        `Open Balance stages: resolvedRows=${resolved.length} accountTypeNotFound=${unmatched} ` +
        `afterZeroFilter=${normalized.length} collapsedToRetainedEarnings=${normalized.filter((r) => r.collapsedFromControlAccount).length}`
    );

    return normalized;

};

// Bill (Detailed Transactions) - every Bill, fetched via the Query API
// (not the Reports API, which doesn't expose line-level detail), flattened
// into one row per line. Needs the already-fetched Account + Item
// datasets so each line's Account/Product-Service resolves to its full
// Parent:Child name (see normalizeBillDetailRecords).
// Customer / Job full names (Customer:Job) for line CustomerRefs that carry only an id. One Customer query (plus
// one for inactive customers when some id is still missing); nothing is queried when every ref has its name.
const customerJobNames = async (qboSession, docs) => {
    const wanted = new Set();
    for (const doc of docs) {
        for (const line of doc.Line || []) {
            const ref = (line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail)?.CustomerRef;
            if (ref?.value !== undefined && !ref.name) wanted.add(String(ref.value));
        }
    }
    const names = new Map();
    if (!wanted.size) return names;
    const load = async (query) => {
        try {
            (await queryAll(qboSession, query)).forEach((c) => names.set(String(c.Id), c.FullyQualifiedName || c.DisplayName || ""));
        } catch (error) {
            logger.warn(`Could not look up customers/jobs (continuing): ${error.message}`);
        }
    };
    await load("select * from Customer");
    if ([...wanted].some((id) => !names.has(id))) await load("select * from Customer where Active = false");
    return names;
};

// Line-level diagnostics for Bill / VendorCredit (no names or amounts in the summary line). Always logs ONE summary:
// how many lines of each DetailType exist and how many carry an ItemRef / CustomerRef / ClassRef, so an
// "empty column" can be traced to the source data. With DEBUG_BILL_LINES=true (optional DEBUG_BILL_LINES_LIMIT,
// default 5) it also prints the COMPLETE raw JSON of the first documents that have an item line or a CustomerRef
// line, next to the exported rows built from them. Contains real financial data - off by default; never tokens.
const logLineDiagnostics = (label, raw, rows) => {

    const lines = raw.flatMap((doc) => (doc.Line || []).map((line) => ({ doc, line })));
    const detailOf = (line) => line.AccountBasedExpenseLineDetail || line.ItemBasedExpenseLineDetail || null;
    const byType = lines.reduce((acc, { line }) => ({ ...acc, [line.DetailType || "none"]: (acc[line.DetailType || "none"] || 0) + 1 }), {});
    const withRef = (key) => lines.filter(({ line }) => detailOf(line)?.[key]?.value !== undefined);

    logger.info(
        `${label} lines: documents=${raw.length} lines=${lines.length} byDetailType=${JSON.stringify(byType)} ` +
        `withItemRef=${withRef("ItemRef").length} withCustomerRef=${withRef("CustomerRef").length} (withCustomerRefName=${withRef("CustomerRef").filter(({ line }) => detailOf(line).CustomerRef.name).length}) ` +
        `withClassRef=${withRef("ClassRef").length} withBillableStatus=${lines.filter(({ line }) => detailOf(line)?.BillableStatus && detailOf(line).BillableStatus !== "NotBillable").length} ` +
        `documentsWithMemo=${raw.filter((d) => d.PrivateNote).length} exportedRows=${rows.length} rowsWithItemName=${rows.filter((r) => r.itemName).length} ` +
        `rowsWithCustomerJob=${rows.filter((r) => r.expenseCustomerJob || r.itemCustomerJob).length}`
    );

    if (!["true", "1", "on"].includes(String(process.env.DEBUG_BILL_LINES || "").toLowerCase().trim())) return;

    const limit = Number(process.env.DEBUG_BILL_LINES_LIMIT) > 0 ? Number(process.env.DEBUG_BILL_LINES_LIMIT) : 5;
    const interesting = raw.filter((doc) => (doc.Line || []).some((line) => line.DetailType === "ItemBasedExpenseLineDetail" || detailOf(line)?.CustomerRef?.value !== undefined));
    const chosen = interesting.slice(0, limit);

    console.log(`\n===== [DEBUG_BILL_LINES] ${label}: ${interesting.length} document(s) have an item line or a CustomerRef; showing ${chosen.length}${interesting.length ? "" : " - NONE: the source data has no item lines and no line CustomerRef, so the new columns are legitimately empty"} =====`);
    for (const doc of chosen) {
        console.log(`----- raw ${label} Id=${doc.Id} -----\n${JSON.stringify(doc, null, 2)}\n----- exported rows of Id=${doc.Id} -----\n${JSON.stringify(rows.filter((r) => String(r.txnId) === String(doc.Id)), null, 2)}`);
    }
    console.log(`===== [/DEBUG_BILL_LINES] ${label} =====\n`);

};

const fetchBillDetail = async (qboSession, accountRecords, itemRecords, range = null) => {

    const query = buildTxnDateQuery("Bill", range);

    logger.info(`Fetching Bill (detailed) from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} Bill record(s)`);

    const taxCodes = await loadTaxCodesForDocs(qboSession, raw);
    const customers = await customerJobNames(qboSession, raw);
    const unlinkedTax = [];
    const unresolved = new Set();

    const rows = normalizeBillDetailRecords(raw, {
        accounts: accountRecords || [], items: itemRecords || [], taxCodes, customers,
        onTaxIssue: ({ taxCodeId }) => unresolved.add(taxCodeId),
        onTaxAmountIssue: (issue) => unlinkedTax.push(issue)
    });

    const count = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
    logger.info(`Bill tax: taxCodesInQbo=${taxCodes.size} lines=${rows.length} byTaxRule=${JSON.stringify(count("taxRule"))} taxAmountSource=${JSON.stringify(count("taxAmountSource"))} billsWithUnlinkedTax=${unlinkedTax.length} customerJobLines=${rows.filter((r) => r.expenseCustomerJob || r.itemCustomerJob).length} customerJobUnresolved=${rows.filter((r) => r.customerJobUnresolved).length}`);
    unlinkedTax.slice(0, 25).forEach((u) =>
        logger.warn(`Bill ${u.docNumber || u.invoiceId}: tax ${u.unlinkedTax} could not be linked to a line - source tax code kept | TxnTaxDetail.TaxLine=[${(u.taxLines || []).join(";")}] lineTaxCodes=[${(u.lineCodes || []).join(" ; ")}]`));
    if (unresolved.size) logger.warn(`Bill tax code id(s) not found in QBO TaxCode list: ${[...unresolved].join(", ")}`);
    logLineDiagnostics("Bill", raw, rows);

    return rows;

};

// Invoice (Detailed Transactions) - mirrors fetchBillDetail on the sales
// side. Needs the already-fetched Item dataset to resolve each line's
// Product/Service to its full Parent:Child name.
// QBO TaxCode list (Id -> Name), used to resolve the id-only TaxCodeRef on
// invoice lines. Active codes first; if a line references a code that is
// not active (old invoices), ONE extra query fetches the inactive codes.
// Read-only.
const round2sum = (list) => Math.round(list.reduce((a, b) => a + b, 0) * 100) / 100;

const fetchTaxCodeMap = async (qboSession) => {

    const map = new Map();

    // TaxRate list (Id -> RateValue %) so a TaxCode can be matched to a transaction tax line by
    // PERCENT when the line's rate id is not in the code's rate list. Read-only; optional.
    // Active AND inactive rates: a TaxCode can still list an old (inactive) rate version.
    const rateValueById = new Map();
    const rateCounts = { active: 0, inactive: 0 };
    for (const [label, query] of [["active", "select * from TaxRate"], ["inactive", "select * from TaxRate where Active = false"]]) {
        try {
            const list = await queryAll(qboSession, query);
            rateCounts[label] = list.length;
            list.forEach((r) => rateValueById.set(String(r.Id), Number(r.RateValue)));
        } catch (error) {
            logger.warn(`Could not fetch ${label} TaxRate list (tax amounts can only be linked by rate id): ${error.message}`);
        }
    }
    const percentsOf = (t) => [...new Set([...(t.SalesTaxRateList?.TaxRateDetail || []), ...(t.PurchaseTaxRateList?.TaxRateDetail || [])]
        .map((d) => rateValueById.get(String(d.TaxRateRef?.value))).filter((v) => Number.isFinite(v) && v !== 0))];

    const add = (list) => list.forEach((t) => map.set(String(t.Id), {
        ratePercents: percentsOf(t),
        name: t.Name,
        taxable: t.Taxable,
        active: t.Active !== false,
        // TaxRate ids this code charges on SALES (used to link invoice TaxLine rates to lines)
        salesRateIds: (t.SalesTaxRateList?.TaxRateDetail || []).map((d) => String(d.TaxRateRef?.value)).filter((v) => v && v !== "undefined"),
        // TaxRate ids this code charges on PURCHASES (expenses / bills)
        purchaseRateIds: (t.PurchaseTaxRateList?.TaxRateDetail || []).map((d) => String(d.TaxRateRef?.value)).filter((v) => v && v !== "undefined")
    }));

    add(await queryAll(qboSession, "select * from TaxCode"));

    const listedRateIds = [...new Set([...map.values()].flatMap((c) => [...c.salesRateIds, ...c.purchaseRateIds]))];
    const missingRates = listedRateIds.filter((id) => !rateValueById.has(id));
    logger.info(`TaxRate list: active=${rateCounts.active} inactive=${rateCounts.inactive}; TaxCode rate ids with no TaxRate record=[${missingRates.join(",")}]`);

    return { map, addInactive: async () => add(await queryAll(qboSession, "select * from TaxCode where Active = false")) };

};

// Loads the QBO TaxCode list (Id -> { name, salesRateIds }) needed to resolve
// line TaxCodeRefs and to allocate per-line tax amounts, for any set of raw
// sales documents (Invoices, Credit Memos). Read-only; returns an empty map
// when nothing needs it (no extra queries then).
const loadTaxCodesForDocs = async (qboSession, rawDocs) => {

    const referencedIds = new Set();   // refs WITHOUT a name on the line
    const allRefIds = new Set();
    for (const doc of rawDocs) {
        for (const line of doc.Line || []) {
            const ref = line.SalesItemLineDetail?.TaxCodeRef || line.ItemBasedExpenseLineDetail?.TaxCodeRef || line.AccountBasedExpenseLineDetail?.TaxCodeRef || line.DepositLineDetail?.TaxCodeRef;
            if (ref?.value !== undefined) {
                allRefIds.add(String(ref.value));
                if (!ref?.name) referencedIds.add(String(ref.value));
            }
        }
    }

    // Tax AMOUNT allocation also needs each code's tax-rate list, so the TaxCode
    // list is fetched whenever a document carries non-zero TxnTaxDetail.TaxLine totals.
    const withTax = rawDocs.some((d) => (d.TxnTaxDetail?.TaxLine || []).some((t) => Number(t.Amount) !== 0 && Number.isFinite(Number(t.Amount))));

    let taxCodes = new Map();
    if (referencedIds.size || (withTax && allRefIds.size)) {
        try {
            const { map, addInactive } = await fetchTaxCodeMap(qboSession);
            taxCodes = map;
            if ([...allRefIds].some((id) => !map.has(id))) await addInactive();
        } catch (error) {
            logger.warn(`Could not fetch TaxCode list (tax codes will show as raw ids): ${error.message}`);
        }
    }

    return taxCodes;

};

const fetchCreditMemoDetail = async (qboSession, itemRecords, range = null) => {

    const query = buildTxnDateQuery("CreditMemo", range);

    logger.info(`Fetching CreditMemo (detailed) from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} CreditMemo record(s)`);

    const taxCodes = await loadTaxCodesForDocs(qboSession, raw);
    const unlinkedTax = [];
    const unresolved = new Set();

    const rows = normalizeCreditMemoDetailRecords(raw, {
        items: itemRecords || [],
        taxCodes,
        onTaxIssue: ({ taxCodeId }) => unresolved.add(taxCodeId),
        onTaxAmountIssue: (issue) => unlinkedTax.push(issue)
    });

    const byRule = rows.reduce((acc, r) => ({ ...acc, [r.taxRule]: (acc[r.taxRule] || 0) + 1 }), {});
    logger.info(`Credit note tax: lines=${rows.length} byRule=${JSON.stringify(byRule)} creditNotesWithUnlinkedTax=${unlinkedTax.length}`);
    unlinkedTax.slice(0, 25).forEach((u) =>
        logger.warn(`Credit note ${u.docNumber || u.invoiceId}: tax ${u.unlinkedTax} could not be linked to any line - source tax code kept`));
    if (unresolved.size) logger.warn(`Credit note tax code id(s) not found in QBO TaxCode list: ${[...unresolved].join(", ")}`);

    return rows;

};

// Estimates (QBO Estimate): item lines, tax code names from the TaxCode list, tax amount allocated
// from TxnTaxDetail. Read-only.
const fetchEstimates = async (qboSession, itemRecords, range = null) => {

    const query = buildTxnDateQuery("Estimate", range);

    logger.info(`Fetching Estimate from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} Estimate record(s)`);

    const taxCodes = await loadTaxCodesForDocs(qboSession, raw);
    const unlinkedTax = [];
    const unresolved = new Set();

    const rows = normalizeEstimateRecords(raw, {
        items: itemRecords || [],
        taxCodes,
        onTaxIssue: ({ taxCodeId }) => unresolved.add(taxCodeId),
        onTaxAmountIssue: (issue) => unlinkedTax.push(issue)
    });

    const count = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
    logger.info(`Estimates: estimates=${raw.length} lines=${rows.length} byStatus=${JSON.stringify(count("estimateStatus"))} byTaxRule=${JSON.stringify(count("taxRule"))} estimatesWithUnlinkedTax=${unlinkedTax.length}`);
    unlinkedTax.slice(0, 25).forEach((u) =>
        logger.warn(`Estimate ${u.docNumber || u.invoiceId}: tax ${u.unlinkedTax} could not be linked to any line - source tax code kept`));
    if (unresolved.size) logger.warn(`Estimate tax code id(s) not found in QBO TaxCode list: ${[...unresolved].join(", ")}`);

    return rows;

};

// Purchase Orders (QBO PurchaseOrder): account-based and item-based lines. Account / item / class /
// term names resolved from their lists (inactive accounts looked up when referenced). Read-only.
const fetchPurchaseOrders = async (qboSession, accountRecords, itemRecords, range = null) => {

    const query = buildTxnDateQuery("PurchaseOrder", range);

    logger.info(`Fetching PurchaseOrder from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} PurchaseOrder record(s)`);

    const lineDetails = raw.flatMap((p) => (p.Line || []).map((l) => l.AccountBasedExpenseLineDetail || l.ItemBasedExpenseLineDetail).filter(Boolean));
    const accountRefIds = lineDetails.map((d) => d.AccountRef?.value).filter((v) => v !== undefined);

    let accounts = Array.isArray(accountRecords) ? accountRecords : normalizeCollection("account", await queryAll(qboSession, ENTITIES.account.query));
    const known = new Set(accounts.map((a) => String(a.id)));
    if (accountRefIds.some((id) => !known.has(String(id)))) {
        try {
            accounts = [...accounts, ...normalizeCollection("account", await queryAll(qboSession, "select * from Account where Active = false"))];
        } catch (error) {
            logger.warn(`Could not look up inactive accounts (continuing): ${error.message}`);
        }
    }

    let classes = new Map();
    if (lineDetails.some((d) => d.ClassRef?.value !== undefined)) {
        try {
            classes = new Map((await queryAll(qboSession, "select * from Class")).map((c) => [String(c.Id), c.FullyQualifiedName || c.Name]));
        } catch (error) {
            logger.warn(`Could not fetch Class list (class names come from the line reference): ${error.message}`);
        }
    }

    const terms = raw.some((p) => p.SalesTermRef?.value !== undefined && !p.SalesTermRef?.name) ? await fetchIdNameMap(qboSession, "Term") : new Map();

    const taxCodes = await loadTaxCodesForDocs(qboSession, raw);
    const unlinkedTax = [];
    const unresolved = new Set();

    const rows = normalizePurchaseOrderRecords(raw, {
        accounts, items: itemRecords || [], classes, terms, taxCodes,
        onTaxIssue: ({ taxCodeId }) => unresolved.add(taxCodeId),
        onTaxAmountIssue: (issue) => unlinkedTax.push(issue)
    });

    const count = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
    logger.info(`Purchase orders: orders=${raw.length} lines=${rows.length} byLineKind=${JSON.stringify(count("lineKind"))} byStatus=${JSON.stringify(count("poStatus"))} byTaxRule=${JSON.stringify(count("taxRule"))} ordersWithUnlinkedTax=${unlinkedTax.length}`);
    unlinkedTax.slice(0, 25).forEach((u) =>
        logger.warn(`Purchase order ${u.docNumber || u.invoiceId}: tax ${u.unlinkedTax} could not be linked to any line - source tax code kept`));
    if (unresolved.size) logger.warn(`Purchase order tax code id(s) not found in QBO TaxCode list: ${[...unresolved].join(", ")}`);

    return rows;

};

const fetchInvoicePayments = async (qboSession, accountRecords, range = null) => {

    const query = buildTxnDateQuery("Payment", range);

    logger.info(`Fetching Payment (invoice payments) from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} Payment record(s)`);

    const paymentMethods = await fetchIdNameMap(qboSession, "PaymentMethod");

    // Inactive payment methods are not returned by the default query; look them up once if a payment points at one.
    const missingMethodIds = [...new Set(raw.map((p) => p.PaymentMethodRef?.value).filter((v) => v !== undefined && !paymentMethods.has(String(v))))];
    if (missingMethodIds.length) {
        try {
            (await queryAll(qboSession, "select * from PaymentMethod where Active = false")).forEach((m) => paymentMethods.set(String(m.Id), m.Name));
        } catch (error) {
            logger.warn(`Could not look up inactive payment methods (continuing): ${error.message}`);
        }
    }

    // Invoice numbers must equal what the Invoice sheet exports (computed over ALL invoices).
    let invoiceNumbers = new Map();
    try {
        const invoices = await queryAll(qboSession, "select Id, DocNumber from Invoice");
        invoiceNumbers = buildInvoiceNumberMap(invoices);
    } catch (error) {
        logger.warn(`Could not fetch invoice numbers (Invoice No will fall back to the invoice id): ${error.message}`);
    }

    // Deposit account: names come from the shared account list; inactive accounts are looked up once if needed.
    let accounts = Array.isArray(accountRecords) ? accountRecords : normalizeCollection("account", await queryAll(qboSession, ENTITIES.account.query));
    const known = new Set(accounts.map((a) => String(a.id)));
    if (raw.some((p) => p.DepositToAccountRef?.value !== undefined && !known.has(String(p.DepositToAccountRef.value)))) {
        try {
            accounts = [...accounts, ...normalizeCollection("account", await queryAll(qboSession, "select * from Account where Active = false"))];
        } catch (error) {
            logger.warn(`Could not look up inactive accounts (continuing): ${error.message}`);
        }
    }

    // Payments made through a payment journal link a JournalEntry: Journal No = the number the Journal sheet exports.
    const journalNumbers = raw.some((p) => (p.Line || []).some((l) => (l.LinkedTxn || []).some((t) => /journal/i.test(String(t.TxnType)))))
        ? await documentNumbers(qboSession, "JournalEntry", "journal") : new Map();

    // Which link combinations do the payment lines really have? (e.g. "Invoice+JournalEntry": 3) - counts only.
    const combos = raw.flatMap((p) => (p.Line || []).filter((l) => (l.LinkedTxn || []).length).map((l) => [...new Set(l.LinkedTxn.map((t) => t.TxnType))].sort().join("+")))
        .reduce((acc, c) => ({ ...acc, [c]: (acc[c] || 0) + 1 }), {});
    logger.info(`Invoice payments line link combinations: ${JSON.stringify(combos)}`);

    // DEBUG_PAYMENT_LINKS=true (optional DEBUG_PAYMENT_LINKS_LIMIT, default 5): the COMPLETE raw JSON of the first
    // payments whose lines link something other than a plain Invoice (journal / credit memo / other), so the real
    // shape of "journal payment allocations" can be seen. Real financial data - off by default; never tokens.
    if (["true", "1", "on"].includes(String(process.env.DEBUG_PAYMENT_LINKS || "").toLowerCase().trim())) {
        const limit = Number(process.env.DEBUG_PAYMENT_LINKS_LIMIT) > 0 ? Number(process.env.DEBUG_PAYMENT_LINKS_LIMIT) : 5;
        const odd = raw.filter((p) => (p.Line || []).some((l) => (l.LinkedTxn || []).some((t) => t.TxnType !== "Invoice")));
        console.log(`\n===== [DEBUG_PAYMENT_LINKS] ${odd.length} payment(s) link something other than an Invoice; showing ${Math.min(limit, odd.length)} =====`);
        odd.slice(0, limit).forEach((p) => console.log(`----- raw Payment Id=${p.Id} -----\n${JSON.stringify(p, null, 2)}`));
        console.log("===== [/DEBUG_PAYMENT_LINKS] =====\n");
    }

    const skipped = [];
    const rows = normalizeInvoicePaymentRecords(raw, { invoiceNumbers, journalNumbers, paymentMethods, accounts, onSkip: (s) => skipped.push(s), defaultPaymentMethod: configuredDefaultPaymentMethod() });

    const count = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
    logger.info(
        `Invoice payments: payments=${raw.length} rows=${rows.length} depositSource=${JSON.stringify(count("depositSource"))} paymentMethodSource=${JSON.stringify(count("paymentMethodSource"))} ` +
        `invoiceNumberSource=${JSON.stringify(count("invoiceNumberSource"))} byTransactionType=${JSON.stringify(count("transactionType"))} journalNumberSource=${JSON.stringify(count("journalNumberSource"))} skippedLines=${skipped.length}`
    );
    if (skipped.length) logger.info(`Invoice payments skipped lines by reason/type: ${JSON.stringify(skipped.reduce((acc, s) => { const k = `${s.reason}:${(s.types || []).join("+")}`; return { ...acc, [k]: (acc[k] || 0) + 1 }; }, {}))}`);
    skipped.slice(0, 25).forEach((s) => logger.warn(`Payment ${s.paymentId}: line not exported (${s.reason}${s.types ? ": " + s.types.join(",") : ""})`));

    return rows;

};

// Journal Entry: one row per journal line. Account names come from the shared
// account list (inactive accounts looked up once if a line points at one);
// Class full names from the Class list; Tax Code names from the TaxCode list
// when the line reference carries only an id. Read-only.
const fetchJournals = async (qboSession, accountRecords, range = null) => {

    const query = buildTxnDateQuery("JournalEntry", range);

    logger.info(`Fetching JournalEntry from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} JournalEntry record(s)`);

    const lines = raw.flatMap((j) => (j.Line || []).map((l) => l.JournalEntryLineDetail).filter(Boolean));

    let accounts = Array.isArray(accountRecords) ? accountRecords : normalizeCollection("account", await queryAll(qboSession, ENTITIES.account.query));
    const known = new Set(accounts.map((a) => String(a.id)));
    if (lines.some((d) => d.AccountRef?.value !== undefined && !known.has(String(d.AccountRef.value)))) {
        try {
            accounts = [...accounts, ...normalizeCollection("account", await queryAll(qboSession, "select * from Account where Active = false"))];
        } catch (error) {
            logger.warn(`Could not look up inactive accounts (continuing): ${error.message}`);
        }
    }

    let classes = new Map();
    if (lines.some((d) => d.ClassRef?.value !== undefined)) {
        try {
            const list = await queryAll(qboSession, "select * from Class");
            classes = new Map(list.map((c) => [String(c.Id), c.FullyQualifiedName || c.Name]));
        } catch (error) {
            logger.warn(`Could not fetch Class list (class names come from the line reference): ${error.message}`);
        }
    }

    let taxCodes = new Map();
    if (lines.some((d) => d.TaxCodeRef?.value !== undefined && !d.TaxCodeRef?.name)) {
        try {
            const { map, addInactive } = await fetchTaxCodeMap(qboSession);
            taxCodes = map;
            if (lines.some((d) => d.TaxCodeRef?.value !== undefined && !map.has(String(d.TaxCodeRef.value)))) await addInactive();
        } catch (error) {
            logger.warn(`Could not fetch TaxCode list (tax codes will show as raw ids): ${error.message}`);
        }
    }

    const skipped = [];
    const rows = normalizeJournalRecords(raw, { accounts, classes, taxCodes, onSkip: (s) => skipped.push(s) });

    const bySource = rows.reduce((acc, r) => ({ ...acc, [r.accountSource]: (acc[r.accountSource] || 0) + 1 }), {});
    logger.info(`Journal entries: journals=${raw.length} rows=${rows.length} accountSource=${JSON.stringify(bySource)} skippedLines=${skipped.length}`);
    skipped.slice(0, 25).forEach((s) => logger.warn(`JournalEntry ${s.journalId}: line ${s.lineId} not exported (${s.reason})`));

    return rows;

};

// Overpayment: Payments with an unapplied amount (optionally limited to the Conversion Period
// = payment date range). Read-only.
// Optional, set in .env: the Payment Method written when a QBO payment has none (QBO allows
// payments without a method, the import template requires one). Empty = no default.
const configuredDefaultPaymentMethod = () => String(process.env.DEFAULT_PAYMENT_METHOD || "").trim();

const fetchOverpayments = async (qboSession, accountRecords, range = null) => {

    const query = buildTxnDateQuery("Payment", range);

    logger.info(`Fetching Payment (overpayments) from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} Payment record(s)`);

    const paymentMethods = await fetchIdNameMap(qboSession, "PaymentMethod");

    let accounts = Array.isArray(accountRecords) ? accountRecords : normalizeCollection("account", await queryAll(qboSession, ENTITIES.account.query));
    const known = new Set(accounts.map((a) => String(a.id)));
    if (raw.some((p) => p.DepositToAccountRef?.value !== undefined && !known.has(String(p.DepositToAccountRef.value)))) {
        try {
            accounts = [...accounts, ...normalizeCollection("account", await queryAll(qboSession, "select * from Account where Active = false"))];
        } catch (error) {
            logger.warn(`Could not look up inactive accounts (continuing): ${error.message}`);
        }
    }

    const journalAllocated = [];
    const rows = normalizeOverpaymentRecords(raw, { paymentMethods, accounts, defaultPaymentMethod: configuredDefaultPaymentMethod(), onSkip: (s) => journalAllocated.push(s) });
    if (journalAllocated.length) logger.info(`Overpayments: ${journalAllocated.length} payment(s) left out because they are allocated through a journal / credit memo`);

    const count = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
    logger.info(
        `Overpayments: payments=${raw.length} withUnappliedAmount=${rows.length} partiallyApplied=${rows.filter((r) => r.partiallyApplied).length} ` +
        `depositSource=${JSON.stringify(count("depositSource"))} paymentMethodSource=${JSON.stringify(count("paymentMethodSource"))}`
    );

    return rows;

};

// Account list for allocation modules: the shared list, plus ONE inactive-accounts lookup when a
// referenced account id is not in it.
const accountsForRefs = async (qboSession, accountRecords, refIds) => {
    let accounts = Array.isArray(accountRecords) ? accountRecords : normalizeCollection("account", await queryAll(qboSession, ENTITIES.account.query));
    const known = new Set(accounts.map((a) => String(a.id)));
    if (refIds.some((id) => id !== undefined && !known.has(String(id)))) {
        try {
            accounts = [...accounts, ...normalizeCollection("account", await queryAll(qboSession, "select * from Account where Active = false"))];
        } catch (error) {
            logger.warn(`Could not look up inactive accounts (continuing): ${error.message}`);
        }
    }
    return accounts;
};

// {Id, DocNumber} list of one QBO entity -> Map(id -> the number that entity's own sheet exports).
const documentNumbers = async (qboSession, entityName, kind) => {
    try {
        return buildDocumentNumberMap(kind, await queryAll(qboSession, `select Id, DocNumber from ${entityName}`));
    } catch (error) {
        logger.warn(`Could not fetch ${entityName} numbers (linked numbers will fall back to the ${entityName} id): ${error.message}`);
        return new Map();
    }
};

// Other Journal Types: lines of the QBO Journal report whose Transaction Type is one of
// OTHER_JOURNAL_TRANSACTION_TYPES (QBO has no API entity for them). Read-only.
// The report needs an explicit period: the optional date range, otherwise the whole history
// (start 1990-01-01 .. today). Class is requested as an extra column; if QBO rejects the column list the
// report is fetched again with its default columns (Class then stays blank).
const fetchOtherJournal = async (qboSession, accountRecords, range = null) => {

    const params = {
        start_date: range?.startDate || "1990-01-01",
        end_date: range?.endDate || new Date().toISOString().slice(0, 10),
        accounting_method: "Accrual"
    };

    logger.info(`Fetching JournalReport from source QBO (${params.start_date} to ${params.end_date})...`);

    let report;
    try {
        report = await fetchReport(qboSession, "JournalReport", { ...params, columns: "tx_date,txn_type,doc_num,name,memo,account_name,klass_name,debit,credit" });
    } catch (error) {
        logger.warn(`JournalReport with the extended column list failed (${error.message}) - retrying with the default columns (Class will be blank)`);
        report = await fetchReport(qboSession, "JournalReport", params);
    }

    const titles = (report?.Columns?.Column || []).map((c) => c.ColTitle || c.ColType || "");
    const lines = parseJournalReportLines(report);

    const accounts = Array.isArray(accountRecords) ? accountRecords : normalizeCollection("account", await queryAll(qboSession, ENTITIES.account.query));

    let summary = null;
    const rows = normalizeOtherJournalRecords(lines, { types: OTHER_JOURNAL_TRANSACTION_TYPES, accounts, onSummary: (s) => { summary = s; } });

    logger.info(
        `Other journal: reportColumns=${JSON.stringify(titles)} reportLines=${lines.length} transactions=${summary?.transactions ?? 0} rows=${rows.length} ` +
        `unbalancedTransactions=${summary?.unbalanced ?? 0} typesInReport=${JSON.stringify(summary?.seenTypes ?? {})}`
    );
    if (lines.length && !rows.length) {
        logger.warn(`Other journal: none of the ${OTHER_JOURNAL_TRANSACTION_TYPES.length} wanted transaction types appear in the report (types seen are listed above)`);
    }

    return rows;

};

// Invoice Credit Note Allocation: Payments that apply a Credit Memo / Journal Entry. Read-only.
const fetchInvoiceCreditAllocations = async (qboSession, accountRecords, range = null) => {

    const query = buildTxnDateQuery("Payment", range);

    logger.info(`Fetching Payment (invoice credit note allocations) from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} Payment record(s)`);

    const accounts = await accountsForRefs(qboSession, accountRecords, raw.map((p) => p.DepositToAccountRef?.value));

    const [invoiceNumbers, creditNoteNumbers, journalNumbers] = await Promise.all([
        documentNumbers(qboSession, "Invoice", "invoice"),
        documentNumbers(qboSession, "CreditMemo", "creditMemo"),
        documentNumbers(qboSession, "JournalEntry", "journal")
    ]);

    const linkTypes = raw.flatMap((p) => (p.Line || []).flatMap((l) => (l.LinkedTxn || []).map((t) => t.TxnType || "none"))).reduce((acc, t) => ({ ...acc, [t]: (acc[t] || 0) + 1 }), {});
    logger.info(`Invoice credit note allocations diagnostics: paymentLineLinkTypes=${JSON.stringify(linkTypes)}`);

    const rows = normalizeInvoiceCreditAllocationRecords(raw, { invoiceNumbers, creditNoteNumbers, journalNumbers, accounts, creditNotePrefixToStrip: process.env.CREDIT_NOTE_NUMBER_STRIP_PREFIX ?? "CN-" });

    const count = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
    logger.info(
        `Invoice credit note allocations: payments=${raw.length} paymentsWithCredit=${new Set(rows.map((r) => r.txnId)).size} rows=${rows.length} ` +
        `byAppliedType=${JSON.stringify(count("appliedType"))} linkedNumberSource=${JSON.stringify(count("linkedNumberSource"))} depositSource=${JSON.stringify(count("depositSource"))}`
    );

    return rows;

};

// Bill Credit Note Allocation: BillPayments that apply a Vendor Credit. Read-only.
const fetchBillCreditAllocations = async (qboSession, accountRecords, range = null) => {

    const query = buildTxnDateQuery("BillPayment", range);

    logger.info(`Fetching BillPayment (bill credit note allocations) from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} BillPayment record(s)`);

    const accounts = await accountsForRefs(qboSession, accountRecords, raw.map((p) => (p.PayType === "CreditCard" ? p.CreditCardPayment?.CCAccountRef : p.CheckPayment?.BankAccountRef)?.value));

    const [billNumbers, vendorCreditNumbers] = await Promise.all([
        documentNumbers(qboSession, "Bill", "bill"),
        documentNumbers(qboSession, "VendorCredit", "vendorCredit")
    ]);

    // Why could there be no rows? Show every LinkedTxn type found on the BillPayment lines and how the
    // Vendor Credits themselves look (their own LinkedTxn / unapplied balance). Counts only, no names or amounts.
    const histogram = (list) => list.reduce((acc, t) => ({ ...acc, [t || "none"]: (acc[t || "none"] || 0) + 1 }), {});
    const paymentLinkTypes = histogram(raw.flatMap((p) => (p.Line || []).flatMap((l) => (l.LinkedTxn || []).map((t) => t.TxnType))));
    let vendorCreditInfo = "vendorCredits=unavailable";
    try {
        const credits = await queryAll(qboSession, "select * from VendorCredit");
        vendorCreditInfo = `vendorCredits=${credits.length} withOwnLinkedTxn=${credits.filter((c) => (c.LinkedTxn || []).length).length} ownLinkedTxnTypes=${JSON.stringify(histogram(credits.flatMap((c) => (c.LinkedTxn || []).map((t) => t.TxnType))))} partlyOrFullyApplied=${credits.filter((c) => Number(c.Balance) < Number(c.TotalAmt)).length}`;
    } catch (error) {
        logger.warn(`Could not read Vendor Credits for diagnostics (continuing): ${error.message}`);
    }
    logger.info(`Bill credit note allocations diagnostics: billPaymentLineLinkTypes=${JSON.stringify(paymentLinkTypes)} ${vendorCreditInfo}`);

    const rows = normalizeBillCreditAllocationRecords(raw, { billNumbers, vendorCreditNumbers, accounts });

    const count = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
    logger.info(
        `Bill credit note allocations: billPayments=${raw.length} withVendorCredit=${new Set(rows.map((r) => r.txnId)).size} rows=${rows.length} ` +
        `byTxnType=${JSON.stringify(count("txnType"))} linkedNumberSource=${JSON.stringify(count("linkedNumberSource"))} accountSource=${JSON.stringify(count("accountSource"))}`
    );

    return rows;

};

// Bill Payment: BillPayments applied to Bills (optionally limited to a payment date range). Read-only.
const fetchBillPayments = async (qboSession, accountRecords, range = null) => {

    const query = buildTxnDateQuery("BillPayment", range);

    logger.info(`Fetching BillPayment (bill payments) from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} BillPayment record(s)`);

    const accounts = await accountsForRefs(qboSession, accountRecords, raw.map((p) => (p.PayType === "CreditCard" ? p.CreditCardPayment?.CCAccountRef : p.CheckPayment?.BankAccountRef)?.value));
    const billNumbers = await documentNumbers(qboSession, "Bill", "bill");
    const journalNumbers = raw.some((p) => (p.Line || []).some((l) => (l.LinkedTxn || []).some((t) => /journal/i.test(String(t.TxnType)))))
        ? await documentNumbers(qboSession, "JournalEntry", "journal") : new Map();

    const combos = raw.flatMap((p) => (p.Line || []).filter((l) => (l.LinkedTxn || []).length).map((l) => [...new Set(l.LinkedTxn.map((t) => t.TxnType))].sort().join("+")))
        .reduce((acc, c) => ({ ...acc, [c]: (acc[c] || 0) + 1 }), {});
    const noLinkLines = raw.reduce((n, p) => n + (p.Line || []).filter((l) => !(l.LinkedTxn || []).length).length, 0);
    logger.info(`Bill payments line link combinations: ${JSON.stringify(combos)} linesWithoutLink=${noLinkLines} paymentsWithoutLines=${raw.filter((p) => !(p.Line || []).length).length}`);

    // DEBUG_PAYMENT_LINKS=true (optional DEBUG_PAYMENT_LINKS_LIMIT, default 5): the COMPLETE raw JSON of the first
    // bill payments whose lines link something other than a plain Bill. Real financial data - off by default.
    if (["true", "1", "on"].includes(String(process.env.DEBUG_PAYMENT_LINKS || "").toLowerCase().trim())) {
        const limit = Number(process.env.DEBUG_PAYMENT_LINKS_LIMIT) > 0 ? Number(process.env.DEBUG_PAYMENT_LINKS_LIMIT) : 5;
        const odd = raw.filter((p) => (p.Line || []).some((l) => (l.LinkedTxn || []).some((t) => t.TxnType !== "Bill")));
        console.log(`\n===== [DEBUG_PAYMENT_LINKS] BillPayment: ${odd.length} payment(s) link something other than a Bill; showing ${Math.min(limit, odd.length)} =====`);
        odd.slice(0, limit).forEach((p) => console.log(`----- raw BillPayment Id=${p.Id} -----\n${JSON.stringify(p, null, 2)}`));
        console.log("===== [/DEBUG_PAYMENT_LINKS] =====\n");
    }

    const skipped = [];
    const rows = normalizeBillPaymentRecords(raw, { billNumbers, journalNumbers, accounts, onSkip: (s) => skipped.push(s) });

    const count = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
    logger.info(
        `Bill payments: billPayments=${raw.length} rows=${rows.length} byTransactionType=${JSON.stringify(count("transactionType"))} byPayType=${JSON.stringify(count("payType"))} ` +
        `billNumberSource=${JSON.stringify(count("billNumberSource"))} accountSource=${JSON.stringify(count("accountSource"))} skippedLines=${skipped.length}`
    );
    if (skipped.length) logger.info(`Bill payments skipped lines by reason/type: ${JSON.stringify(skipped.reduce((acc, s) => { const k = `${s.reason}:${(s.types || []).join("+")}`; return { ...acc, [k]: (acc[k] || 0) + 1 }; }, {}))}`);
    skipped.slice(0, 25).forEach((s) => logger.warn(`BillPayment ${s.paymentId}: line not exported (${s.reason}: ${(s.types || []).join(",")})`));

    return rows;

};

// Bill Credit (Supplier Credit): every VendorCredit, line by line, with the Bill tax engine. Read-only.
const fetchBillCredits = async (qboSession, accountRecords, itemRecords, range = null) => {

    const query = buildTxnDateQuery("VendorCredit", range);

    logger.info(`Fetching VendorCredit (bill credit) from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} VendorCredit record(s)`);

    const taxCodes = await loadTaxCodesForDocs(qboSession, raw);
    const customers = await customerJobNames(qboSession, raw);
    const unlinkedTax = [];
    const unresolved = new Set();

    const rows = normalizeBillCreditRecords(raw, {
        accounts: accountRecords || [], items: itemRecords || [], taxCodes, customers,
        onTaxIssue: ({ taxCodeId }) => unresolved.add(taxCodeId),
        onTaxAmountIssue: (issue) => unlinkedTax.push(issue)
    });

    const count = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
    logger.info(`Bill credit tax: taxCodesInQbo=${taxCodes.size} lines=${rows.length} byTaxRule=${JSON.stringify(count("taxRule"))} taxAmountSource=${JSON.stringify(count("taxAmountSource"))} creditsWithUnlinkedTax=${unlinkedTax.length} customerJobLines=${rows.filter((r) => r.expenseCustomerJob || r.itemCustomerJob).length} customerJobUnresolved=${rows.filter((r) => r.customerJobUnresolved).length}`);
    unlinkedTax.slice(0, 25).forEach((u) =>
        logger.warn(`VendorCredit ${u.docNumber || u.invoiceId}: tax ${u.unlinkedTax} could not be linked to a line - source tax code kept | TxnTaxDetail.TaxLine=[${(u.taxLines || []).join(";")}] lineTaxCodes=[${(u.lineCodes || []).join(" ; ")}]`));
    if (unresolved.size) logger.warn(`Bill credit tax code id(s) not found in QBO TaxCode list: ${[...unresolved].join(", ")}`);
    logLineDiagnostics("VendorCredit", raw, rows);

    return rows;

};

// Bill Overpayment: BillPayments with an unapplied amount (optionally limited to the Conversion
// Period = payment date range). Read-only.
const fetchBillOverpayments = async (qboSession, accountRecords, range = null) => {

    const query = buildTxnDateQuery("BillPayment", range);

    logger.info(`Fetching BillPayment (bill overpayments) from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} BillPayment record(s)`);

    const accountIdOf = (p) => (p.PayType === "CreditCard" ? p.CreditCardPayment?.CCAccountRef : p.CheckPayment?.BankAccountRef)?.value;

    let accounts = Array.isArray(accountRecords) ? accountRecords : normalizeCollection("account", await queryAll(qboSession, ENTITIES.account.query));
    const known = new Set(accounts.map((a) => String(a.id)));
    if (raw.some((p) => accountIdOf(p) !== undefined && !known.has(String(accountIdOf(p))))) {
        try {
            accounts = [...accounts, ...normalizeCollection("account", await queryAll(qboSession, "select * from Account where Active = false"))];
        } catch (error) {
            logger.warn(`Could not look up inactive accounts (continuing): ${error.message}`);
        }
    }

    const rows = normalizeBillOverpaymentRecords(raw, { accounts });

    const count = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
    logger.info(
        `Bill overpayments: billPayments=${raw.length} withUnappliedAmount=${rows.length} partiallyApplied=${rows.filter((r) => r.partiallyApplied).length} ` +
        `byPayType=${JSON.stringify(count("payType"))} accountSource=${JSON.stringify(count("accountSource"))}`
    );

    return rows;

};

// Expense (Purchase: credit card charge / cheque / cash): one row per account-based line.
// Account / Expense Account -> full account names; Class -> full class name; payment method
// and tax code names resolved from their lists; tax amount allocated from TxnTaxDetail. Read-only.
const fetchExpenses = async (qboSession, accountRecords, range = null, kind = "expense") => {

    const query = buildTxnDateQuery("Purchase", range);

    logger.info(`Fetching Purchase (expenses) from source QBO: ${query}`);

    let raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} Purchase record(s)`);

    // QBO Purchase = credit card charge / cash expense / cheque. The team's Expense sheet and
    // Cheque sheet are separate, so each module takes only its own PaymentType (no overlap).
    const allPurchases = raw;
    // Credit Card module = PaymentType CreditCard; Cheque = Check; Expense = everything else (Cash).
    const PURCHASE_KIND = {
        creditCard: { label: "Credit Card", plural: "Credit card charges", match: (p) => p.PaymentType === "CreditCard", rule: "= CreditCard" },
        cheque: { label: "Cheque", plural: "Cheques", match: (p) => p.PaymentType === "Check", rule: "= Check" },
        expense: { label: "Expense", plural: "Expenses", match: (p) => p.PaymentType !== "Check" && p.PaymentType !== "CreditCard", rule: "not Check / CreditCard" }
    };
    const kindInfo = PURCHASE_KIND[kind] || PURCHASE_KIND.expense;
    raw = allPurchases.filter(kindInfo.match);
    logger.info(`${kindInfo.label} module: ${raw.length} of ${allPurchases.length} Purchase record(s) match (PaymentType ${kindInfo.rule})`);

    const lineDetails = raw.flatMap((p) => (p.Line || []).map((l) => l.AccountBasedExpenseLineDetail).filter(Boolean));
    const refIds = [...raw.map((p) => p.AccountRef?.value), ...lineDetails.map((d) => d.AccountRef?.value)].filter((v) => v !== undefined);

    let accounts = Array.isArray(accountRecords) ? accountRecords : normalizeCollection("account", await queryAll(qboSession, ENTITIES.account.query));
    const known = new Set(accounts.map((a) => String(a.id)));
    if (refIds.some((id) => !known.has(String(id)))) {
        try {
            accounts = [...accounts, ...normalizeCollection("account", await queryAll(qboSession, "select * from Account where Active = false"))];
        } catch (error) {
            logger.warn(`Could not look up inactive accounts (continuing): ${error.message}`);
        }
    }

    let classes = new Map();
    if (lineDetails.some((d) => d.ClassRef?.value !== undefined)) {
        try {
            classes = new Map((await queryAll(qboSession, "select * from Class")).map((c) => [String(c.Id), c.FullyQualifiedName || c.Name]));
        } catch (error) {
            logger.warn(`Could not fetch Class list (class names come from the line reference): ${error.message}`);
        }
    }

    const paymentMethods = raw.some((p) => p.PaymentMethodRef?.value !== undefined && !p.PaymentMethodRef?.name) ? await fetchIdNameMap(qboSession, "PaymentMethod") : new Map();

    const taxCodes = await loadTaxCodesForDocs(qboSession, raw);

    const skipped = [];
    const unlinkedTax = [];
    const rows = normalizeExpenseRecords(raw, {
        accounts, classes, paymentMethods, taxCodes,
        onSkip: (s) => skipped.push(s),
        onTaxIssue: () => {},
        onTaxAmountIssue: (issue) => unlinkedTax.push(issue)
    });

    const count = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
    logger.info(
        `${kindInfo.plural}: purchases=${raw.length} rows=${rows.length} byType=${JSON.stringify(count("expenseType"))} byTaxRule=${JSON.stringify(count("taxRule"))} ` +
        `itemBasedLinesSkipped=${skipped.length} purchasesWithUnlinkedTax=${unlinkedTax.length}`
    );
    skipped.slice(0, 25).forEach((s) => logger.warn(`Purchase ${s.purchaseId}: line ${s.lineId} not exported (${s.reason})`));
    unlinkedTax.slice(0, 25).forEach((t) => logger.warn(`Purchase ${t.docNumber || t.invoiceId}: tax ${t.unlinkedTax} could not be linked to a line - source tax code kept | TxnTaxDetail.TaxLine=[${(t.taxLines || []).join(";")}] lineTaxCodes=[${(t.lineCodes || []).join(" ; ")}]`));

    return rows;

};

// Transfer: one row per QBO Transfer. Account names from the shared account list
// (inactive accounts looked up once if a transfer points at one). Read-only.
const fetchTransfers = async (qboSession, accountRecords, range = null) => {

    const query = buildTxnDateQuery("Transfer", range);

    logger.info(`Fetching Transfer from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} Transfer record(s)`);

    let accounts = Array.isArray(accountRecords) ? accountRecords : normalizeCollection("account", await queryAll(qboSession, ENTITIES.account.query));
    const known = new Set(accounts.map((a) => String(a.id)));
    if (raw.some((t) => [t.FromAccountRef?.value, t.ToAccountRef?.value].some((v) => v !== undefined && !known.has(String(v))))) {
        try {
            accounts = [...accounts, ...normalizeCollection("account", await queryAll(qboSession, "select * from Account where Active = false"))];
        } catch (error) {
            logger.warn(`Could not look up inactive accounts (continuing): ${error.message}`);
        }
    }

    const rows = normalizeTransferRecords(raw, { accounts });

    const bySource = rows.reduce((acc, r) => ({ ...acc, [r.accountSource]: (acc[r.accountSource] || 0) + 1 }), {});
    logger.info(`Transfers: transfers=${raw.length} rows=${rows.length} accountSource=${JSON.stringify(bySource)}`);

    return rows;

};

// Deposit: one row per deposit line. Accounts/classes/payment methods/tax codes resolved from
// their lists; tax amount allocated from TxnTaxDetail. Read-only.
const fetchDeposits = async (qboSession, accountRecords, range = null) => {

    const query = buildTxnDateQuery("Deposit", range);

    logger.info(`Fetching Deposit from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} Deposit record(s)`);

    const details = raw.flatMap((d) => (d.Line || []).map((l) => l.DepositLineDetail).filter(Boolean));
    const refIds = [...raw.map((d) => d.DepositToAccountRef?.value), ...details.map((d) => d.AccountRef?.value)].filter((v) => v !== undefined);

    let accounts = Array.isArray(accountRecords) ? accountRecords : normalizeCollection("account", await queryAll(qboSession, ENTITIES.account.query));
    const known = new Set(accounts.map((a) => String(a.id)));
    if (refIds.some((id) => !known.has(String(id)))) {
        try {
            accounts = [...accounts, ...normalizeCollection("account", await queryAll(qboSession, "select * from Account where Active = false"))];
        } catch (error) {
            logger.warn(`Could not look up inactive accounts (continuing): ${error.message}`);
        }
    }

    let classes = new Map();
    if (details.some((d) => d.ClassRef?.value !== undefined)) {
        try {
            classes = new Map((await queryAll(qboSession, "select * from Class")).map((c) => [String(c.Id), c.FullyQualifiedName || c.Name]));
        } catch (error) {
            logger.warn(`Could not fetch Class list (class names come from the line reference): ${error.message}`);
        }
    }

    const paymentMethods = details.some((d) => d.PaymentMethodRef?.value !== undefined && !d.PaymentMethodRef?.name) ? await fetchIdNameMap(qboSession, "PaymentMethod") : new Map();

    const taxCodes = await loadTaxCodesForDocs(qboSession, raw);

    const unlinkedTax = [];
    const rows = normalizeDepositRecords(raw, { accounts, classes, paymentMethods, taxCodes, onTaxIssue: () => {}, onTaxAmountIssue: (issue) => unlinkedTax.push(issue) });

    const count = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
    logger.info(
        `Deposits: deposits=${raw.length} rows=${rows.length} lineAccountSource=${JSON.stringify(count("lineAccountSource"))} ` +
        `byTaxRule=${JSON.stringify(count("taxRule"))} depositsWithUnlinkedTax=${unlinkedTax.length}`
    );
    unlinkedTax.slice(0, 25).forEach((t) => logger.warn(`Deposit ${t.docNumber || t.invoiceId}: tax ${t.unlinkedTax} could not be linked to a line - source tax code kept | TxnTaxDetail.TaxLine=[${(t.taxLines || []).join(";")}] lineTaxCodes=[${(t.lineCodes || []).join(" ; ")}]`));

    return rows;

};

const fetchInvoiceDetail = async (qboSession, itemRecords, range = null) => {

    const query = buildTxnDateQuery("Invoice", range);

    logger.info(`Fetching Invoice (detailed) from source QBO: ${query}`);

    const raw = await queryAll(qboSession, query);

    logger.info(`Fetched ${raw.length} Invoice record(s)`);

    const taxCodes = await loadTaxCodesForDocs(qboSession, raw);

    const unresolved = new Set();
    const unlinkedTax = [];
    const rows = normalizeInvoiceDetailRecords(raw, {
        items: itemRecords || [],
        taxCodes,
        onTaxIssue: ({ taxCodeId }) => unresolved.add(taxCodeId),
        onTaxAmountIssue: (issue) => unlinkedTax.push(issue)
    });

    const bySource = rows.reduce((acc, r) => ({ ...acc, [r.taxCodeSource]: (acc[r.taxCodeSource] || 0) + 1 }), {});
    logger.info(`Invoice tax codes: taxCodesInQbo=${taxCodes.size} lines=${rows.length} bySource=${JSON.stringify(bySource)}`);
    const taxedLines = rows.filter((r) => r.taxAmountSource === "txn-tax-line");
    logger.info(
        `Invoice tax amounts: linesWithTax=${taxedLines.length} totalTax=${round2sum(taxedLines.map((r) => r.taxAmount))} ` +
        `invoicesWithUnlinkedTax=${unlinkedTax.length}`
    );
    unlinkedTax.slice(0, 25).forEach((u) =>
        logger.warn(`Invoice ${u.docNumber || u.invoiceId}: tax ${u.unlinkedTax} could not be linked to any line (TaxCode rate list missing?) - lines left at 0`));
    if (unresolved.size) logger.warn(`Invoice tax code id(s) not found in QBO TaxCode list (exported as raw id): ${[...unresolved].join(", ")}`);

    // --- optional complete JSON debug (DEBUG_INVOICE_JSON=true) -----------
    if (isInvoiceDebugEnabled()) {
        debugInvoiceNote("TaxCode list (id -> name)", Object.fromEntries([...taxCodes.entries()]));
        for (const invoice of raw) {
            debugInvoiceJson("raw", { invoiceId: invoice.Id, docNumber: invoice.DocNumber, payload: invoice });
            debugInvoiceJson("normalized", {
                invoiceId: invoice.Id,
                docNumber: invoice.DocNumber,
                payload: rows.filter((r) => r.txnId === String(invoice.Id))
            });
        }
    }

    return rows;

};

// A name->lookup map from a small QBO list entity (Term, PaymentMethod).
// Read-only; on failure the export continues with blank names.
const fetchIdNameMap = async (qboSession, entityName) => {
    try {
        const records = await queryAll(qboSession, `select * from ${entityName}`);
        return new Map(records.map((r) => [String(r.Id), r.Name]));
    } catch (error) {
        logger.warn(`Could not fetch ${entityName} list (continuing without): ${error.message}`);
        return new Map();
    }
};

// Customers: SalesTermRef / PaymentMethodRef normally carry only an id, so
// the Term and PaymentMethod lists are fetched ONCE (2 extra queries) and
// used to resolve every customer's Terms / Preferred Payment Method name.
const fetchCustomers = async (qboSession) => {

    logger.info("Fetching Customer from source QBO...");

    const raw = await queryAll(qboSession, ENTITIES.customer.query);
    const terms = await fetchIdNameMap(qboSession, "Term");
    const paymentMethods = await fetchIdNameMap(qboSession, "PaymentMethod");

    const customers = raw.map((record) => normalizeCustomer(record, { terms, paymentMethods }));

    logger.info(
        `Fetched ${raw.length} Customer record(s) ` +
        `(terms resolved: ${customers.filter((c) => c.termName).length}, ` +
        `payment methods resolved: ${customers.filter((c) => c.paymentMethodName).length})`
    );

    return customers;

};

// Fetches + normalizes a single entity type from the connected source QBO.
// `asOfDate` (optional "YYYY-MM-DD" for AR/AP, REQUIRED for openBalance) is
// the aging/trial-balance report's own "as of" date. `dataset` is
// everything already fetched earlier in this export's fetch order - only
// openBalance uses it so far, to resolve each Trial Balance row's Account
// back to its AccountType (see fetchOpenBalance above).
const fetchEntityData = async (qboSession, entityKey, asOfDate, dataset = {}, filters = {}) => {

    if (entityKey === "customer") return fetchCustomers(qboSession);
    if (entityKey === "ar") return fetchAR(qboSession, asOfDate);
    if (entityKey === "ap") return fetchAP(qboSession, asOfDate);
    if (entityKey === "openBalance") return fetchOpenBalance(qboSession, asOfDate, dataset.account || []);
    if (entityKey === "billDetail") return fetchBillDetail(qboSession, dataset.account || [], dataset.item || [], filters.billDetail);
    if (entityKey === "deposit") return fetchDeposits(qboSession, dataset.account, filters.deposit);
    if (entityKey === "transfer") return fetchTransfers(qboSession, dataset.account, filters.transfer);
    if (entityKey === "expense") return fetchExpenses(qboSession, dataset.account, filters.expense, "expense");
    if (entityKey === "cheque") return fetchExpenses(qboSession, dataset.account, filters.cheque, "cheque");
    if (entityKey === "creditCard") return fetchExpenses(qboSession, dataset.account, filters.creditCard, "creditCard");
    if (entityKey === "otherJournal") return fetchOtherJournal(qboSession, dataset.account, filters.otherJournal);
    if (entityKey === "invoiceCreditAllocation") return fetchInvoiceCreditAllocations(qboSession, dataset.account, filters.invoiceCreditAllocation);
    if (entityKey === "billCreditAllocation") return fetchBillCreditAllocations(qboSession, dataset.account, filters.billCreditAllocation);
    if (entityKey === "estimate") return fetchEstimates(qboSession, dataset.item || [], filters.estimate);
    if (entityKey === "purchaseOrder") return fetchPurchaseOrders(qboSession, dataset.account, dataset.item || [], filters.purchaseOrder);
    if (entityKey === "billPayment") return fetchBillPayments(qboSession, dataset.account, filters.billPayment);
    if (entityKey === "billCredit") return fetchBillCredits(qboSession, dataset.account || [], dataset.item || [], filters.billCredit);
    if (entityKey === "billOverpayment") return fetchBillOverpayments(qboSession, dataset.account, filters.billOverpayment);
    if (entityKey === "overpayment") return fetchOverpayments(qboSession, dataset.account, filters.overpayment);
    if (entityKey === "journal") return fetchJournals(qboSession, dataset.account, filters.journal);
    if (entityKey === "invoicePayment") return fetchInvoicePayments(qboSession, dataset.account, filters.invoicePayment);
    if (entityKey === "creditMemoDetail") return fetchCreditMemoDetail(qboSession, dataset.item || [], filters.creditMemoDetail);
    if (entityKey === "invoiceDetail") return fetchInvoiceDetail(qboSession, dataset.item || [], filters.invoiceDetail);

    const entity = ENTITIES[entityKey];

    if (!entity) return [];

    logger.info(`Fetching ${entity.qboEntity} from source QBO...`);

    const raw = await queryAll(qboSession, entity.query);

    logger.info(`Fetched ${raw.length} ${entity.qboEntity} record(s)`);

    const normalized = normalizeCollection(entityKey, raw);

    if (entityKey === "item") {
        resolveItemRelations(normalized);

        // QBO queries return ACTIVE items only. If some sub-items point at a
        // parent that is not in that list (an inactive parent), ONE extra
        // query fetches inactive items purely to resolve those parent names.
        const activeIds = new Set(normalized.map((i) => String(i.id)));
        if (normalized.some((i) => i.parentItemId && !activeIds.has(String(i.parentItemId)))) {
            try {
                const inactiveRaw = await queryAll(qboSession, "select * from Item where Active = false");
                resolveItemRelations(normalized, normalizeCollection("item", inactiveRaw));
                logger.info(`Resolved parents of sub-items from ${inactiveRaw.length} inactive item(s)`);
            } catch (error) {
                logger.warn(`Could not look up inactive parent items (continuing): ${error.message}`);
            }
        }

        // Income / Expense / Asset account -> full Account Name, resolved from
        // the SAME normalized account list that feeds the Accounts sheet.
        let accountList = Array.isArray(dataset.account) ? dataset.account : null;
        if (!accountList) {
            accountList = normalizeCollection("account", await queryAll(qboSession, ENTITIES.account.query));
        }
        if (unresolvedItemAccountIds(normalized, accountList).length) {
            try {
                const inactiveAccounts = await queryAll(qboSession, "select * from Account where Active = false");
                accountList = [...accountList, ...normalizeCollection("account", inactiveAccounts)];
            } catch (error) {
                logger.warn(`Could not look up inactive accounts (continuing): ${error.message}`);
            }
        }
        const accountStats = resolveItemAccounts(normalized, accountList);
        logger.info(`Item accounts: resolved=${accountStats.resolved} keptAsIs=${accountStats.kept}`);
        accountStats.warnings.slice(0, 25).forEach((w) => logger.warn(w));
        if (accountStats.warnings.length > 25) logger.warn(`...and ${accountStats.warnings.length - 25} more item account warning(s)`);

        const ids = new Set(normalized.map((i) => String(i.id)));
        const withParentRef = normalized.filter((i) => i.parentItemId);
        logger.info(
            `Items: total=${normalized.length} categoryItems=${normalized.filter((i) => i.type === "Category").length} ` +
            `subItemFlag=${normalized.filter((i) => i.isSubItem).length} withParentRef=${withParentRef.length} ` +
            `parentResolvedFromList=${withParentRef.filter((i) => ids.has(String(i.parentItemId))).length} ` +
            `parentNotInList=${withParentRef.filter((i) => !ids.has(String(i.parentItemId))).length} ` +
            `withCategory=${normalized.filter((i) => i.type !== "Category" && i.categoryName).length}`
        );
    }

    return normalized;

};

// Public entry point: fetches + normalizes one module and (when DEBUG_JSON
// includes "normalized") prints the normalized records as JSON.
export const fetchEntity = async (qboSession, entityKey, asOfDate, dataset = {}, filters = {}) => {
    const records = await fetchEntityData(qboSession, entityKey, asOfDate, dataset, filters);
    debugJson("normalized", entityKey, records);
    return records;
};

// Fetches every entity required for the requested modules, in dependency
// order (e.g. Customer before AR, since AR references Customer). Returns
// a map keyed by entity so the mapping engine can resolve references
// across collections. `asOfDate` is forwarded to fetchEntity for AR/AP.
export const fetchAllForExport = async (qboSession, requestedKeys, asOfDate, filters = {}) => {

    const fetchOrder = resolveFetchOrder(requestedKeys);
    const dataset = {};

    for (const key of fetchOrder) {
        dataset[key] = await fetchEntity(qboSession, key, asOfDate, dataset, filters);
    }

    return dataset;

};
