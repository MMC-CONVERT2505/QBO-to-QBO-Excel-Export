// Regression tests - run with:  npm test   (from server/)
// QuickBooks is MOCKED (global fetch). These prove the code paths; they are
// NOT a substitute for testing against the real connected company.
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.QBO_ENVIRONMENT = "sandbox";
process.env.QBO_CLIENT_ID = "test";
process.env.QBO_CLIENT_SECRET = "test";
process.env.QBO_REDIRECT_URI = "http://localhost/cb";
process.env.SESSION_SECRET = "test";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => new URL(`../src/${p}`, import.meta.url).href;

const { fetchEntity, fetchAllForExport } = await import(src("services/fetch.service.js"));
const { buildEntityReport } = await import(src("services/validation.service.js"));
const { generateCombinedExport } = await import(src("services/excel.service.js"));
const { parseDateRange, parseDateRanges, buildTxnDateQuery } = await import(src("utils/dateRange.js"));
const { collectLeafRows } = await import(src("services/reportRows.js"));
const { logger } = await import(src("utils/logger.js"));

// ---------- mock QBO ----------
const session = { realmId: "1", accessToken: "t" };
const calls = [];
let handlers = {};

const json = (o) => ({ status: 200, ok: true, json: async () => o });

globalThis.fetch = async (url) => {
    const u = new URL(url);
    const query = u.searchParams.get("query");
    calls.push({ path: u.pathname.replace(/^.*\/company\/[^/]+\//, ""), query, params: Object.fromEntries(u.searchParams) });
    if (query) {
        const entity = /from (\w+)/i.exec(query)[1];
        const h = handlers[entity];
        return json({ QueryResponse: h ? { [entity]: h(query) } : {} });
    }
    const name = u.pathname.split("/").pop();
    const h = handlers[name];
    if (!h) throw new Error(`unmocked ${u.pathname}`);
    return json(h(u));
};

const reset = (h) => { calls.length = 0; handlers = h; };

// ---------- 1. Account type / detail mapping from the client's sheet ----------
test("Account type + detail follow the client's mapping sheet exactly", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(here, "../src/mappings/ZA/source/account_mapping.xlsx"));
    const sheetMap = new Map(); // type(lowercase) -> Set(details), straight from the xlsx
    wb.worksheets[0].eachRow((row, n) => {
        if (n === 1) return;
        const t = String(row.getCell(1).value).trim(), d = String(row.getCell(2).value).trim();
        if (!sheetMap.has(t.toLowerCase())) sheetMap.set(t.toLowerCase(), { type: t, details: new Set() });
        sheetMap.get(t.toLowerCase()).details.add(d);
    });

    const qboTypes = ["Bank", "Accounts Receivable", "Other Current Asset", "Fixed Asset", "Other Asset", "Accounts Payable",
        "Credit Card", "Other Current Liability", "Long Term Liability", "Equity", "Income", "Cost of Goods Sold", "Expense",
        "Other Income", "Other Expense"];
    const records = qboTypes.map((t, i) => ({ id: String(i), fullyQualifiedName: `Acc ${i}`, accountType: t, accountSubType: "SomeSourceSubType", currency: "ZAR" }));

    const report = buildEntityReport("account", records, "ZA");
    assert.equal(report.unmappedValues, undefined, "every QBO type must resolve to a sheet entry");
    for (const r of report.rows) {
        const type = r.row["Account type *"];
        const entry = sheetMap.get(type.toLowerCase());
        assert.ok(entry, `type "${type}" must exist in the sheet`);
        assert.equal(entry.details.size, 1, "no conflicting details");
        assert.equal(r.row["Detail type *"], [...entry.details][0], `detail for ${type}`);
        assert.equal(r.status, "mapped");
    }
});

test("Unmatched account type keeps source value and is reported (not guessed)", () => {
    const report = buildEntityReport("account", [{ id: "1", fullyQualifiedName: "X", accountType: "Mystery Type", accountSubType: "Foo", currency: "ZAR" }], "ZA");
    assert.equal(report.rows[0].row["Detail type *"], "Foo");
    assert.equal(report.rows[0].status, "needs_attention");
    assert.deepEqual(Object.keys(report.unmappedValues), ["Detail type *: Mystery Type"]);
});

test("Other regions' Account mapping is untouched (US still uses its own valueMap)", () => {
    const report = buildEntityReport("account", [{ id: "1", fullyQualifiedName: "A", accountType: "Bank", accountSubType: "Checking" }], "US");
    assert.equal(report.rows[0].row["Account Type"], "Bank");
    assert.equal(report.rows[0].row["Account Sub Type"], "Checking");
});

// ---------- 2. Item category ----------
test("Item category resolves from ParentRef chain (ids only), blank when none", async () => {
    reset({
        Item: () => [
            { Id: "1", Name: "Hardware", FullyQualifiedName: "Hardware", Type: "Category" },
            { Id: "2", Name: "Tools", FullyQualifiedName: "Hardware:Tools", Type: "Category", SubItem: true, ParentRef: { value: "1" } },
            { Id: "3", Name: "Hammer", FullyQualifiedName: "Hardware:Tools:Hammer", Type: "Inventory", SubItem: true, ParentRef: { value: "2" } },
            { Id: "4", Name: "Loose item", FullyQualifiedName: "Loose item", Type: "Service" }
        ]
    });
    const items = await fetchEntity(session, "item", undefined, {});
    const byName = Object.fromEntries(items.map((i) => [i.name, i.categoryName]));
    assert.equal(byName.Hammer, "Hardware:Tools");
    assert.equal(byName.Tools, "Hardware");
    assert.equal(byName["Loose item"], "");
    const report = buildEntityReport("item", items, "ZA");
    assert.equal(report.total, 4); // Hardware, Tools (parents of an exported item) + Hammer + Loose item
    assert.deepEqual(report.rows.map((r) => r.row["Product/Service *"]), ["Hardware", "Hardware:Tools", "Hardware:Tools:Hammer", "Loose item"], "each parent directly above its child");
    assert.equal(report.rows.find((r) => r.row["Product/Service *"].endsWith("Hammer")).row["Category"], "Hardware:Tools");
});

// ---------- 3. Customer: every template field ----------
test("Customer export fills every supported template column; blanks stay blank", async () => {
    reset({
        Customer: () => [{
            Id: "9", Title: "Mr", GivenName: "Ann", MiddleName: "B", FamilyName: "Cole", Suffix: "Jr", CompanyName: "Cole Co", DisplayName: "Cole Co",
            PrintOnCheckName: "Cole Co", PrimaryEmailAddr: { Address: "a@b.co" }, PrimaryPhone: { FreeFormNumber: "011" }, Mobile: { FreeFormNumber: "082" },
            Fax: { FreeFormNumber: "012" }, AlternatePhone: { FreeFormNumber: "013" }, WebAddr: { URI: "https://cole.co" },
            BillAddr: { Line1: "1 A St", Line2: "Unit 2", Line3: "Bldg 3", City: "Cape Town", PostalCode: "8001", Country: "ZA", CountrySubDivisionCode: "WC" },
            ShipAddr: { Line1: "9 Z Rd", Line2: "L2", Line3: "L3", City: "Durban", PostalCode: "4001", Country: "ZA", CountrySubDivisionCode: "KZN" },
            SalesTermRef: { value: "3" }, PaymentMethodRef: { value: "5" }, PreferredDeliveryMethod: "Email", Notes: "VIP", ResaleNum: "R1", Taxable: true,
            CurrencyRef: { value: "ZAR" }
        }, { Id: "10", DisplayName: "Bare Customer" }],
        Term: () => [{ Id: "3", Name: "Net 30" }],
        PaymentMethod: () => [{ Id: "5", Name: "EFT" }]
    });
    const customers = await fetchEntity(session, "customer", undefined, {});
    const report = buildEntityReport("customer", customers, "ZA");
    const full = report.rows[0].row;
    for (const [h, v] of Object.entries({
        "Title": "Mr", "Middle Name": "B", "Suffix": "Jr", "Billing Address Line 2": "Unit 2", "Billing Address Line 3": "Bldg 3",
        "Shipping Address Line 1": "9 Z Rd", "Shipping Address City": "Durban", "Shipping Address Postal Code": "4001",
        "Shipping Address Country": "ZA", "Shipping Address Country Subdivision Code": "KZN", "Mobile": "082", "Fax": "012",
        "Other": "013", "Website": "https://cole.co", "Terms": "Net 30", "Preferred Payment Method": "EFT",
        "Preferred Delivery Method": "Email", "Notes": "VIP", "Currency Code": "ZAR"
    })) assert.equal(full[h], v, h);
    const bare = report.rows[1].row;
    // The source value is no longer invented as "USD"; the ZA mapping's own
    // defaultValue (destination currency) applies when QBO sent no currency.
    assert.equal(customers[1].currency, "", "normalizer no longer invents USD");
    assert.equal(bare["Currency Code"], "ZAR");
    assert.equal(bare["Terms"], "");
    assert.equal(report.rows[1].status, "mapped");
});

// ---------- 4. Open Balance ----------
const tbReport = (rows, extra = {}) => ({
    Header: { ReportName: "TrialBalance", StartPeriod: "x", EndPeriod: "y", ReportBasis: "Accrual", Option: [{ Name: "NoReportData", Value: String(rows.length === 0) }] },
    Columns: { Column: [{ ColTitle: "" }, { ColTitle: "Debit" }, { ColTitle: "Credit" }] },
    Rows: { Row: rows }, ...extra
});
const accounts = [{ id: "1", name: "Bank", accountType: "Bank" }, { id: "2", name: "AR", accountType: "Accounts Receivable" }, { id: "3", name: "Capital", accountType: "Equity" }];
const dataRow = (name, id, d, c, type = "Data") => ({ ...(type ? { type } : {}), ColData: [{ value: name, id }, { value: d }, { value: c }] });

test("Open Balance: rows WITHOUT type:'Data' are still parsed (cannot silently drop to 0)", async () => {
    reset({
        Preferences: () => ({ Preferences: { AccountingInfoPrefs: { FirstMonthOfFiscalYear: "January" } } }),
        preferences: () => ({ Preferences: { AccountingInfoPrefs: { FirstMonthOfFiscalYear: "January" } } }),
        TrialBalance: () => tbReport([dataRow("Bank", "1", "1000.00", "", null), dataRow("AR", "2", "500.00", "", null), dataRow("Capital", "3", "", "1500.00", null),
            { type: "Section", group: "GrandTotal", Summary: { ColData: [{ value: "TOTAL" }, { value: "1500" }, { value: "1500" }] } }])
    });
    const rows = await fetchEntity(session, "openBalance", "2026-02-28", { account: accounts });
    assert.equal(rows.length, 3);
    assert.equal(rows.reduce((s, r) => s + r.amount, 0), 0);
    assert.equal(rows.find((r) => r.originalAccountName === "AR").accountName, "Retained Earnings", "AR -> Retained Earnings rule preserved");
    const tb = calls.find((c) => c.path === "reports/TrialBalance");
    assert.equal(tb.params.end_date, "2026-02-28");
    assert.equal(tb.params.start_date, "2026-01-01");
    assert.equal(tb.params.report_date, undefined);
});

test("Open Balance: typed Data rows, nested sections and fiscal year start (April)", async () => {
    reset({
        preferences: () => ({ Preferences: { AccountingInfoPrefs: { FirstMonthOfFiscalYear: "March" } } }),
        TrialBalance: () => tbReport([{ type: "Section", Rows: { Row: [dataRow("Bank", "1", "10", "")] } }, dataRow("Capital", "3", "", "10")])
    });
    const rows = await fetchEntity(session, "openBalance", "2026-02-10", { account: accounts });
    assert.equal(rows.length, 2);
    assert.equal(calls.find((c) => c.path === "reports/TrialBalance").params.start_date, "2025-03-01");
});

test("Open Balance: empty report returns [] without crashing; missing cutoff date is rejected", async () => {
    reset({ preferences: () => ({ Preferences: {} }), TrialBalance: () => tbReport([]) });
    assert.deepEqual(await fetchEntity(session, "openBalance", "2026-02-28", { account: accounts }), []);
    await assert.rejects(fetchEntity(session, "openBalance", "", { account: accounts }), /cutoff date/);
});

test("Open Balance report flags an unbalanced journal", () => {
    const report = buildEntityReport("openBalance", [
        { journalNo: "Opening Balance", journalDate: "2026-02-28", accountName: "Bank", amount: 100, exchangeRate: 1 }], "ZA");
    assert.equal(report.balanceCheck.balanced, false);
});

// ---------- 5. Invoice / Bill date range ----------
test("date range validation", () => {
    assert.equal(parseDateRange(undefined, "Invoice"), null);
    assert.equal(parseDateRange({ startDate: "", endDate: "" }, "Invoice"), null);
    assert.deepEqual(parseDateRange({ startDate: "2026-01-01" }, "Invoice"), { startDate: "2026-01-01", endDate: null });
    assert.throws(() => parseDateRange({ startDate: "2026-02-30" }, "Invoice"), /valid date/);
    assert.throws(() => parseDateRange({ startDate: "01/02/2026" }, "Bill"), /valid date/);
    assert.throws(() => parseDateRange({ startDate: "2026-03-01", endDate: "2026-02-01" }, "Bill"), /cannot be after/);
    assert.deepEqual(Object.keys(parseDateRanges({ invoiceDetail: { startDate: "2026-01-01" }, other: { startDate: "bad" } })), ["invoiceDetail"]);
});

test("TxnDate query builder", () => {
    assert.equal(buildTxnDateQuery("Invoice", null), "select * from Invoice");
    assert.equal(buildTxnDateQuery("Bill", { startDate: "2026-01-01", endDate: "2026-03-31" }), "select * from Bill where TxnDate >= '2026-01-01' and TxnDate <= '2026-03-31'");
    assert.equal(buildTxnDateQuery("Bill", { startDate: null, endDate: "2026-03-31" }), "select * from Bill where TxnDate <= '2026-03-31'");
});

const inv = (id, date) => ({ Id: id, DocNumber: `I${id}`, TxnDate: date, CustomerRef: { value: "1", name: "C" }, Line: [{ DetailType: "SalesItemLineDetail", Amount: 10, SalesItemLineDetail: { Qty: 1, UnitPrice: 10, ItemRef: { value: "1", name: "Widget" } } }] });
const bill = (id, date) => ({ Id: id, DocNumber: `B${id}`, TxnDate: date, VendorRef: { value: "1", name: "V" }, Line: [{ DetailType: "AccountBasedExpenseLineDetail", Amount: 5, AccountBasedExpenseLineDetail: { AccountRef: { value: "1", name: "Bank" } } }] });
const dateFilteredMock = (all) => (query) => {
    const lo = /TxnDate >= '([\d-]+)'/.exec(query)?.[1], hi = /TxnDate <= '([\d-]+)'/.exec(query)?.[1];
    return all.filter((r) => (!lo || r.TxnDate >= lo) && (!hi || r.TxnDate <= hi));
};

test("Invoice & Bill: changing the range changes the request AND the returned records", async () => {
    reset({
        Invoice: dateFilteredMock([inv("1", "2026-01-10"), inv("2", "2026-02-10"), inv("3", "2026-03-10")]),
        Bill: dateFilteredMock([bill("1", "2026-01-15"), bill("2", "2026-04-15")])
    });
    const all = await fetchEntity(session, "invoiceDetail", undefined, { item: [] }, {});
    const feb = await fetchEntity(session, "invoiceDetail", undefined, { item: [] }, { invoiceDetail: { startDate: "2026-02-01", endDate: "2026-02-28" } });
    const none = await fetchEntity(session, "invoiceDetail", undefined, { item: [] }, { invoiceDetail: { startDate: "2027-01-01", endDate: null } });
    assert.deepEqual([all.length, feb.length, none.length], [3, 1, 0]);
    assert.match(calls.find((c) => /Invoice where/i.test(c.query || "")).query, /TxnDate >= '2026-02-01' and TxnDate <= '2026-02-28'/);

    const b1 = await fetchEntity(session, "billDetail", undefined, { account: [], item: [] }, { billDetail: { startDate: null, endDate: "2026-02-01" } });
    const b2 = await fetchEntity(session, "billDetail", undefined, { account: [], item: [] }, {});
    assert.deepEqual([b1.length, b2.length], [1, 2]);
});

// ---------- 6. Final Excel contains the rows ----------
test("Combined Excel (ZA) contains mapped Account detail, Item category and Customer fields", async () => {
    reset({
        Account: () => [{ Id: "1", Name: "Cash", FullyQualifiedName: "Cash", AccountType: "Bank", AccountSubType: "Checking", Active: true }],
        Item: () => [{ Id: "1", Name: "Cat", FullyQualifiedName: "Cat", Type: "Category" }, { Id: "2", Name: "Widget", FullyQualifiedName: "Cat:Widget", Type: "Service", SubItem: true, ParentRef: { value: "1" }, IncomeAccountRef: { value: "1", name: "Cash" } }],
        Customer: () => [{ Id: "1", DisplayName: "Zed", Mobile: { FreeFormNumber: "082" }, Notes: "n" }],
        Term: () => [], PaymentMethod: () => []
    });
    const keys = ["account", "item", "customer"];
    const dataset = await fetchAllForExport(session, keys, undefined, {});
    const { buffer } = await generateCombinedExport("ZA", dataset, keys);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const grid = (name) => { const ws = wb.getWorksheet(name); const h = ws.getRow(1).values; const r = ws.getRow(2).values; return Object.fromEntries(h.map((x, i) => [x, r[i]]).filter(([x]) => x)); };
    const acct = grid("Accounts");
    assert.equal(acct["Account type *"], "Cash and cash equivalents");
    assert.equal(acct["Detail type *"], "Cash and cash equivalents/Bank");
    { const ws = wb.getWorksheet("Items"); const h = ws.getRow(1).values; const col = h.indexOf("Category"); assert.equal(ws.getRow(2).values[1], "Cat", "parent row first"); assert.equal(ws.getRow(3).values[col], "Cat"); }
    assert.equal(grid("Customers")["Mobile"], "082");
});

// ---------- 7. Diagnostics are read-only and contain no names/amounts ----------
test("Open Balance diagnostics return structure only (no account names or amounts)", async () => {
    const { diagnoseOpenBalance } = await import(src("services/diagnostics.service.js"));
    reset({
        preferences: () => ({ Preferences: { AccountingInfoPrefs: { FirstMonthOfFiscalYear: "January" } } }),
        companyinfo: () => ({ CompanyInfo: { Country: "ZA", FiscalYearStartMonth: "January" } }),
        Account: () => [{ Id: "1", Name: "SECRET-NAME", CurrentBalance: 123.45 }],
        TrialBalance: () => tbReport([dataRow("SECRET-NAME", "1", "999.99", ""), dataRow("Other", "2", "", "999.99")])
    });
    const result = await diagnoseOpenBalance(session, "2026-02-28");
    const text = JSON.stringify(result);
    assert.ok(!text.includes("SECRET-NAME") && !text.includes("999.99") && !text.includes("123.45"));
    assert.equal(result.variants.length, 5);
    assert.equal(result.variants[0].leafRowsTolerant, 2);
    assert.equal(result.variants[0].debitsEqualCredits, true);
    assert.equal(result.accounts.withNonZeroCurrentBalance, 1);
    assert.ok(calls.every((c) => !c.query || c.query.toLowerCase().startsWith("select")), "only read (select) queries");
});

// ---------- 8. Other regions still export ----------
test("Account/Customer/Vendor/Item export still works for every region", async () => {
    for (const region of ["US", "CA", "UK", "AU", "NZ", "ZA"]) {
        reset({
            Account: () => [{ Id: "1", Name: "Cash", FullyQualifiedName: "Cash", AccountType: "Bank", AccountSubType: "Checking" }],
            Customer: () => [{ Id: "1", DisplayName: "C" }], Vendor: () => [{ Id: "1", DisplayName: "V" }],
            Item: () => [{ Id: "1", Name: "I", FullyQualifiedName: "I", Type: "Service", IncomeAccountRef: { value: "1", name: "Cash" } }],
            Term: () => [], PaymentMethod: () => []
        });
        const keys = ["account", "customer", "vendor", "item"];
        const dataset = await fetchAllForExport(session, keys, undefined, {});
        const { buffer } = await generateCombinedExport(region, dataset, keys);
        assert.ok(buffer.length > 1000, `${region} workbook generated`);
    }
});

// ---------- 9. Parent Item (separate from Category) ----------
const rawItems = {
    active: [
        { Id: "10", Name: "Hardware", FullyQualifiedName: "Hardware", Type: "Category" },                                        // category (not exported)
        { Id: "11", Name: "Tools", FullyQualifiedName: "Hardware:Tools", Type: "Category", SubItem: true, ParentRef: { value: "10" } },
        { Id: "12", Name: "Hammer", FullyQualifiedName: "Hardware:Tools:Hammer", Type: "Inventory", IncomeAccountRef: { value: "1", name: "Cash" }, SubItem: true, ParentRef: { value: "11" } }, // id-only ParentRef, nested
        { Id: "20", Name: "Consulting", FullyQualifiedName: "Consulting", Type: "Service", IncomeAccountRef: { value: "1", name: "Cash" } },                                    // parent item (regular) with children
        { Id: "21", Name: "Audit", FullyQualifiedName: "Consulting:Audit", Type: "Service", IncomeAccountRef: { value: "1", name: "Cash" }, SubItem: true, ParentRef: { value: "20", name: "Consulting" } },
        { Id: "22", Name: "Tax", FullyQualifiedName: "Consulting:Tax", Type: "Service", IncomeAccountRef: { value: "1", name: "Cash" }, SubItem: true, ParentRef: { value: "20" } },
        { Id: "30", Name: "Standalone", FullyQualifiedName: "Standalone", Type: "Service", IncomeAccountRef: { value: "1", name: "Cash" } },                                   // no parent
        { Id: "40", Name: "Old Child", FullyQualifiedName: "Retired:Old Child", Type: "Service", IncomeAccountRef: { value: "1", name: "Cash" }, SubItem: true, ParentRef: { value: "99" } } // parent is INACTIVE
    ],
    inactive: [{ Id: "99", Name: "Retired", FullyQualifiedName: "Retired", Type: "Service", IncomeAccountRef: { value: "1", name: "Cash" }, Active: false }]
};
const itemMock = () => ({
    Item: (q) => (/Active = false/.test(q) ? rawItems.inactive : rawItems.active),
    Term: () => [], PaymentMethod: () => []
});

test("Parent Item: child, parent-with-children, standalone, nested, inactive parent (raw -> normalized)", async () => {
    reset(itemMock());
    const items = await fetchEntity(session, "item", undefined, {});
    const by = Object.fromEntries(items.map((i) => [i.name, i]));

    assert.equal(by.Hammer.parentItemName, "Hardware:Tools", "nested: immediate parent (fully qualified), name resolved from id");
    assert.equal(by.Hammer.categoryName, "Hardware:Tools".split(":").join(":"), "category chain is separate");
    assert.equal(by.Audit.parentItemName, "Consulting");
    assert.equal(by.Tax.parentItemName, "Consulting", "id-only ParentRef resolved from the item list");
    assert.equal(by.Tax.categoryName, "", "a regular parent item is NOT a category");
    assert.equal(by.Consulting.parentItemName, "", "parent item itself has no parent");
    assert.equal(by.Standalone.parentItemName, "");
    assert.equal(by.Standalone.categoryName, "");
    assert.equal(by["Old Child"].parentItemName, "Retired", "inactive parent resolved via lookup query");
    assert.equal(items.length, rawItems.active.length, "inactive items are used for lookup only, not added as rows");
    assert.ok(calls.some((c) => /Active = false/.test(c.query || "")), "one extra lookup query for inactive parents");
});

test("Parent Item: final ZA Excel sheet, Parent Item and Category are separate columns", async () => {
    reset({ ...itemMock(), Account: () => [{ Id: "1", Name: "Cash", FullyQualifiedName: "Cash", AccountType: "Bank", AccountSubType: "Checking" }] });
    const keys = ["item"];
    const dataset = await fetchAllForExport(session, ["item"], undefined, {});
    const { buffer, summary } = await generateCombinedExport("ZA", dataset, keys); assert.equal(summary[0].skippedRows, 0);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet("Items");
    const head = ws.getRow(1).values;
    const rows = [];
    ws.eachRow((row, n) => { if (n > 1) rows.push(Object.fromEntries(head.map((h, i) => [h, row.values[i]]).filter(([h]) => h))); });

    const byName = Object.fromEntries(rows.map((r) => [r["Product/Service *"], r]));
    assert.equal(rows.length, 8, "all 8 active items: Category parents with children are exported too");
    assert.deepEqual(rows.map((r) => r["Product/Service *"]), ["Hardware", "Hardware:Tools", "Hardware:Tools:Hammer", "Consulting", "Consulting:Audit", "Consulting:Tax", "Standalone", "Retired:Old Child"]);
    assert.equal(byName["Hardware:Tools:Hammer"]["Parent Item"], "Hardware:Tools");
    assert.equal(byName["Hardware:Tools:Hammer"]["Category"], "Hardware:Tools");
    assert.equal(byName["Consulting:Audit"]["Parent Item"], "Consulting");
    assert.equal(byName["Consulting:Audit"]["Category"] ?? "", "");
    assert.equal(byName["Consulting:Tax"]["Parent Item"], "Consulting");
    assert.equal(byName["Consulting"]["Parent Item"] ?? "", "");
    assert.equal(byName["Standalone"]["Parent Item"] ?? "", "");
    assert.equal(byName["Retired:Old Child"]["Parent Item"], "Retired");
});

test("Parent Item: AU 'Parent Ref Name' column is now populated even when ParentRef has only an id", async () => {
    reset({ ...itemMock(), Account: () => [{ Id: "1", Name: "Cash", FullyQualifiedName: "Cash", AccountType: "Bank", AccountSubType: "Checking" }] });
    const dataset = await fetchAllForExport(session, ["item"], undefined, {});
    const { buffer } = await generateCombinedExport("AU", dataset, ["item"]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet("Items");
    const head = ws.getRow(1).values;
    const col = head.indexOf("Parent Ref Name");
    assert.ok(col > 0);
    const values = []; ws.eachRow((row, n) => { if (n > 1) values.push(row.values[col] ?? ""); });
    assert.equal(values.filter(Boolean).length, 5, "5 sub-items carry a parent name");
});

test("Item diagnostics return counts only", async () => {
    const { diagnoseItems } = await import(src("services/diagnostics.service.js"));
    reset(itemMock());
    const d = await diagnoseItems(session);
    assert.equal(d.activeItems, 8);
    assert.equal(d.withParentRef, 5);
    assert.equal(d.parentRefIdOnly, 4);
    assert.equal(d.parentIsInactiveOnly, 1);
    assert.equal(d.maxNestingDepth, 2);
    assert.ok(!JSON.stringify(d).includes("Hammer"));
});

// ---------- 10. Parent row above its child: Consultation / Consultation:Consultation ----------
test("Parent 'Consultation' is exported once, directly above 'Consultation:Consultation'; childless category stays out", async () => {
    reset({
        Item: () => [
            { Id: "5", Name: "Consultation", FullyQualifiedName: "Consultation", Type: "Category" },
            { Id: "6", Name: "Consultation", FullyQualifiedName: "Consultation:Consultation", Type: "Service", SubItem: true, ParentRef: { value: "5", name: "Consultation" }, IncomeAccountRef: { value: "1", name: "Cash" } },
            { Id: "7", Name: "Empty Cat", FullyQualifiedName: "Empty Cat", Type: "Category" },
            { Id: "8", Name: "Other", FullyQualifiedName: "Other", Type: "Service", IncomeAccountRef: { value: "1", name: "Cash" } }
        ],
        Account: () => [{ Id: "1", Name: "Cash", FullyQualifiedName: "Cash", AccountType: "Bank", AccountSubType: "Checking" }],
        Term: () => [], PaymentMethod: () => []
    });
    const dataset = await fetchAllForExport(session, ["item"], undefined, {});
    const { buffer, summary } = await generateCombinedExport("ZA", dataset, ["item"]);
    assert.equal(summary[0].skippedRows, 0, "parent row is valid (no income account required for a Category)");
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet("Items");
    const names = []; ws.eachRow((row, n) => { if (n > 1) names.push(row.values[1]); });
    assert.deepEqual(names, ["Consultation", "Consultation:Consultation", "Other"]);
    const head = ws.getRow(1).values; const pi = head.indexOf("Parent Item");
    assert.equal(ws.getRow(2).values[pi] ?? "", "", "parent row has no parent");
    assert.equal(ws.getRow(3).values[pi], "Consultation", "child row keeps its Parent Item");
});

// ---------- 11. ZA: Category -> Service, Income/Expense account -> full Account Name ----------
const acctRaw = [
    { Id: "100", Name: "Fee Income", FullyQualifiedName: "Fee Income", AccountType: "Income", AccountSubType: "ServiceFeeIncome" },
    { Id: "101", Name: "Litigation", FullyQualifiedName: "Fee Income:Litigation", AccountType: "Income", AccountSubType: "ServiceFeeIncome", SubAccount: true, ParentRef: { value: "100" } },
    { Id: "102", Name: "Litigation", FullyQualifiedName: "Other Income:Litigation", AccountType: "Income", AccountSubType: "OtherPrimaryIncome", SubAccount: true },
    { Id: "103", Name: "Rent", FullyQualifiedName: "Rent", AccountType: "Expense", AccountSubType: "RentOrLeaseOfBuildings" }
];
const readItemsSheet = async (region, dataset) => {
    const { buffer, summary } = await generateCombinedExport(region, dataset, ["item"]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet("Items"); const head = ws.getRow(1).values;
    const rows = []; ws.eachRow((row, n) => { if (n > 1) rows.push(Object.fromEntries(head.map((h, i) => [h, row.values[i]]).filter(([h]) => h))); });
    return { rows, summary };
};

test("ZA Items: parent 'Consultation' and child both Type 'Service'; income account resolved by ID to full Account Name", async () => {
    reset({
        Account: () => acctRaw,
        Item: (q) => (/Active = false/.test(q) ? [] : [
            { Id: "5", Name: "Consultation", FullyQualifiedName: "Consultation", Type: "Category" },
            { Id: "6", Name: "Consultation", FullyQualifiedName: "Consultation:Consultation", Type: "Service", SubItem: true, ParentRef: { value: "5" }, IncomeAccountRef: { value: "101", name: "Litigation" }, ExpenseAccountRef: { value: "103", name: "Rent" } },
            { Id: "7", Name: "Inv", FullyQualifiedName: "Inv", Type: "Inventory", IncomeAccountRef: { value: "100", name: "Fee Income" } }
        ]),
        Term: () => [], PaymentMethod: () => []
    });
    const dataset = await fetchAllForExport(session, ["item"], undefined, {});
    const rawRecord = dataset.item.find((i) => i.id === "6");
    assert.equal(rawRecord.incomeAccountName, "Litigation", "normalized short name is preserved");
    assert.equal(rawRecord.incomeAccountFullName, "Fee Income:Litigation");

    const { rows, summary } = await readItemsSheet("ZA", dataset);
    assert.equal(summary[0].skippedRows, 0);
    assert.deepEqual(rows.map((r) => [r["Product/Service *"], r["Type *"]]), [["Consultation", "Service"], ["Consultation:Consultation", "Service"], ["Inv", "Inventory"]], "Category->Service only; Inventory untouched");
    assert.equal(rows[1]["Income Account *"], "Fee Income:Litigation", "ID match picks the right 'Litigation' despite a duplicate short name");
    assert.equal(rows[1]["Expense Account"], "Rent");
    assert.equal(rows[2]["Income Account *"], "Fee Income");
    assert.equal(rows.filter((r) => r["Product/Service *"] === "Consultation").length, 1, "parent exported exactly once");
});

test("ZA Items: unmatched / ambiguous / inactive account references are kept (never guessed) and warned", async () => {
    reset({
        Account: (q) => (/Active = false/.test(q) ? [{ Id: "200", Name: "Old Sales", FullyQualifiedName: "Retired:Old Sales", AccountType: "Income", Active: false }] : acctRaw),
        Item: (q) => (/Active = false/.test(q) ? [] : [
            { Id: "1", Name: "NoId", FullyQualifiedName: "NoId", Type: "Service", IncomeAccountRef: { name: "Litigation" } },         // name only, duplicate short name -> ambiguous
            { Id: "2", Name: "Unknown", FullyQualifiedName: "Unknown", Type: "Service", IncomeAccountRef: { value: "999", name: "Ghost" } }, // not in either list
            { Id: "3", Name: "Inactive", FullyQualifiedName: "Inactive", Type: "Service", IncomeAccountRef: { value: "200", name: "Old Sales" } }, // inactive account
            { Id: "4", Name: "NameOnly", FullyQualifiedName: "NameOnly", Type: "Service", IncomeAccountRef: { name: "Fee Income:Litigation" } }   // unique full name -> safe
        ]),
        Term: () => [], PaymentMethod: () => []
    });
    const warnings = [];
    const origWarn = logger.warn; logger.warn = (m) => warnings.push(String(m));
    let rows;
    try {
        const dataset = await fetchAllForExport(session, ["item"], undefined, {});
        ({ rows } = await readItemsSheet("ZA", dataset));
    } finally { logger.warn = origWarn; }
    const by = Object.fromEntries(rows.map((r) => [r["Product/Service *"], r["Income Account *"]]));
    assert.equal(by.NoId, "Litigation", "ambiguous name kept as is");
    assert.equal(by.Unknown, "Ghost", "unmatched kept as is");
    assert.equal(by.Inactive, "Retired:Old Sales", "inactive account resolved via lookup");
    assert.equal(by.NameOnly, "Fee Income:Litigation");
    assert.ok(warnings.some((w) => /NoId/.test(w) && /matches 2 accounts/.test(w)));
    assert.ok(warnings.some((w) => /Unknown/.test(w) && /not found in Accounts/.test(w)));
});

test("Other regions' Item Type and account columns are unchanged (AU keeps Category->no valueMap, short account names)", async () => {
    reset({
        Account: () => acctRaw,
        Item: (q) => (/Active = false/.test(q) ? [] : [{ Id: "6", Name: "X", FullyQualifiedName: "X", Type: "Service", IncomeAccountRef: { value: "101", name: "Litigation" } }]),
        Term: () => [], PaymentMethod: () => []
    });
    const dataset = await fetchAllForExport(session, ["item"], undefined, {});
    const { rows } = await readItemsSheet("AU", dataset);
    assert.equal(rows.length, 1);
    assert.ok(Object.values(rows[0]).includes("Litigation"), "AU still shows the short account name");
    assert.ok(!Object.values(rows[0]).includes("Fee Income:Litigation"));
});

test("DEBUG_JSON prints raw, normalized and mapped JSON for every module; silent when unset", async () => {
    const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(" "));
    try {
        reset({ Account: () => acctRaw, Item: () => [], Term: () => [], PaymentMethod: () => [] });
        delete process.env.DEBUG_JSON;
        await fetchAllForExport(session, ["account"], undefined, {});
        assert.equal(lines.filter((l) => l.includes("[DEBUG_JSON]")).length, 0, "off by default");

        process.env.DEBUG_JSON = "all";
        const dataset = await fetchAllForExport(session, ["account"], undefined, {});
        await generateCombinedExport("ZA", dataset, ["account"]);
    } finally { console.log = orig; delete process.env.DEBUG_JSON; }
    const text = lines.join("\n");
    for (const stage of ["raw", "normalized", "mapped"]) assert.ok(text.includes(`stage=${stage} `), `${stage} stage printed`);
    assert.ok(text.includes('"fullyQualifiedName": "Fee Income:Litigation"'));
    assert.ok(!/access_?token|refresh_?token/i.test(text));
});

// ---------- 12. Invoice tax code: resolved from QBO TaxCode, never blanket "Out of Scope" ----------
const taxLine = (amount, taxCodeId, extra = {}) => ({
    DetailType: "SalesItemLineDetail", Amount: amount, Description: `line ${amount}`,
    SalesItemLineDetail: { ItemRef: { value: "1", name: "Svc" }, Qty: 1, UnitPrice: amount, ...(taxCodeId === undefined ? {} : { TaxCodeRef: taxCodeId === null ? undefined : { value: taxCodeId, ...extra } }) }
});
const taxInvoices = () => [
    { Id: "1", DocNumber: "T-1", TxnDate: "2026-02-01", CustomerRef: { value: "9", name: "Cust" }, TxnTaxDetail: { TotalTax: 15, TaxLine: [{ Amount: 15, DetailType: "TaxLineDetail", TaxLineDetail: { TaxRateRef: { value: "3" }, PercentBased: true, TaxPercent: 15, NetAmountTaxable: 100 } }] },
      Line: [taxLine(100, "5"), taxLine(50, "6")] },
    { Id: "2", DocNumber: "T-2", TxnDate: "2026-02-02", CustomerRef: { value: "9", name: "Cust" },
      Line: [taxLine(10, "7"), taxLine(20, "8"), taxLine(30, undefined)] },
    { Id: "3", DocNumber: "T-3", TxnDate: "2026-02-03", CustomerRef: { value: "9", name: "Cust" },
      Line: [taxLine(5, "9"), taxLine(6, "99"), taxLine(7, "5", { name: "Name already in ref" })] }
];
const taxCodeMock = () => ({
    Invoice: () => taxInvoices(), Item: () => [], Account: () => [],
    TaxCode: (q) => (/Active = false/.test(q)
        ? [{ Id: "9", Name: "Old Retired Code", Active: false }]
        : [{ Id: "5", Name: "Standard Rate (mock)" }, { Id: "6", Name: "Zero Rate (mock)" }, { Id: "7", Name: "Exempt (mock)" }, { Id: "8", Name: "Out of Scope" }])
});

test("Invoice tax code: raw -> normalized -> Excel, every treatment resolved from the TaxCode list", async () => {
    reset(taxCodeMock());
    const warnings = []; const ow = logger.warn; logger.warn = (m) => warnings.push(String(m));
    let rows, summary;
    try {
        const dataset = await fetchAllForExport(session, ["invoiceDetail"], undefined, {});
        const norm = dataset.invoiceDetail;
        assert.equal(norm.length, 8, "8 invoice lines, none dropped");
        assert.deepEqual(norm.map((r) => r.taxCodeSource), ["taxcode-list", "taxcode-list", "taxcode-list", "taxcode-list", "absent", "taxcode-list", "unresolved", "ref-name"]);
        assert.deepEqual(norm.map((r) => r.taxAmount), Array(8).fill(0), "tax amounts untouched");
        assert.deepEqual(norm.map((r) => r.amount), [100, 50, 10, 20, 30, 5, 6, 7], "line amounts untouched");

        const { buffer, summary: sm } = await generateCombinedExport("ZA", dataset, ["invoiceDetail"]);
        summary = sm;
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
        const ws = wb.worksheets[0]; const head = ws.getRow(1).values; const col = head.indexOf("Product/Service Tax Code *");
        rows = []; ws.eachRow((row, n) => { if (n > 1) rows.push(row.values[col]); });
    } finally { logger.warn = ow; }

    assert.deepEqual(rows, [
        "Standard Rate (mock)", "Zero Rate (mock)",
        "Exempt (mock)", "Out of Scope", "Out of Scope",          // 3rd = genuinely NO TaxCodeRef -> template default
        "Old Retired Code",                                       // inactive code found by lookup
        "99",                                                     // unresolved: raw id kept, not hidden as Out of Scope
        "Name already in ref"
    ]);
    assert.equal(summary[0].skippedRows, 0);
    assert.ok(warnings.some((w) => /99/.test(w) && /not found/.test(w)), "unresolved id is warned");
    // one active TaxCode query + exactly one inactive lookup
    assert.equal(calls.filter((c) => /from TaxCode/i.test(c.query || "")).length, 2);
});

test("Invoice tax code: no TaxCode queries when every line already carries a name or has no ref", async () => {
    reset({ Invoice: () => [{ Id: "1", DocNumber: "N-1", TxnDate: "2026-01-01", CustomerRef: { value: "1", name: "C" }, Line: [taxLine(1, "5", { name: "Given" }), taxLine(2, undefined)] }], Item: () => [], Account: () => [] });
    const rows = await fetchEntity(session, "invoiceDetail", undefined, { item: [] }, {});
    assert.deepEqual(rows.map((r) => r.taxCodeName), ["Given", ""]);
    assert.equal(calls.filter((c) => /from TaxCode/i.test(c.query || "")).length, 0);
});

test("DEBUG_INVOICE_JSON: complete raw + normalized + mapped invoice JSON, off by default, redacts secrets, filterable", async () => {
    const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(" "));
    const withSecret = taxInvoices(); withSecret[0].access_token = "SECRET-TOKEN-VALUE"; withSecret[0].Line[0].Authorization = "Bearer abc";
    try {
        reset({ ...taxCodeMock(), Invoice: () => withSecret });
        delete process.env.DEBUG_INVOICE_JSON;
        await fetchAllForExport(session, ["invoiceDetail"], undefined, {});
        assert.equal(lines.filter((l) => l.includes("[DEBUG_INVOICE_JSON]")).length, 0, "disabled by default");

        process.env.DEBUG_INVOICE_JSON = "true";
        const dataset = await fetchAllForExport(session, ["invoiceDetail"], undefined, {});
        await generateCombinedExport("ZA", dataset, ["invoiceDetail"]);

        lines.length = 0; process.env.DEBUG_INVOICE_IDS = "T-2";
        await fetchAllForExport(session, ["invoiceDetail"], undefined, {});
    } finally { console.log = orig; delete process.env.DEBUG_INVOICE_JSON; delete process.env.DEBUG_INVOICE_IDS; }

    const filtered = lines.join("\n");
    assert.ok(filtered.includes("invoiceId=2") && !filtered.includes("invoiceId=1 "), "DEBUG_INVOICE_IDS filter works");
});

test("DEBUG_INVOICE_JSON full output content", async () => {
    const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(" "));
    const withSecret = taxInvoices(); withSecret[0].access_token = "SECRET-TOKEN-VALUE"; withSecret[0].Line[0].Authorization = "Bearer abc";
    try {
        reset({ ...taxCodeMock(), Invoice: () => withSecret });
        process.env.DEBUG_INVOICE_JSON = "true";
        const dataset = await fetchAllForExport(session, ["invoiceDetail"], undefined, {});
        await generateCombinedExport("ZA", dataset, ["invoiceDetail"]);
    } finally { console.log = orig; delete process.env.DEBUG_INVOICE_JSON; }
    const text = lines.join("\n");
    assert.ok(text.includes("SENSITIVE"), "sensitive-data warning printed");
    for (const stage of ["raw", "normalized", "mapped"]) assert.ok(text.includes(`stage=${stage} invoiceId=1`), `${stage} printed for invoice 1`);
    assert.ok(text.includes('"TxnTaxDetail"') && text.includes('"TaxPercent": 15') && text.includes('"TaxCodeRef"'), "nested raw tax fields not truncated");
    assert.ok(text.includes('"Product/Service Tax Code *": "Standard Rate (mock)"'), "mapped row printed");
    assert.ok(!text.includes("SECRET-TOKEN-VALUE") && !text.includes("Bearer abc"), "credentials redacted");
    assert.ok(text.includes("***REDACTED***"));
});

test("Invoice tax-code diagnostics show where each exported code comes from (counts/config only)", async () => {
    const { diagnoseInvoiceTaxCodes } = await import(src("services/diagnostics.service.js"));
    reset({
        Invoice: () => [{ Id: "1", DocNumber: "SECRET-DOC", CustomerRef: { value: "1", name: "Secret Customer" }, Line: [
            taxLine(100, "5"), taxLine(100, "5"), taxLine(50, "S"), taxLine(10, "7", { name: "Named" }), taxLine(5, undefined)] }],
        TaxCode: (q) => (/Active = false/.test(q) ? [] : [{ Id: "5", Name: "S", Taxable: true }, { Id: "7", Name: "No VAT", Taxable: false }])
    });
    const d = await diagnoseInvoiceTaxCodes(session, {});
    const by = Object.fromEntries(d.usedTaxCodes.map((u) => [u.refValue, u]));
    assert.deepEqual([d.invoicesScanned, d.invoiceLines, d.linesWithoutTaxCodeRef], [1, 5, 1]);
    assert.deepEqual([by["5"].exportedAs, by["5"].source, by["5"].lines], ["S", "taxcode-list", 2], "name 'S' comes from the TaxCode list (Id 5)");
    assert.equal(by["S"].source, "unresolved", "an id that is itself 'S' and is NOT in the list is flagged, not hidden");
    assert.equal(by["7"].source, "ref-name");
    assert.ok(!JSON.stringify(d).includes("SECRET"), "no customer / doc number in output");
});

// ---------- 13. Invoice tax rules: S + amount>0 -> Standard; amount 0 -> Out of Scope ----------
test("applyInvoiceTaxRules: unit cases (S positive, zero, other code, negative, missing/invalid)", async () => {
    const { applyInvoiceTaxRules, parseLineAmount } = await import(src("services/normalize.service.js"));
    const r = (rawAmount, taxCodeName, taxCodeSource = "taxcode-list") => applyInvoiceTaxRules({ rawAmount, taxCodeName, taxCodeSource });

    assert.equal(r(1000, "S").exportTaxCodeName, "Standard");
    assert.equal(r("1000.50", "S").exportTaxCodeName, "Standard", "numeric string amount");
    assert.equal(r(0.01, " S ").exportTaxCodeName, "Standard", "trimmed code");
    assert.equal(r(1000, "S", "ref-name").exportTaxCodeName, "Standard");

    assert.equal(r(0, "S").exportTaxCodeName, "Out of Scope", "zero amount wins even for S");
    assert.equal(r(0, "No VAT").exportTaxCodeName, "Out of Scope");
    assert.equal(r("0.00", "Zero Rate").exportTaxCodeName, "Out of Scope");
    assert.equal(r(0, "").exportTaxCodeName, "Out of Scope", "zero amount, no tax code");

    assert.equal(r(1000, "No VAT").exportTaxCodeName, "No VAT", "other code keeps existing mapping");
    assert.equal(r(1000, "Zero Rate (mock)").exportTaxCodeName, "Zero Rate (mock)");
    assert.equal(r(1000, "s").exportTaxCodeName, "s", "only the exact code S is Standard");
    assert.equal(r(1000, "SS").exportTaxCodeName, "SS");

    assert.equal(r(-500, "S").exportTaxCodeName, "S", "negative amount is NOT auto Out of Scope and NOT Standard");
    assert.equal(r(-500, "No VAT").exportTaxCodeName, "No VAT");

    for (const bad of [undefined, null, "", "  ", "abc", NaN, Infinity, {}, []]) {
        const out = r(bad, "S");
        assert.equal(out.exportTaxCodeName, "S", `invalid amount ${JSON.stringify(bad)} is not treated as 0 or positive`);
        assert.equal(out.taxRule, "kept-invalid-amount");
    }
    assert.equal(r(1000, "S", "unresolved").exportTaxCodeName, "S", "S must come from a real TaxCode, not a raw unresolved id");
    assert.equal(r(1000, "", "absent").exportTaxCodeName, "", "missing tax code stays blank (mapping default applies)");
    assert.ok(Number.isNaN(parseLineAmount("x")));
});

test("Invoice tax rules end-to-end: raw -> normalized -> ZA Excel, per line, amounts unchanged", async () => {
    const line = (amount, taxId, extra = {}) => ({ DetailType: "SalesItemLineDetail", Amount: amount, Description: `d${amount}`, SalesItemLineDetail: { ItemRef: { value: "1", name: "Svc" }, Qty: 1, UnitPrice: amount, ...(taxId ? { TaxCodeRef: { value: taxId } } : {}), ...extra } });
    reset({
        Invoice: () => [
            { Id: "1", DocNumber: "R-1", TxnDate: "2026-03-01", CustomerRef: { value: "1", name: "C" }, Line: [line(1000, "5"), line(0, "5"), line(250, "7"), line(-100, "5"), line(0, "7")] },
            { Id: "2", DocNumber: "R-2", TxnDate: "2026-03-02", CustomerRef: { value: "1", name: "C" }, Line: [line(300, undefined), line(0, undefined), line("abc", "5"), line(400, "5")] }
        ],
        Item: () => [], Account: () => [],
        TaxCode: () => [{ Id: "5", Name: "S" }, { Id: "7", Name: "No VAT" }]
    });
    const dataset = await fetchAllForExport(session, ["invoiceDetail"], undefined, {});
    const norm = dataset.invoiceDetail;
    assert.deepEqual(norm.map((n) => n.taxCodeName), ["S", "S", "No VAT", "S", "No VAT", "", "", "S", "S"], "normalized SOURCE code is never overwritten");
    assert.deepEqual(norm.map((n) => n.amount), [1000, 0, 250, -100, 0, 300, 0, 0, 400], "amounts exactly as before (non-numeric keeps the old 0 coercion)");
    assert.deepEqual(norm.map((n) => n.taxRule), ["S-positive-standard", "zero-amount", "kept-source", "kept-source", "zero-amount", "kept-source", "zero-amount", "kept-invalid-amount", "S-positive-standard"]);

    const { buffer, summary } = await generateCombinedExport("ZA", dataset, ["invoiceDetail"]);
    assert.equal(summary[0].skippedRows, 0);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0]; const head = ws.getRow(1).values;
    const cTax = head.indexOf("Product/Service Tax Code *"), cAmt = head.indexOf("Product/Service Amount *"), cTaxAmt = head.indexOf("Product/Service Tax Amount *");
    const out = []; ws.eachRow((row, n) => { if (n > 1) out.push([row.values[cAmt], row.values[cTax], row.values[cTaxAmt]]); });
    assert.deepEqual(out, [
        [1000, "Standard", 0],
        [0, "Out of Scope", 0],
        [250, "No VAT", 0],
        [-100, "S", 0],
        [0, "Out of Scope", 0],
        [300, "Out of Scope", 0],      // no TaxCodeRef: template default (unchanged behaviour)
        [0, "Out of Scope", 0],
        [0, "S", 0],                   // invalid amount: source code kept, not classified
        [400, "Standard", 0]
    ]);
});

test("Invoice tax-code diagnostics report amount buckets and resulting export per code", async () => {
    const { diagnoseInvoiceTaxCodes } = await import(src("services/diagnostics.service.js"));
    const mk = (a) => ({ DetailType: "SalesItemLineDetail", Amount: a, SalesItemLineDetail: { TaxCodeRef: { value: "5" } } });
    reset({ Invoice: () => [{ Id: "1", Line: [mk(10), mk(0), mk(-5), mk("x")] }], TaxCode: (q) => (/Active = false/.test(q) ? [] : [{ Id: "5", Name: "S" }]) });
    const d = await diagnoseInvoiceTaxCodes(session, {});
    assert.deepEqual(d.usedTaxCodes[0].linesByAmount, { positive: 1, zero: 1, negative: 1, invalid: 1 });
    assert.deepEqual([d.usedTaxCodes[0].exportedWhenPositive, d.usedTaxCodes[0].exportedWhenZero], ["Standard", "Out of Scope"]);
});

// ---------- 14. Per-line Tax Amount from QBO's own TxnTaxDetail.TaxLine ----------
const tl = (rateId, amount, pct = 15) => ({ Amount: amount, DetailType: "TaxLineDetail", TaxLineDetail: { TaxRateRef: { value: rateId }, PercentBased: true, TaxPercent: pct, NetAmountTaxable: 0 } });
const tline = (amount, taxId) => ({ DetailType: "SalesItemLineDetail", Amount: amount, Description: `d${amount}`, SalesItemLineDetail: { ItemRef: { value: "1", name: "Svc" }, Qty: 1, UnitPrice: amount, ...(taxId ? { TaxCodeRef: { value: taxId } } : {}) } });
const taxAmountMock = (invoices) => ({
    Invoice: () => invoices, Item: () => [], Account: () => [],
    TaxCode: (q) => (/Active = false/.test(q) ? [] : [
        { Id: "5", Name: "S", SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "3" }, TaxTypeApplicable: "TaxOnAmount", TaxOrder: 0 }] } },
        { Id: "6", Name: "Zero Rate (mock)", SalesTaxRateList: { TaxRateDetail: [] } },
        { Id: "7", Name: "No VAT" },
        { Id: "8", Name: "NoRatesListed" }
    ])
});

test("Tax Amount: QBO's rate total is allocated to the lines using that rate; lines add up exactly; others stay 0", async () => {
    reset(taxAmountMock([
        { Id: "1", DocNumber: "A-1", TxnDate: "2026-04-01", CustomerRef: { value: "1", name: "C" }, TxnTaxDetail: { TotalTax: 225, TaxLine: [tl("3", 225)] },
          Line: [tline(1000, "5"), tline(500, "5"), tline(200, "6"), tline(0, "5"), tline(300, "7")] },
        // rounding: 10.00 tax over three equal lines -> 3.33 + 3.33 + 3.34
        { Id: "2", DocNumber: "A-2", TxnDate: "2026-04-02", CustomerRef: { value: "1", name: "C" }, TxnTaxDetail: { TotalTax: 10, TaxLine: [tl("3", 10)] },
          Line: [tline(66.67, "5"), tline(66.67, "5"), tline(66.66, "5")] },
        // no tax on invoice at all
        { Id: "3", DocNumber: "A-3", TxnDate: "2026-04-03", CustomerRef: { value: "1", name: "C" }, Line: [tline(100, "7")] }
    ]));
    const dataset = await fetchAllForExport(session, ["invoiceDetail"], undefined, {});
    const n = dataset.invoiceDetail;
    assert.deepEqual(n.slice(0, 5).map((r) => r.taxAmount), [150, 75, 0, 0, 0], "proportional to line amount; zero-rated / zero-amount / no-VAT lines get 0");
    assert.deepEqual(n.slice(0, 5).map((r) => r.taxAmountSource), ["txn-tax-line", "txn-tax-line", "none", "none", "none"]);
    const inv2 = n.slice(5, 8).map((r) => r.taxAmount);
    assert.equal(Math.round(inv2.reduce((a, b) => a + b, 0) * 100), 1000, "lines sum to QBO's 10.00 exactly");
    assert.deepEqual(n.slice(8).map((r) => r.taxAmount), [0]);

    const { buffer } = await generateCombinedExport("ZA", dataset, ["invoiceDetail"]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0]; const head = ws.getRow(1).values;
    const cTax = head.indexOf("Product/Service Tax Code *"), cAmt = head.indexOf("Product/Service Amount *"), cTA = head.indexOf("Product/Service Tax Amount *"), cNo = head.indexOf("Invoice No *");
    const sums = {}; const first = [];
    ws.eachRow((row, i) => { if (i > 1) { sums[row.values[cNo]] = (sums[row.values[cNo]] || 0) + Math.round(row.values[cTA] * 100); first.push([row.values[cAmt], row.values[cTax], row.values[cTA]]); } });
    assert.deepEqual(first.slice(0, 5), [[1000, "Standard", 150], [500, "Standard", 75], [200, "Zero Rate (mock)", 0], [0, "Out of Scope", 0], [300, "No VAT", 0]]);
    assert.equal(sums["A-1"], 22500, "Excel Tax Amount total == invoice TotalTax");
    assert.equal(sums["A-2"], 1000);
    assert.equal(sums["A-3"], 0);
});

test("Tax Amount: rate that cannot be linked to a line is NOT guessed - lines stay 0 and a warning is logged", async () => {
    reset(taxAmountMock([
        { Id: "9", DocNumber: "U-1", TxnDate: "2026-04-01", CustomerRef: { value: "1", name: "C" }, TxnTaxDetail: { TotalTax: 30, TaxLine: [tl("3", 30, 10)] },
          Line: [tline(200, "8")] },                                     // code 8 lists no rates
        { Id: "10", DocNumber: "U-2", TxnDate: "2026-04-01", CustomerRef: { value: "1", name: "C" }, TxnTaxDetail: { TotalTax: 30, TaxLine: [tl("77", 30, 10)] },
          Line: [tline(200, "5")] }                                      // invoice taxed at rate 77 which code 5 doesn't use
    ]));
    const warnings = []; const ow = logger.warn; logger.warn = (m) => warnings.push(String(m));
    let rows;
    try { rows = await fetchEntity(session, "invoiceDetail", undefined, { item: [] }, {}); } finally { logger.warn = ow; }
    assert.deepEqual(rows.map((r) => r.taxAmount), [0, 0]);
    assert.ok(warnings.filter((w) => /could not be linked/.test(w)).length === 2);
});

test("Invoice tax-code diagnostics show which tax rates can be linked to lines", async () => {
    const { diagnoseInvoiceTaxCodes } = await import(src("services/diagnostics.service.js"));
    reset(taxAmountMock([
        { Id: "1", DocNumber: "SECRET", TxnTaxDetail: { TaxLine: [tl("3", 150), tl("77", 30)] }, Line: [tline(1000, "5")] },
        { Id: "2", TxnTaxDetail: { TaxLine: [tl("3", 15)] }, Line: [tline(100, "5")] }
    ]));
    const d = await diagnoseInvoiceTaxCodes(session, {});
    const by = Object.fromEntries(d.taxRatesOnInvoices.map((r) => [r.rateId, r]));
    assert.deepEqual([by["3"].invoices, by["3"].totalTax, by["3"].canAllocateToLines, by["3"].linkedTaxCodes], [2, 165, true, ["S"]]);
    assert.equal(by["77"].canAllocateToLines, false, "rate used on an invoice but by no TaxCode -> cannot be allocated");
    assert.ok(!JSON.stringify(d).includes("SECRET"));
});

// ---------- 15. Invoice Credit Note (Detailed Transactions) - ZA only ----------
const cm = (id, doc, lines, extra = {}) => ({ Id: id, DocNumber: doc, TxnDate: "2026-05-0" + id, CustomerRef: { value: "1", name: "Cust " + id }, Line: lines, ...extra });
const cmMock = (memos) => ({
    CreditMemo: (q) => memos.filter((m) => {
        const lo = /TxnDate >= '([^']+)'/.exec(q), hi = /TxnDate <= '([^']+)'/.exec(q);
        return (!lo || m.TxnDate >= lo[1]) && (!hi || m.TxnDate <= hi[1]);
    }),
    Item: () => [], Account: () => [], Customer: () => [],
    TaxCode: (q) => (/Active = false/.test(q) ? [] : [
        { Id: "5", Name: "S", SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "3" } }] } },
        { Id: "7", Name: "No VAT" },
        { Id: "8", Name: "NoRatesListed" }
    ])
});

test("Credit note: header order equals the team's field-mapping sheet (Adjustment Note layout)", async () => {
    const ws = new ExcelJS.Workbook(); await ws.xlsx.readFile(path.join(here, "../templates/ZA/CreditMemoDetail.xlsx"));
    assert.deepEqual(ws.worksheets[0].getRow(1).values.slice(1), [
        "Adjustment Note No *", "Customer *", "Adjustment Note Date *", "Global Tax Calculation *", "Service Date", "Product/Service *",
        "Product/Service Description *", "Product/Service Quantity *", "Product/Service Rate *", "Product/Service Amount *",
        "Product/Service Tax Code *", "Product/Service Tax Amount *", "Product/Service Class", "Note to customer", "Memo on statement",
        "SKU", "Terms", "Discount Percent", "Currency Code", "Exchange rate", "Location"]);
});

test("Credit note: blank numbers get the transaction number, duplicates are concatenated, 21-char limit", async () => {
    const L = (a) => ({ DetailType: "SalesItemLineDetail", Amount: a, SalesItemLineDetail: { ItemRef: { value: "1", name: "Svc" }, Qty: 1, TaxCodeRef: { value: "7" } } });
    reset(cmMock([
        cm("1", "", [L(10)]),                       // blank -> "1"
        cm("2", "CN-7", [L(20), L(30)]),            // duplicate number, two lines
        cm("3", "CN-7", [L(40)]),                   // same number, different transaction
        cm("4", "UNIQUE-1", [L(50)]),
        cm("5", "A-VERY-LONG-CREDIT-NOTE-NUMBER-123", [L(60)])
    ]));
    const rows = await fetchEntity(session, "creditMemoDetail", undefined, { item: [] }, {});
    const { flattenForExport } = await import(src("services/flatten.service.js"));
    const nums = flattenForExport("creditMemoDetail", rows).map((r) => r.docNumber);
    assert.deepEqual(nums, ["1", "CN-7-2", "CN-7-2", "CN-7-3", "UNIQUE-1", "A-VERY-LONG-CREDIT-NOTE-NUMBER-123".slice(0, 21)], "both duplicates get their own txn id; lines of one credit note share one number");
    assert.ok(nums.every((n) => n.length <= 21));
});

test("Credit note: VAT amount present -> Standard, VAT zero -> Out of Scope (per line); raw -> normalized -> Excel", async () => {
    const L = (a, tax) => ({ DetailType: "SalesItemLineDetail", Amount: a, Description: "d" + a, SalesItemLineDetail: { ItemRef: { value: "1", name: "Svc" }, Qty: -2, TaxCodeRef: { value: tax } } });
    reset(cmMock([
        cm("1", "CN-1", [L(1000, "5"), L(500, "5"), L(300, "7"), L(0, "5")], { TxnTaxDetail: { TotalTax: 225, TaxLine: [tl("3", 225)] } }),
        cm("2", "CN-2", [L(100, "7")]),                                                           // no VAT at all
        cm("3", "CN-3", [L(200, "8")], { TxnTaxDetail: { TotalTax: 30, TaxLine: [tl("3", 30, 10)] } })  // VAT exists but cannot be linked to a line
    ]));
    const warnings = []; const ow = logger.warn; logger.warn = (m) => warnings.push(String(m));
    let out, summary;
    try {
        const dataset = await fetchAllForExport(session, ["creditMemoDetail"], undefined, {});
        const n = dataset.creditMemoDetail;
        assert.deepEqual(n.map((r) => r.taxAmount), [150, 75, 0, 0, 0, 0]);
        assert.deepEqual(n.map((r) => r.taxRule), ["vat-present-standard", "vat-present-standard", "vat-zero-out-of-scope", "vat-zero-out-of-scope", "vat-zero-out-of-scope", "kept-tax-unlinked"]);
        assert.deepEqual(n.map((r) => r.taxCodeName), ["S", "S", "No VAT", "S", "No VAT", "NoRatesListed"], "source tax code never overwritten");
        assert.deepEqual(n.map((r) => r.quantity), [2, 2, 2, 2, 2, 2], "negative qty made positive");

        const res = await generateCombinedExport("ZA", dataset, ["creditMemoDetail"]);
        summary = res.summary;
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
        const ws = wb.getWorksheet("Credit Note"); const head = ws.getRow(1).values;
        const c = (h) => head.indexOf(h);
        out = []; ws.eachRow((row, i) => { if (i > 1) out.push([row.values[c("Adjustment Note No *")], row.values[c("Product/Service Amount *")], row.values[c("Product/Service Tax Code *")], row.values[c("Product/Service Tax Amount *")], row.values[c("Global Tax Calculation *")], row.values[c("Product/Service Quantity *")], row.values[c("Product/Service Rate *")]]); });
    } finally { logger.warn = ow; }
    assert.equal(summary[0].skippedRows, 0);
    assert.deepEqual(out, [
        ["CN-1", 1000, "Standard", 150, "TaxExcluded", 2, 500],
        ["CN-1", 500, "Standard", 75, "TaxExcluded", 2, 250],
        ["CN-1", 300, "Out of Scope", 0, "TaxExcluded", 2, 150],
        ["CN-1", 0, "Out of Scope", 0, "TaxExcluded", 2, 0],
        ["CN-2", 100, "Out of Scope", 0, "TaxExcluded", 2, 50],
        ["CN-3", 200, "NoRatesListed", 0, "TaxExcluded", 2, 100]
    ]);
    assert.ok(warnings.some((w) => /Credit note CN-3/.test(w) && /could not be linked/.test(w)));
});

test("Credit note: ZA only, date range applies, module is hidden for other regions", async () => {
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    const keys = (r) => listAvailableTemplates(r).map((t) => t.key ?? t);
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("creditMemoDetail"));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("creditMemoDetail"), `${r} must not offer it`);

    const L = { DetailType: "SalesItemLineDetail", Amount: 5, SalesItemLineDetail: { ItemRef: { value: "1", name: "S" }, Qty: 1 } };
    reset(cmMock([cm("1", "A", [L]), cm("2", "B", [L]), cm("3", "C", [L])]));
    const feb = await fetchEntity(session, "creditMemoDetail", undefined, { item: [] }, { creditMemoDetail: { startDate: "2026-05-02", endDate: "2026-05-02" } });
    assert.deepEqual(feb.map((r) => r.docNumber), ["B"]);
    assert.match(calls.find((c) => /from CreditMemo where/i.test(c.query || "")).query, /TxnDate >= '2026-05-02' and TxnDate <= '2026-05-02'/);
    const { parseDateRanges } = await import(src("utils/dateRange.js"));
    assert.deepEqual(parseDateRanges({ creditMemoDetail: { startDate: "2026-01-01", endDate: "" } }), { creditMemoDetail: { startDate: "2026-01-01", endDate: null } });
});

test("Credit note: TotalTax present but NO TaxLine[] -> NOT 'Out of Scope' (source code kept, warned)", async () => {
    const L = (a) => ({ DetailType: "SalesItemLineDetail", Amount: a, SalesItemLineDetail: { ItemRef: { value: "1", name: "Svc" }, Qty: 1, TaxCodeRef: { value: "5" } } });
    reset(cmMock([cm("1", "NT-1", [L(100)], { TxnTaxDetail: { TotalTax: 15 } }), cm("2", "NT-2", [L(100)], { TxnTaxDetail: { TotalTax: 0 } })]));
    const warnings = []; const ow = logger.warn; logger.warn = (m) => warnings.push(String(m));
    let rows; try { rows = await fetchEntity(session, "creditMemoDetail", undefined, { item: [] }, {}); } finally { logger.warn = ow; }
    assert.deepEqual(rows.map((r) => [r.exportTaxCodeName, r.taxRule]), [["S", "kept-tax-unlinked"], ["Out of Scope", "vat-zero-out-of-scope"]]);
    assert.ok(warnings.some((w) => /NT-1/.test(w) && /could not be linked/.test(w)));
});

test("Diagnostics can analyse CreditMemo and report documents with TotalTax but no TaxLines", async () => {
    const { diagnoseInvoiceTaxCodes } = await import(src("services/diagnostics.service.js"));
    reset({ CreditMemo: () => [{ Id: "1", TxnTaxDetail: { TotalTax: 15 }, Line: [] }, { Id: "2", Line: [] }, { Id: "3", TxnTaxDetail: { TotalTax: 5, TaxLine: [tl("3", 5)] }, Line: [] }], TaxCode: () => [] });
    const d = await diagnoseInvoiceTaxCodes(session, { entity: "CreditMemo" });
    assert.equal(d.entity, "CreditMemo");
    assert.deepEqual(d.taxDetail, { documentsWithTotalTax: 2, documentsWithTotalTaxButNoTaxLines: 1, documentsWithoutAnyTxnTaxDetail: 1 });
});

// ---------- 16. Invoice Payment module (ZA) ----------
const payLine = (amount, ...links) => ({ Amount: amount, LinkedTxn: links.map(([id, type = "Invoice"]) => ({ TxnId: id, TxnType: type })) });
const payMock = (payments) => ({
    Payment: (q) => payments.filter((p) => {
        const lo = /TxnDate >= '([^']+)'/.exec(q), hi = /TxnDate <= '([^']+)'/.exec(q);
        return (!lo || p.TxnDate >= lo[1]) && (!hi || p.TxnDate <= hi[1]);
    }),
    Invoice: () => [{ Id: "11", DocNumber: "INV-1" }, { Id: "12", DocNumber: "" }, { Id: "13", DocNumber: "DUP" }, { Id: "14", DocNumber: "DUP" }, { Id: "15", DocNumber: "A-VERY-LONG-INVOICE-NUMBER-0001" }],
    PaymentMethod: () => [{ Id: "3", Name: "EFT" }],
    Customer: () => [], Term: () => [],
    Account: () => [
        { Id: "100", Name: "Current", FullyQualifiedName: "Bank:Current", AccountType: "Bank", AccountSubType: "Checking" },
        { Id: "101", Name: "Undeposited Funds", FullyQualifiedName: "Undeposited Funds", AccountType: "Other Current Asset", AccountSubType: "UndepositedFunds" }
    ]
});
const payments = () => [
    { Id: "1", PaymentRefNum: "R-1", TxnDate: "2026-06-01", CustomerRef: { value: "1", name: "Cust A" }, PaymentMethodRef: { value: "3" }, DepositToAccountRef: { value: "100" }, PrivateNote: "memo 1", TotalAmt: 150,
      Line: [payLine(100, ["11"]), payLine(50, ["12"])] },
    { Id: "2", TxnDate: "2026-06-02", CustomerRef: { value: "1", name: "Cust A" }, PaymentMethodRef: { value: "3" }, TotalAmt: 25, CurrencyRef: { value: "USD" }, ExchangeRate: 18.5,
      Line: [payLine(25, ["13"])] },                                         // no ref no, no deposit account
    { Id: "3", PaymentRefNum: "R-1", TxnDate: "2026-06-03", CustomerRef: { value: "2", name: "Cust B" }, PaymentMethodRef: { value: "3" }, DepositToAccountRef: { value: "100" }, TotalAmt: 90,
      Line: [payLine(10, ["14"]), payLine(20, ["15"]), payLine(30, ["99"]), payLine(15, ["11"], ["12"]), payLine(15, ["777", "CreditMemo"])] }
];

test("Invoice Payment: template header order equals the team's sheet (QBo New)", async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(here, "../templates/ZA/InvoicePayment.xlsx"));
    assert.deepEqual(wb.worksheets[0].getRow(1).values.slice(1), ["Ref No *", "Customer *", "Payment Date *", "Payment method *", "Memo", "Deposit To Account Name *", "Invoice No *", "Amount *", "Currency Code", "Exchange Rate", "Journal No", "Transaction Type", "Cheque Number"]);
});

test("Invoice Payment: raw -> normalized -> Excel (Ref No fill/concatenate, deposit account, invoice no, skipped lines)", async () => {
    reset(payMock(payments()));
    const warnings = []; const ow = logger.warn; logger.warn = (m) => warnings.push(String(m));
    let dataset, out, summary;
    try {
        dataset = await fetchAllForExport(session, ["invoicePayment"], undefined, {});
        const res = await generateCombinedExport("ZA", dataset, ["invoicePayment"]);
        summary = res.summary;
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
        const ws = wb.getWorksheet("Invoice Payment"); const head = ws.getRow(1).values; const c = (h) => head.indexOf(h);
        out = []; ws.eachRow((row, i) => { if (i > 1) out.push(["Ref No *", "Customer *", "Payment Date *", "Payment method *", "Memo", "Deposit To Account Name *", "Invoice No *", "Amount *", "Currency Code", "Exchange Rate", "Journal No", "Transaction Type", "Cheque Number"].map((h) => row.values[c(h)] ?? "")); });
    } finally { logger.warn = ow; }

    const n = dataset.invoicePayment;
    assert.equal(n.length, 6, "6 invoice links exported; credit-memo line and the 2-link line are skipped");
    assert.deepEqual(n.map((r) => r.depositSource), ["account-list", "account-list", "undeposited-funds-default", "account-list", "account-list", "account-list"]);
    assert.deepEqual(n.map((r) => r.invoiceNumberSource), ["invoice-list", "invoice-list", "invoice-list", "invoice-list", "invoice-list", "unresolved"]);
    assert.equal(summary[0].skippedRows, 0);

    assert.deepEqual(out, [
        ["R-1-1", "Cust A", "01/06/2026", "EFT", "memo 1", "Bank:Current", "INV-1", 100, "ZAR", 1, "", "Invoice", ""],
        ["R-1-1", "Cust A", "01/06/2026", "EFT", "memo 1", "Bank:Current", "12", 50, "ZAR", 1, "", "Invoice", ""],                         // same payment keeps ONE Ref No; blank invoice number -> invoice id
        ["2", "Cust A", "02/06/2026", "EFT", "", "Undeposited Funds", "DUP-13", 25, "USD", 18.5, "", "Invoice", ""],                            // blank Ref No -> transaction number; QBO default account
        ["R-1-3", "Cust B", "03/06/2026", "EFT", "", "Bank:Current", "DUP-14", 10, "ZAR", 1, "", "Invoice", ""],                               // duplicate Ref No -> concatenated with its own transaction number
        ["R-1-3", "Cust B", "03/06/2026", "EFT", "", "Bank:Current", "A-VERY-LONG-INVOICE-"  , 20, "ZAR", 1, "", "Invoice", ""],               // 21-char limit identical to the Invoice sheet
        ["R-1-3", "Cust B", "03/06/2026", "EFT", "", "Bank:Current", "99", 30, "ZAR", 1, "", "Invoice", ""]                                    // invoice not in list: id kept + flagged
    ].map((r) => (r[6] === "A-VERY-LONG-INVOICE-" ? [...r.slice(0, 6), "A-VERY-LONG-INVOICE-NUMBER-0001".slice(0, 21), ...r.slice(7)] : r)));
    assert.ok(warnings.some((w) => /Payment 3/.test(w) && /multiple-linked-txn/.test(w)));
    assert.ok(warnings.some((w) => /Payment 3/.test(w) && /non-invoice-link: CreditMemo/.test(w)));
});

test("Invoice Payment: payment made through a payment JOURNAL -> Journal No (as the Journal sheet) + Transaction Type; credit-memo link beside an invoice no longer drops the line", async () => {
    const jl = (amount, id, type) => ({ Amount: amount, LinkedTxn: [{ TxnId: id, TxnType: type }] });
    const pays = [{ Id: "20", PaymentRefNum: "PJ-1", TxnDate: "2026-06-10", CustomerRef: { value: "1", name: "Cust A" }, PaymentMethodRef: { value: "3" }, DepositToAccountRef: { value: "100" },
        Line: [jl(60, "11", "Invoice"), jl(40, "900", "JournalEntry"), { Amount: 25, LinkedTxn: [{ TxnId: "13", TxnType: "Invoice" }, { TxnId: "777", TxnType: "CreditMemo" }] }] }];
    reset({ ...payMock(pays), JournalEntry: () => [{ Id: "900", DocNumber: "JNL-9" }] });
    const dataset = await fetchAllForExport(session, ["invoicePayment"], undefined, {});
    const res = await generateCombinedExport("ZA", dataset, ["invoicePayment"]);
    assert.equal(res.summary[0].skippedRows, 0);
    const out = await readSheet(res, "Invoice Payment", ["Ref No *", "Invoice No *", "Amount *", "Journal No", "Transaction Type"]);
    assert.deepEqual(out, [["PJ-1", "INV-1", 60, "", "Invoice"], ["PJ-1", "", 40, "JNL-9", "JournalEntry"], ["PJ-1", "DUP-13", 25, "", "Invoice"]]);
});

test("Invoice Payment: Invoice No equals the number the Invoice (Detailed) sheet exports", async () => {
    const { flattenForExport } = await import(src("services/flatten.service.js"));
    const L = { DetailType: "SalesItemLineDetail", Amount: 1, SalesItemLineDetail: { ItemRef: { value: "1", name: "S" }, Qty: 1 } };
    const inv = [{ Id: "11", DocNumber: "INV-1" }, { Id: "12", DocNumber: "" }, { Id: "13", DocNumber: "DUP" }, { Id: "14", DocNumber: "DUP" }].map((i) => ({ ...i, TxnDate: "2026-01-01", CustomerRef: { value: "1", name: "C" }, Line: [L] }));
    reset({ ...payMock(payments()), Invoice: (q) => (/select Id, DocNumber/.test(q) ? inv.map(({ Id, DocNumber }) => ({ Id, DocNumber })) : inv), Item: () => [] });
    const invoiceSheet = flattenForExport("invoiceDetail", await fetchEntity(session, "invoiceDetail", undefined, { item: [] }, {}));
    const byId = Object.fromEntries(invoiceSheet.map((r) => [r.txnId, r.docNumber]));
    const pays = await fetchEntity(session, "invoicePayment", undefined, { account: undefined }, {});
    for (const row of pays.filter((r) => r.invoiceNumberSource === "invoice-list")) assert.equal(row.invoiceNumber, byId[row.invoiceId], `invoice ${row.invoiceId}`);
});

test("Invoice Payment: date range filter, ZA only", async () => {
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("invoicePayment"));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("invoicePayment"), r);
    reset(payMock(payments()));
    const rows = await fetchEntity(session, "invoicePayment", undefined, {}, { invoicePayment: { startDate: "2026-06-02", endDate: "2026-06-02" } });
    assert.deepEqual([...new Set(rows.map((r) => r.txnId))], ["2"]);
    assert.match(calls.find((c) => /from Payment where/i.test(c.query || "")).query, /TxnDate >= '2026-06-02' and TxnDate <= '2026-06-02'/);
    const { parseDateRanges } = await import(src("utils/dateRange.js"));
    assert.deepEqual(parseDateRanges({ invoicePayment: { startDate: "2026-01-01" } }), { invoicePayment: { startDate: "2026-01-01", endDate: null } });
});

test("Invoice Payment: Payment method is optional - a payment with NO method stays valid with a blank cell (no method is invented)", async () => {
    reset(payMock([{ Id: "5", PaymentRefNum: "NM-1", TxnDate: "2026-06-05", CustomerRef: { value: "1", name: "C" }, DepositToAccountRef: { value: "100" }, Line: [payLine(10, ["11"])] }]));
    const rows = await fetchEntity(session, "invoicePayment", undefined, {}, {});
    const report = buildEntityReport("invoicePayment", rows, "ZA");
    assert.equal(report.total, 1);
    assert.equal(report.invalidCount, 0);
    assert.ok(report.rows.every((r) => !(r.issues || []).some((i) => i.field === "Payment method *")));
    assert.equal(rows[0].paymentMethodName, "");
});

// ---------- 17. Journal Entry module (ZA) ----------
const jl = (id, posting, amount, acct, extra = {}, detail = {}) => ({
    Id: id, Amount: amount, DetailType: "JournalEntryLineDetail", Description: extra.desc,
    JournalEntryLineDetail: { PostingType: posting, AccountRef: acct, ...detail }
});
const journals = () => [
    { Id: "1", DocNumber: "J-1", TxnDate: "2026-06-01", PrivateNote: "memo 1", Line: [
        jl("0", "Debit", 100, { value: "100", name: "Current" }, { desc: "line d" }, { Entity: { Type: "Customer", EntityRef: { value: "9", name: "Cust A" } }, ClassRef: { value: "7" }, TaxCodeRef: { value: "5" } }),
        jl("1", "Credit", 100, { value: "200", name: "Litigation" }, { desc: "line c" })
    ] },
    { Id: "2", TxnDate: "2026-06-02", CurrencyRef: { value: "USD" }, ExchangeRate: 18.5, Line: [
        jl("0", "Debit", 10.005, { value: "100" }), jl("1", "Credit", 10.005, { value: "200" }),
        { Id: "2", DetailType: "DescriptionOnly", Amount: 0 }
    ] },
    { Id: "3", DocNumber: "J-1", TxnDate: "2026-06-03", ExchangeRate: 1, Line: [
        jl("0", "Debit", 5, { value: "300", name: "Old Inactive" }), jl("1", "Credit", 5, { value: "999" }), jl("2", "Weird", 1, { value: "100" })
    ] }
];
const jMock = (list) => ({
    JournalEntry: (q) => list.filter((j) => {
        const lo = /TxnDate >= '([^']+)'/.exec(q), hi = /TxnDate <= '([^']+)'/.exec(q);
        return (!lo || j.TxnDate >= lo[1]) && (!hi || j.TxnDate <= hi[1]);
    }),
    Account: (q) => /Active = false/.test(q)
        ? [{ Id: "300", Name: "Old Inactive", FullyQualifiedName: "Old:Inactive", AccountType: "Expense" }]
        : [{ Id: "100", Name: "Current", FullyQualifiedName: "Bank:Current", AccountType: "Bank" }, { Id: "200", Name: "Litigation", FullyQualifiedName: "Fee Income:Litigation", AccountType: "Income" }],
    Class: () => [{ Id: "7", Name: "East", FullyQualifiedName: "Region:East" }],
    TaxCode: () => [{ Id: "5", Name: "S", Taxable: true }],
    Customer: () => [], Term: () => []
});
const JHEAD = ["Journal No *", "Journal Date *", "Memo", "Account *", "Amount *", "Description", "Name", "Tax Code", "Class", "Currency Code", "Exchange Rate"];

test("Journal: template header order equals the team's sheet (QBo New)", async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(here, "../templates/ZA/Journal.xlsx"));
    assert.equal(wb.worksheets[0].name, "Journal");
    assert.deepEqual(wb.worksheets[0].getRow(1).values.slice(1), JHEAD);
});

test("Journal: raw -> normalized -> Excel (Amount = debit - credit, full account/class names, number fill + concatenate)", async () => {
    reset(jMock(journals()));
    const warnings = []; const ow = logger.warn; logger.warn = (m) => warnings.push(String(m));
    let dataset, out, summary;
    try {
        dataset = await fetchAllForExport(session, ["journal"], undefined, {});
        const res = await generateCombinedExport("ZA", dataset, ["journal"]);
        summary = res.summary;
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
        const ws = wb.getWorksheet("Journal"); const head = ws.getRow(1).values;
        out = []; ws.eachRow((row, i) => { if (i > 1) out.push(JHEAD.map((h) => row.values[head.indexOf(h)] ?? "")); });
    } finally { logger.warn = ow; }

    assert.equal(dataset.journal.length, 6, "description-only line and the invalid posting type are skipped");
    assert.equal(summary[0].skippedRows, 1, "only the line whose account cannot be resolved is skipped");
    assert.deepEqual(out, [
        ["1_J-1", "01/06/2026", "memo 1", "Bank:Current", 100, "line d", "Cust A", "S", "Region:East", "", ""],
        ["1_J-1", "01/06/2026", "memo 1", "Fee Income:Litigation", -100, "line c", "", "", "", "", ""],
        ["2", "02/06/2026", "", "Bank:Current", 10.01, "", "", "", "", "USD", 18.5],            // blank number -> transaction number
        ["2", "02/06/2026", "", "Fee Income:Litigation", -10.01, "", "", "", "", "USD", 18.5],
        ["3_J-1", "03/06/2026", "", "Old:Inactive", 5, "", "", "", "", "", ""],               // duplicate number -> concatenated; inactive account resolved
        ["3_J-1", "03/06/2026", "", "", -5, "", "", "", "", "", ""]                            // unresolved account id -> left blank (flagged invalid below)
    ].filter((r) => r[3] !== ""));   // the unresolved-account row is invalid (Account is mandatory) and is not written
    assert.ok(warnings.some((w) => /JournalEntry 3/.test(w) && /invalid-line/.test(w)));
});

test("Journal No: duplicates -> <transaction id>_<reference> (transaction id first, never trimmed), blank -> transaction id, 21-char limit cuts the reference only", async () => {
    const mk = (id, num) => ({ Id: id, DocNumber: num, TxnDate: "2026-06-01", Line: [jl("0", "Debit", 10, { value: "100", name: "Current" }), jl("1", "Credit", 10, { value: "200", name: "Litigation" })] });
    reset(jMock([mk("1573", "253472"), mk("1600", "253472"), mk("1700", ""), mk("1800", "UNIQUE-1"), mk("123456", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"), mk("123457", "ABCDEFGHIJKLMNOPQRSTUVWXYZ")]));
    const { flattenForExport } = await import(src("services/flatten.service.js"));
    const rows = flattenForExport("journal", await fetchEntity(session, "journal", undefined, {}, {}));
    const nums = [...new Map(rows.map((r) => [r.txnId, r.docNumber])).entries()];
    assert.deepEqual(nums, [["1573", "1573_253472"], ["1600", "1600_253472"], ["1700", "1700"], ["1800", "UNIQUE-1"], ["123456", "123456_ABCDEFGHIJKLMN"], ["123457", "123457_ABCDEFGHIJKLMN"]]);
    assert.ok(nums.every(([, n]) => n.length <= 21));
});

test("Journal: balanced entries sum to zero and an account with no name is reported invalid (nothing invented)", async () => {
    reset(jMock(journals()));
    const rows = await fetchEntity(session, "journal", undefined, {}, {});
    const sum = (id) => Math.round(rows.filter((r) => r.txnId === id).reduce((a, r) => a + r.amount, 0) * 100) / 100;
    assert.equal(sum("1"), 0); assert.equal(sum("2"), 0);
    const report = buildEntityReport("journal", rows, "ZA");
    assert.equal(report.invalidCount, 1);
    assert.ok(report.rows.find((r) => r.issues?.length).issues.some((i) => i.field === "Account *" && i.type === "missing_required"));
});

test("Journal: date range filter, ZA only", async () => {
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("journal"));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"journal\""), r);
    reset(jMock(journals()));
    const rows = await fetchEntity(session, "journal", undefined, {}, { journal: { startDate: "2026-06-02", endDate: "2026-06-02" } });
    assert.deepEqual([...new Set(rows.map((r) => r.txnId))], ["2"]);
    assert.match(calls.find((c) => /from JournalEntry where/i.test(c.query || "")).query, /TxnDate >= '2026-06-02' and TxnDate <= '2026-06-02'/);
});

test("Transaction numbers: case/space duplicates and post-truncation collisions never leave two transactions with the same number", async () => {
    const { flattenForExport } = await import(src("services/flatten.service.js"));
    const mk = (id, doc) => ({ txnId: id, docNumber: doc });
    const rows = flattenForExport("invoiceDetail", [mk("1", "inv-1"), mk("2", "INV-1 "), mk("3", ""), mk("4", "ABCDEFGHIJKLMNOPQRSTUVWXY-1"), mk("5", "ABCDEFGHIJKLMNOPQRSTUVWXY-2"), mk("6", "7"), mk("7", "7-3"), mk("3", "")]);
    const byId = Object.fromEntries(rows.map((r) => [r.txnId, r.docNumber]));
    const nums = Object.values(byId).map((n) => n.toLowerCase());
    assert.equal(new Set(nums).size, nums.length, JSON.stringify(byId));
    assert.ok(Object.values(byId).every((n) => n.length <= 21));
    assert.equal(byId["1"], "inv-1-1"); assert.equal(byId["2"], "INV-1-2"); assert.equal(byId["3"], "3");
    assert.equal(byId["4"], "ABCDEFGHIJKLMNOPQRSTU"); assert.ok(byId["5"].endsWith("-5") && byId["5"].length <= 21);
});

// ---------- 18. Overpayment module (ZA) ----------
const opList = () => [
    { Id: "1", PaymentRefNum: "OP-1", TxnDate: "2026-06-01", CustomerRef: { value: "1", name: "Cust A" }, PaymentMethodRef: { value: "3" }, DepositToAccountRef: { value: "100" }, TotalAmt: 500, UnappliedAmt: 500, Line: [] },
    { Id: "2", TxnDate: "2026-06-02", CustomerRef: { value: "1", name: "Cust A" }, PaymentMethodRef: { value: "3" }, TotalAmt: 100, UnappliedAmt: 40.5, Line: [payLine(59.5, ["11"])] },
    { Id: "3", PaymentRefNum: "OP-1", TxnDate: "2026-06-03", CustomerRef: { value: "2", name: "Cust B" }, PaymentMethodRef: { value: "3" }, DepositToAccountRef: { value: "100" }, TotalAmt: 80, UnappliedAmt: 80, Line: [] },
    { Id: "4", PaymentRefNum: "FULL", TxnDate: "2026-06-03", CustomerRef: { value: "2", name: "Cust B" }, PaymentMethodRef: { value: "3" }, TotalAmt: 50, UnappliedAmt: 0, Line: [payLine(50, ["11"])] },
    { Id: "5", PaymentRefNum: "NOM", TxnDate: "2026-06-04", CustomerRef: { value: "2", name: "Cust B" }, TotalAmt: 20, UnappliedAmt: 20, Line: [] }
];
const OHEAD = ["Ref No *", "Customer *", "Payment Date *", "Payment method *", "Memo", "Deposit To Account Name *", "Amount *", "Currency Code", "Exchange Rate"];

test("Overpayment: template headers, raw -> normalized -> Excel (unapplied amount only, Ref No fill/concatenate)", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/Overpayment.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), OHEAD);

    reset(payMock(opList()));
    const dataset = await fetchAllForExport(session, ["overpayment"], undefined, {});
    assert.deepEqual(dataset.overpayment.map((r) => [r.txnId, r.amount, r.partiallyApplied]), [["1", 500, false], ["2", 40.5, true], ["3", 80, false], ["5", 20, false]], "fully applied payment (4) is not an overpayment");
    const res = await generateCombinedExport("ZA", dataset, ["overpayment"]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet("Overpayment"); const head = ws.getRow(1).values; const out = [];
    ws.eachRow((row, i) => { if (i > 1) out.push(OHEAD.map((h) => row.values[head.indexOf(h)] ?? "")); });
    assert.deepEqual(out, [
        ["OP-1-1", "Cust A", "01/06/2026", "EFT", "", "Bank:Current", 500, "ZAR", 1],
        ["2", "Cust A", "02/06/2026", "EFT", "", "Undeposited Funds", 40.5, "ZAR", 1],
        ["OP-1-3", "Cust B", "03/06/2026", "EFT", "", "Bank:Current", 80, "ZAR", 1],
        ["NOM", "Cust B", "04/06/2026", "", "", "Undeposited Funds", 20, "ZAR", 1]
    ]);
    assert.equal(res.summary[0].skippedRows, 0, "payment 5 has no payment method -> still exported with a blank Payment method (optional), nothing invented");
});

test("Overpayment: Conversion Period date range, ZA only", async () => {
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("overpayment"));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("overpayment"), r);
    reset(payMock(opList()));
    const rows = await fetchEntity(session, "overpayment", undefined, {}, { overpayment: { startDate: "2026-06-03", endDate: "2026-06-03" } });
    assert.deepEqual(rows.map((r) => r.txnId), ["3"]);
    assert.match(calls.find((c) => /from Payment where/i.test(c.query || "")).query, /TxnDate >= '2026-06-03' and TxnDate <= '2026-06-03'/);
});

// ---------- 19. Expense module (ZA) ----------
const el = (id, amount, acct, taxId, extra = {}) => ({ Id: id, Amount: amount, Description: `d${id}`, DetailType: "AccountBasedExpenseLineDetail",
    AccountBasedExpenseLineDetail: { AccountRef: { value: acct }, ...(taxId ? { TaxCodeRef: { value: taxId } } : {}), ...extra } });
const purchases = () => [
    { Id: "1", DocNumber: "E-1", PaymentType: "Cash", TxnDate: "2026-06-01", AccountRef: { value: "100" }, EntityRef: { name: "Shop A", value: "5" }, PrivateNote: "m1",
      TxnTaxDetail: { TotalTax: 15, TaxLine: [tl("9", 15)] }, Line: [el("1", 100, "200", "5", { ClassRef: { value: "7" }, CustomerRef: { name: "Cust A", value: "1" } }), el("2", 50, "200", "6")] },
    { Id: "2", PaymentType: "Cash", TxnDate: "2026-06-02", AccountRef: { value: "100" }, PaymentMethodRef: { value: "3" }, CurrencyRef: { value: "USD" }, ExchangeRate: 18.5,
      Line: [el("1", 70, "200", "6"), { Id: "2", Amount: 9, DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: { ItemRef: { value: "1" } } }] },
    { Id: "3", DocNumber: "E-1", PaymentType: "Cash", TxnDate: "2026-06-03", AccountRef: { value: "100" }, Line: [el("1", 30, "200")] }
];
const eMock = (list) => ({
    ...jMock([]),
    Purchase: (q) => list.filter((p) => { const lo = /TxnDate >= '([^']+)'/.exec(q), hi = /TxnDate <= '([^']+)'/.exec(q); return (!lo || p.TxnDate >= lo[1]) && (!hi || p.TxnDate <= hi[1]); }),
    TaxCode: () => [{ Id: "5", Name: "S", PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "9" } }] } }, { Id: "6", Name: "Z", PurchaseTaxRateList: { TaxRateDetail: [] } }],
    PaymentMethod: () => [{ Id: "3", Name: "Cheque" }]
});
const EHEAD = ["Ref No *", "Account *", "Payee", "Payment Date *", "Memo", "Global Tax Calculation *", "Expense Account *", "Expense Description", "Expense Line Amount *", "Expense Tax Code *", "Expense Account Tax Amount *", "Expense Class", "Currency Code", "Exchange Rate", "Payment Method", "Expense Customer"];

test("Expense: template headers, raw -> Excel (tax rule Standard/Out of Scope, tax amount, full names, ref no, item lines skipped)", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/Expense.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), EHEAD);
    reset(eMock(purchases()));
    const warnings = []; const ow = logger.warn; logger.warn = (m) => warnings.push(String(m));
    let dataset, out;
    try {
        dataset = await fetchAllForExport(session, ["expense"], undefined, {});
        const res = await generateCombinedExport("ZA", dataset, ["expense"]);
        assert.equal(res.summary[0].skippedRows, 0);
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
        const ws = wb.getWorksheet("Expense"); const head = ws.getRow(1).values; out = [];
        ws.eachRow((row, i) => { if (i > 1) out.push(EHEAD.map((h) => row.values[head.indexOf(h)] ?? "")); });
    } finally { logger.warn = ow; }
    assert.deepEqual(dataset.expense.map((r) => r.expenseType), ["Cash", "Cash", "Cash", "Cash"]);
    assert.deepEqual(out, [
        ["E-1-1", "Bank:Current", "Shop A", "01/06/2026", "m1", "TaxExcluded", "Fee Income:Litigation", "d1", 100, "Standard", 15, "Region:East", "", "", "", "Cust A"],
        ["E-1-1", "Bank:Current", "Shop A", "01/06/2026", "m1", "TaxExcluded", "Fee Income:Litigation", "d2", 50, "Out of Scope", 0, "", "", "", "", ""],
        ["2", "Bank:Current", "", "02/06/2026", "", "TaxExcluded", "Fee Income:Litigation", "d1", 70, "Out of Scope", 0, "", "USD", 18.5, "Cheque", ""],
        ["E-1-3", "Bank:Current", "", "03/06/2026", "", "TaxExcluded", "Fee Income:Litigation", "d1", 30, "Out of Scope", 0, "", "", "", "", ""]
    ]);
    assert.ok(warnings.some((w) => /Purchase 2/.test(w) && /item-based-line/.test(w)));
});

test("Expense: VAT present but not linkable keeps the source tax code (never 'Out of Scope'); date range; ZA only", async () => {
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("\"expense\""));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"expense\""), r);
    reset(eMock([{ Id: "9", DocNumber: "NT", PaymentType: "Cash", TxnDate: "2026-06-05", AccountRef: { value: "100" }, TxnTaxDetail: { TotalTax: 15 }, Line: [el("1", 100, "200", "5")] }, ...purchases()]));
    const all = await fetchEntity(session, "expense", undefined, { account: undefined }, {});
    assert.deepEqual([all[0].exportTaxCodeName, all[0].taxRule], ["S", "kept-tax-unlinked"]);
    const rows = await fetchEntity(session, "expense", undefined, {}, { expense: { startDate: "2026-06-02", endDate: "2026-06-02" } });
    assert.deepEqual([...new Set(rows.map((r) => r.txnId))], ["2"]);
    assert.match(calls.find((c) => /from Purchase where/i.test(c.query || "")).query, /TxnDate >= '2026-06-02' and TxnDate <= '2026-06-02'/);
});

// ---------- 20. Transfer module (ZA) ----------
const transfers = () => [
    { Id: "1", TxnDate: "2026-06-01", Amount: 1500.5, FromAccountRef: { value: "100" }, ToAccountRef: { value: "200" }, PrivateNote: "move" },
    { Id: "2", TxnDate: "2026-06-02", Amount: 10, FromAccountRef: { value: "300", name: "Old Inactive" }, ToAccountRef: { value: "100" }, CurrencyRef: { value: "USD" }, ExchangeRate: 18.5 },
    { Id: "3", TxnDate: "2026-06-03", Amount: 5, FromAccountRef: { value: "100" }, ToAccountRef: { value: "999" } }
];
const THEAD = ["Transfer Funds From *", "Transfer Funds To *", "Transfer Amount *", "Date *", "Privatenote", "Currency Code", "Exchange Rate", "Ref no."];
const tMock = (list) => ({ ...jMock([]), Transfer: (q) => list.filter((t) => { const lo = /TxnDate >= '([^']+)'/.exec(q), hi = /TxnDate <= '([^']+)'/.exec(q); return (!lo || t.TxnDate >= lo[1]) && (!hi || t.TxnDate <= hi[1]); }) });

test("Transfer: template headers, raw -> Excel (full account names, inactive account, unresolved account invalid), date range, ZA only", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/Transfer.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), THEAD);
    reset(tMock(transfers()));
    const dataset = await fetchAllForExport(session, ["transfer"], undefined, {});
    const res = await generateCombinedExport("ZA", dataset, ["transfer"]);
    assert.equal(res.summary[0].skippedRows, 1, "transfer 3 has an unresolvable account");
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet("Transfer"); const head = ws.getRow(1).values; const out = [];
    ws.eachRow((row, i) => { if (i > 1) out.push(THEAD.map((h) => row.values[head.indexOf(h)] ?? "")); });
    assert.deepEqual(out, [
        ["Bank:Current", "Fee Income:Litigation", 1500.5, "01/06/2026", "move", "", "", "1"],
        ["Old:Inactive", "Bank:Current", 10, "02/06/2026", "", "USD", 18.5, "2"]
    ]);
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("\"transfer\""));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"transfer\""), r);
    reset(tMock(transfers()));
    const rows = await fetchEntity(session, "transfer", undefined, {}, { transfer: { startDate: "2026-06-02", endDate: "2026-06-02" } });
    assert.deepEqual(rows.map((r) => r.txnId), ["2"]);
});

// ---------- 21. Deposit module (ZA) ----------
const dep = () => [
    { Id: "1", DocNumber: "D-1", TxnDate: "2026-06-01", DepositToAccountRef: { value: "100" }, PrivateNote: "m", TxnTaxDetail: { TotalTax: 15, TaxLine: [tl("9", 15)] },
      DepartmentRef: { value: "1", name: "Cape Town" },
      Line: [
        { Id: "1", Amount: 100, Description: "fee", DetailType: "DepositLineDetail", DepositLineDetail: { AccountRef: { value: "200" }, Entity: { name: "Cust A", type: "Customer" }, ClassRef: { value: "7" }, TaxCodeRef: { value: "5" }, PaymentMethodRef: { value: "3" } } },
        { Id: "2", Amount: 50, DetailType: "DepositLineDetail", DepositLineDetail: { AccountRef: { value: "200" }, TaxCodeRef: { value: "6" } } },
        { Id: "3", Amount: 75, DetailType: "DepositLineDetail", DepositLineDetail: { TxnType: "ReceivePayment" }, LinkedTxn: [{ TxnId: "55", TxnType: "Payment" }] }
      ] },
    { Id: "2", TxnDate: "2026-06-02", DepositToAccountRef: { value: "100" }, CurrencyRef: { value: "USD" }, ExchangeRate: 18.5, Line: [{ Id: "1", Amount: 10, DetailType: "DepositLineDetail", DepositLineDetail: { AccountRef: { value: "200" } } }] },
    { Id: "3", DocNumber: "D-1", TxnDate: "2026-06-03", DepositToAccountRef: { value: "100" }, Line: [{ Id: "1", Amount: 5, DetailType: "DepositLineDetail", DepositLineDetail: { AccountRef: { value: "200" } } }] }
];
const DHEAD = ["Deposit No *", "Date *", "Deposit To Account *", "Received From", "Global Tax Calculation *", "Line Account *", "Line Description", "Line Amount *", "Line Class", "Location", "Line Tax Code", "Tax Applicable On *", "Tax Amount *", "Memo", "Currency Code", "Exchange Rate", "Line Payment Method", "Linked Transaction Type"];
const dMock = (list) => ({
    ...eMock([]),
    Account: (q) => /Active = false/.test(q) ? [] : [
        { Id: "100", Name: "Current", FullyQualifiedName: "Bank:Current", AccountType: "Bank" },
        { Id: "200", Name: "Litigation", FullyQualifiedName: "Fee Income:Litigation", AccountType: "Income" },
        { Id: "101", Name: "Undeposited Funds", FullyQualifiedName: "Undeposited Funds", AccountType: "Other Current Asset", AccountSubType: "UndepositedFunds" }],
    TaxCode: () => [{ Id: "5", Name: "S", SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "9" } }] } }, { Id: "6", Name: "Z", SalesTaxRateList: { TaxRateDetail: [] } }],
    Deposit: (q) => list.filter((d) => { const lo = /TxnDate >= '([^']+)'/.exec(q), hi = /TxnDate <= '([^']+)'/.exec(q); return (!lo || d.TxnDate >= lo[1]) && (!hi || d.TxnDate <= hi[1]); })
});

test("Deposit: template headers, raw -> Excel (Deposit No fill/concatenate, tax rule, linked line -> Undeposited Funds), date range, ZA only", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/Deposit.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), DHEAD);
    reset(dMock(dep()));
    const dataset = await fetchAllForExport(session, ["deposit"], undefined, {});
    const res = await generateCombinedExport("ZA", dataset, ["deposit"]);
    assert.equal(res.summary[0].skippedRows, 0);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet("Deposit"); const head = ws.getRow(1).values; const out = [];
    ws.eachRow((row, i) => { if (i > 1) out.push(DHEAD.map((h) => row.values[head.indexOf(h)] ?? "")); });
    assert.deepEqual(out, [
        ["D-1-1", "01/06/2026", "Bank:Current", "Cust A", "TaxExcluded", "Fee Income:Litigation", "fee", 100, "Region:East", "Cape Town", "Standard", "Sales", 15, "m", "", "", "Cheque", ""],
        ["D-1-1", "01/06/2026", "Bank:Current", "", "TaxExcluded", "Fee Income:Litigation", "", 50, "", "Cape Town", "Out of Scope", "Sales", 0, "m", "", "", "", ""],
        ["D-1-1", "01/06/2026", "Bank:Current", "", "TaxExcluded", "Undeposited Funds", "", 75, "", "Cape Town", "Out of Scope", "Sales", 0, "m", "", "", "", "ReceivePayment"],
        ["2", "02/06/2026", "Bank:Current", "", "TaxExcluded", "Fee Income:Litigation", "", 10, "", "", "Out of Scope", "Sales", 0, "", "USD", 18.5, "", ""],
        ["D-1-3", "03/06/2026", "Bank:Current", "", "TaxExcluded", "Fee Income:Litigation", "", 5, "", "", "Out of Scope", "Sales", 0, "", "", "", "", ""]
    ]);
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("\"deposit\""));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"deposit\""), r);
    reset(dMock(dep()));
    const rows = await fetchEntity(session, "deposit", undefined, {}, { deposit: { startDate: "2026-06-02", endDate: "2026-06-02" } });
    assert.deepEqual([...new Set(rows.map((r) => r.txnId))], ["2"]);
});

// ---------- 22. Cheque module (ZA) ----------
const chequeData = () => [
    { Id: "1", DocNumber: "C-1", PaymentType: "Check", TxnDate: "2026-06-01", AccountRef: { value: "100" }, EntityRef: { name: "Supplier A", value: "5" }, PrivateNote: "m1",
      TxnTaxDetail: { TotalTax: 15, TaxLine: [tl("9", 15)] }, Line: [el("1", 100, "200", "5", { ClassRef: { value: "7" }, CustomerRef: { name: "Cust A", value: "1" } }), el("2", 50, "200", "6")] },
    { Id: "2", PaymentType: "Check", TxnDate: "2026-06-02", AccountRef: { value: "100" }, CurrencyRef: { value: "USD" }, ExchangeRate: 18.5, Line: [el("1", 70, "200", "6")] },
    { Id: "3", DocNumber: "C-1", PaymentType: "Check", TxnDate: "2026-06-03", AccountRef: { value: "100" }, Line: [el("1", 30, "200")] },
    { Id: "4", DocNumber: "CC-1", PaymentType: "CreditCard", TxnDate: "2026-06-03", AccountRef: { value: "100" }, Line: [el("1", 99, "200")] },
    { Id: "5", DocNumber: "CA-1", PaymentType: "Cash", TxnDate: "2026-06-03", AccountRef: { value: "100" }, Line: [el("1", 98, "200")] }
];
const CHEAD = ["Cheque no *", "Bank Account *", "Payee", "Payment Date *", "Memo", "Global Tax Calculation *", "Expense Account *", "Expense Description", "Expense Line Amount *", "Expense Tax Code *", "Expense Account Tax Amount *", "Currency Code", "Expense Class", "Exchange Rate", "Expense Customer"];

test("Cheque: only PaymentType=Check, Credit Card and Expense(Cash) take the rest (no overlap); tax rule, Cheque no fill/concatenate, template headers", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/Cheque.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), CHEAD);
    reset(eMock(chequeData()));
    const dataset = await fetchAllForExport(session, ["cheque", "expense", "creditCard"], undefined, {});
    assert.deepEqual([...new Set(dataset.cheque.map((r) => r.txnId))], ["1", "2", "3"]);
    assert.deepEqual([...new Set(dataset.creditCard.map((r) => r.txnId))], ["4"]);
    assert.deepEqual([...new Set(dataset.expense.map((r) => r.txnId))], ["5"], "no purchase is exported by two modules");
    const res = await generateCombinedExport("ZA", dataset, ["cheque"]);
    assert.equal(res.summary[0].skippedRows, 0);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet("Cheque"); const head = ws.getRow(1).values; const out = [];
    ws.eachRow((row, i) => { if (i > 1) out.push(CHEAD.map((h) => row.values[head.indexOf(h)] ?? "")); });
    assert.deepEqual(out, [
        ["C-1-1", "Bank:Current", "Supplier A", "01/06/2026", "m1", "TaxExcluded", "Fee Income:Litigation", "d1", 100, "Standard", 15, "", "Region:East", "", "Cust A"],
        ["C-1-1", "Bank:Current", "Supplier A", "01/06/2026", "m1", "TaxExcluded", "Fee Income:Litigation", "d2", 50, "Out of Scope", 0, "", "", "", ""],
        ["2", "Bank:Current", "", "02/06/2026", "", "TaxExcluded", "Fee Income:Litigation", "d1", 70, "Out of Scope", 0, "USD", "", 18.5, ""],
        ["C-1-3", "Bank:Current", "", "03/06/2026", "", "TaxExcluded", "Fee Income:Litigation", "d1", 30, "Out of Scope", 0, "", "", "", ""]
    ]);
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("\"cheque\""));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"cheque\""), r);
    reset(eMock(chequeData()));
    const rows = await fetchEntity(session, "cheque", undefined, {}, { cheque: { startDate: "2026-06-02", endDate: "2026-06-02" } });
    assert.deepEqual([...new Set(rows.map((r) => r.txnId))], ["2"]);
});

test("Expense/Cheque/Deposit: tax amount allocates when the TaxCode lists the rate on EITHER its purchase or sales list", async () => {
    const mk = (id, type) => ({ Id: id, DocNumber: `T${id}`, PaymentType: type, TxnDate: "2026-06-01", AccountRef: { value: "100" }, TxnTaxDetail: { TotalTax: 15, TaxLine: [tl("9", 15)] }, Line: [el("1", 100, "200", "5")] });
    reset({ ...eMock([mk("1", "Check"), mk("2", "Cash"), mk("3", "CreditCard")]), TaxCode: () => [{ Id: "5", Name: "S", SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "9" } }] }, PurchaseTaxRateList: { TaxRateDetail: [] } }] });
    const ch = await fetchEntity(session, "cheque", undefined, {}, {});
    const ex = await fetchEntity(session, "expense", undefined, {}, {});
    const cc = await fetchEntity(session, "creditCard", undefined, {}, {});
    for (const r of [...ch, ...ex, ...cc]) assert.deepEqual([r.exportTaxCodeName, r.taxAmount, r.taxRule], ["Standard", 15, "vat-present-standard"]);
});

// ---------- 22b. Credit Card module (ZA) ----------
const ccData = () => [
    { Id: "1", DocNumber: "CC-1", PaymentType: "CreditCard", TxnDate: "2026-06-01", AccountRef: { value: "100" }, EntityRef: { name: "Shop A", value: "5" }, PrivateNote: "m1",
      TxnTaxDetail: { TotalTax: 15, TaxLine: [tl("9", 15)] }, Line: [el("1", 100, "200", "5", { ClassRef: { value: "7" }, CustomerRef: { name: "Cust A", value: "1" } }), el("2", 50, "200", "6")] },
    { Id: "2", PaymentType: "CreditCard", TxnDate: "2026-06-02", AccountRef: { value: "100" }, PaymentMethodRef: { value: "3" }, CurrencyRef: { value: "USD" }, ExchangeRate: 18.5, Line: [el("1", 70, "200", "6")] },
    { Id: "3", DocNumber: "CC-1", PaymentType: "CreditCard", TxnDate: "2026-06-03", AccountRef: { value: "100" }, Line: [el("1", 30, "200")] },
    { Id: "4", DocNumber: "CH-1", PaymentType: "Check", TxnDate: "2026-06-03", AccountRef: { value: "100" }, Line: [el("1", 99, "200")] },
    { Id: "5", DocNumber: "CA-1", PaymentType: "Cash", TxnDate: "2026-06-03", AccountRef: { value: "100" }, Line: [el("1", 98, "200")] }
];

test("Credit Card: only PaymentType=CreditCard, tax rule, Ref No fill/concatenate, Expense template layout, ZA only, date range", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/CreditCard.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), EHEAD);
    reset(eMock(ccData()));
    const dataset = await fetchAllForExport(session, ["creditCard"], undefined, {});
    assert.deepEqual([...new Set(dataset.creditCard.map((r) => r.txnId))], ["1", "2", "3"]);
    assert.ok(dataset.creditCard.every((r) => r.expenseType === "Credit Card"));
    const res = await generateCombinedExport("ZA", dataset, ["creditCard"]);
    assert.equal(res.summary[0].skippedRows, 0);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet("CreditCard"); const head = ws.getRow(1).values; const out = [];
    ws.eachRow((row, i) => { if (i > 1) out.push(EHEAD.map((h) => row.values[head.indexOf(h)] ?? "")); });
    assert.deepEqual(out, [
        ["CC-1-1", "Bank:Current", "Shop A", "01/06/2026", "m1", "TaxExcluded", "Fee Income:Litigation", "d1", 100, "Standard", 15, "Region:East", "", "", "", "Cust A"],
        ["CC-1-1", "Bank:Current", "Shop A", "01/06/2026", "m1", "TaxExcluded", "Fee Income:Litigation", "d2", 50, "Out of Scope", 0, "", "", "", "", ""],
        ["2", "Bank:Current", "", "02/06/2026", "", "TaxExcluded", "Fee Income:Litigation", "d1", 70, "Out of Scope", 0, "", "USD", 18.5, "Cheque", ""],
        ["CC-1-3", "Bank:Current", "", "03/06/2026", "", "TaxExcluded", "Fee Income:Litigation", "d1", 30, "Out of Scope", 0, "", "", "", "", ""]
    ]);
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("\"creditCard\""));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"creditCard\""), r);
    reset(eMock(ccData()));
    const rows = await fetchEntity(session, "creditCard", undefined, {}, { creditCard: { startDate: "2026-06-02", endDate: "2026-06-02" } });
    assert.deepEqual([...new Set(rows.map((r) => r.txnId))], ["2"]);
});

// ---------- 22c. Bill Overpayment module (ZA) ----------
const bpData = () => [
    { Id: "1", DocNumber: "BP-1", PayType: "Check", TxnDate: "2026-06-01", VendorRef: { value: "5", name: "Supplier A" }, PrivateNote: "adv", TotalAmt: 500, CheckPayment: { BankAccountRef: { value: "100" } },
      Line: [] },
    { Id: "2", PayType: "CreditCard", TxnDate: "2026-06-02", VendorRef: { value: "6", name: "Supplier B" }, TotalAmt: 300, CurrencyRef: { value: "USD" }, ExchangeRate: 18.5, CreditCardPayment: { CCAccountRef: { value: "100" } },
      Line: [{ Amount: 100, LinkedTxn: [{ TxnId: "9", TxnType: "Bill" }] }] },
    { Id: "3", DocNumber: "BP-1", PayType: "Check", TxnDate: "2026-06-03", VendorRef: { value: "5", name: "Supplier A" }, TotalAmt: 80, CheckPayment: { BankAccountRef: { value: "100" } },
      Line: [{ Amount: 80, LinkedTxn: [{ TxnId: "9", TxnType: "Bill" }] }] },
    { Id: "4", DocNumber: "BP-4", PayType: "Check", TxnDate: "2026-06-04", VendorRef: { value: "5", name: "Supplier A" }, TotalAmt: 60, CheckPayment: { BankAccountRef: { value: "100" } },
      Line: [{ Amount: 100, LinkedTxn: [{ TxnId: "9", TxnType: "Bill" }] }, { Amount: 40, LinkedTxn: [{ TxnId: "8", TxnType: "VendorCredit" }] }] },
    { Id: "5", DocNumber: "BP-5", PayType: "Check", TxnDate: "2026-06-05", VendorRef: { value: "5", name: "Supplier A" }, TotalAmt: 20.5, CheckPayment: { BankAccountRef: { value: "100" } }, Line: [] }
];
const BPHEAD = ["Ref No *", "Payment Date *", "Memo", "Vendor *", "Bank or CC Account *", "Amount *", "Currency Code", "Exchange Rate"];
const bpMock = (list) => ({
    ...jMock([]),
    BillPayment: (q) => list.filter((p) => { const lo = /TxnDate >= '([^']+)'/.exec(q), hi = /TxnDate <= '([^']+)'/.exec(q); return (!lo || p.TxnDate >= lo[1]) && (!hi || p.TxnDate <= hi[1]); })
});

test("Bill Overpayment: only the unapplied part of BillPayments, Ref No fill/concatenate, template headers, ZA only, date range", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/BillOverpayment.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), BPHEAD);
    reset(bpMock(bpData()));
    const dataset = await fetchAllForExport(session, ["billOverpayment"], undefined, {});
    assert.deepEqual(dataset.billOverpayment.map((r) => [r.txnId, r.amount, r.partiallyApplied]), [["1", 500, false], ["2", 200, true], ["5", 20.5, false]]);
    const res = await generateCombinedExport("ZA", dataset, ["billOverpayment"]);
    assert.equal(res.summary[0].skippedRows, 0);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet("BillOverpayment"); const head = ws.getRow(1).values; const out = [];
    ws.eachRow((row, i) => { if (i > 1) out.push(BPHEAD.map((h) => row.values[head.indexOf(h)] ?? "")); });
    assert.deepEqual(out, [
        ["BP-1", "01/06/2026", "adv", "Supplier A", "Bank:Current", 500, "", 1],
        ["2", "02/06/2026", "", "Supplier B", "Bank:Current", 200, "USD", 18.5],
        ["BP-5", "05/06/2026", "", "Supplier A", "Bank:Current", 20.5, "", 1]
    ]);
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("\"billOverpayment\""));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"billOverpayment\""), r);
    reset(bpMock(bpData()));
    const rows = await fetchEntity(session, "billOverpayment", undefined, {}, { billOverpayment: { startDate: "2026-06-02", endDate: "2026-06-02" } });
    assert.deepEqual(rows.map((r) => r.txnId), ["2"]);
});

test("DEFAULT_PAYMENT_METHOD fills a missing Payment method on Overpayment and Invoice Payment (off by default, real methods untouched)", async () => {
    const pay = [
        { Id: "1", PaymentRefNum: "N-1", TxnDate: "2026-06-01", CustomerRef: { value: "1", name: "C" }, DepositToAccountRef: { value: "100" }, TotalAmt: 50, UnappliedAmt: 50, Line: [] },
        { Id: "2", PaymentRefNum: "N-2", TxnDate: "2026-06-01", CustomerRef: { value: "1", name: "C" }, PaymentMethodRef: { value: "3" }, DepositToAccountRef: { value: "100" }, TotalAmt: 60, UnappliedAmt: 60, Line: [] }
    ];
    const mock = () => ({ ...jMock([]), Payment: () => pay, PaymentMethod: () => [{ Id: "3", Name: "Cheque" }] });
    reset(mock());
    let rows = await fetchEntity(session, "overpayment", undefined, {}, {});
    assert.deepEqual(rows.map((r) => [r.paymentMethodName, r.paymentMethodSource]), [["", "no-method-on-payment"], ["Cheque", "method-list"]]);
    process.env.DEFAULT_PAYMENT_METHOD = " EFT ";
    try {
        reset(mock());
        rows = await fetchEntity(session, "overpayment", undefined, {}, {});
        assert.deepEqual(rows.map((r) => [r.paymentMethodName, r.paymentMethodSource]), [["EFT", "configured-default"], ["Cheque", "method-list"]]);
    } finally { delete process.env.DEFAULT_PAYMENT_METHOD; }
});

// ---------- 22d. Estimates and Purchase Order (ZA) ----------
const rangeFilter = (list) => (q) => list.filter((d) => { const lo = /TxnDate >= '([^']+)'/.exec(q), hi = /TxnDate <= '([^']+)'/.exec(q); return (!lo || d.TxnDate >= lo[1]) && (!hi || d.TxnDate <= hi[1]); });
const docTaxCodes = () => [
    { Id: "5", Name: "S", SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "9" } }] }, PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "9" } }] } },
    { Id: "6", Name: "Z", SalesTaxRateList: { TaxRateDetail: [] }, PurchaseTaxRateList: { TaxRateDetail: [] } }
];
const ESTHEAD = ["Estimate No *", "Customer *", "Estimate Date *", "Expiration Date *", "Estimate Status *", "Accepted By *", "Accepted Date *", "Memo *", "Message displayed on estimate *", "Global Tax Calculation *", "Discount Percent", "Product/Service *", "Product/Service Description *", "Product/Service Quantity *", "Product/Service Rate *", "Product/Service Amount *", "Product/Service Tax Code *", "Product/Service Tax Amount *", "Product/Service Class", "Location", "Currency Code *", "Exchange Rate *", "CustomFieldPONumber"];
const sl = (id, amount, tax, qty = 1) => ({ Id: id, Amount: amount, Description: `d${id}`, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "1", name: "Svc" }, Qty: qty, ...(tax ? { TaxCodeRef: { value: tax } } : {}) } });
const estData = () => [
    { Id: "11", DocNumber: "E-1", TxnDate: "2026-06-01", ExpirationDate: "2026-07-01", TxnStatus: "Accepted", AcceptedBy: "Jo", AcceptedDate: "2026-06-05", CustomerRef: { value: "1", name: "Cust A" }, PrivateNote: "pm", CustomerMemo: { value: "thanks" },
      CustomField: [{ Name: "P.O. Number", StringValue: "PO-77" }, { Name: "Crew #", StringValue: "x" }],
      TxnTaxDetail: { TotalTax: 15, TaxLine: [tl("9", 15)] }, Line: [sl("1", 100, "5", 2), sl("2", 50, "6"), { Amount: 5, DetailType: "SubTotalLineDetail" }] },
    { Id: "12", TxnDate: "2026-06-02", TxnStatus: "Pending", CustomerRef: { value: "2", name: "Cust B" }, CurrencyRef: { value: "USD" }, ExchangeRate: 18.5, Line: [sl("1", 70, "6", 0)] }
];
const estMock = (list) => ({ ...jMock([]), Item: () => [], Customer: () => [], Estimate: rangeFilter(list), TaxCode: docTaxCodes });

test("Estimates: template headers, raw -> Excel (always <txnId>_<DocNumber>, tax rule, status/accepted/custom field), date range, ZA only", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/Estimate.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), ESTHEAD);
    reset(estMock(estData()));
    const dataset = await fetchAllForExport(session, ["estimate"], undefined, {});
    const res = await generateCombinedExport("ZA", dataset, ["estimate"]);
    assert.equal(res.summary[0].skippedRows, 0);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet("Estimate"); const head = ws.getRow(1).values; const out = [];
    ws.eachRow((row, i) => { if (i > 1) out.push(ESTHEAD.map((h) => row.values[head.indexOf(h)] ?? "")); });
    assert.deepEqual(out, [
        ["11_E-1", "Cust A", "01/06/2026", "01/07/2026", "Accepted", "Jo", "05/06/2026", "pm", "thanks", "TaxExcluded", "", "Svc", "d1", 2, 50, 100, "Standard", 15, "", "", "", 1, "PO-77"],
        ["11_E-1", "Cust A", "01/06/2026", "01/07/2026", "Accepted", "Jo", "05/06/2026", "pm", "thanks", "TaxExcluded", "", "Svc", "d2", 1, 50, 50, "Out of Scope", 0, "", "", "", 1, "PO-77"],
        ["12", "Cust B", "02/06/2026", "", "Pending", "", "", "", "", "TaxExcluded", "", "Svc", "d1", 1, 70, 70, "Out of Scope", 0, "", "", "USD", 18.5, ""]
    ]);
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("\"estimate\""));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"estimate\""), r);
    reset(estMock(estData()));
    const rows = await fetchEntity(session, "estimate", undefined, {}, { estimate: { startDate: "2026-06-02", endDate: "2026-06-02" } });
    assert.deepEqual([...new Set(rows.map((r) => r.txnId))], ["12"]);
});

const POHEAD = ["PO No *", "Vendor *", "Purchase Order Status *", "Purchase Order Date *", "Due Date *", "Memo *", "Global Tax Calculation *", "Expense Account *", "Expense Description *", "Expense Line Amount *", "Expense Customer *", "Expense Class *", "Expense Tax Code *", "Product/Service *", "Product/Service Description *", "Product/Service Quantity *", "Product/Service Rate *", "Product/Service Amount *", "Product/Service Tax Code *", "Product/Service Tax Amount *", "Product/Service Class *", "Location *", "Currency Code *", "Exchange Rate *", "CustomFieldPONumber *", "Terms *"];
const ibl = (id, amount, tax, qty, price) => ({ Id: id, Amount: amount, Description: `i${id}`, DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: { ItemRef: { value: "1", name: "Widget" }, Qty: qty, UnitPrice: price, ClassRef: { value: "7" }, ...(tax ? { TaxCodeRef: { value: tax } } : {}) } });
const poData = () => [
    { Id: "21", DocNumber: "PO-1", POStatus: "Open", TxnDate: "2026-06-01", DueDate: "2026-06-30", VendorRef: { value: "5", name: "Supplier A" }, PrivateNote: "m", SalesTermRef: { value: "3" },
      CustomField: [{ Name: "PO Number", StringValue: "X-1" }], TxnTaxDetail: { TotalTax: 15, TaxLine: [tl("9", 15)] },
      Line: [el("1", 100, "200", "5", { ClassRef: { value: "7" }, CustomerRef: { name: "Cust A", value: "1" } }), ibl("2", 50, "6", 5, 10)] },
    { Id: "22", POStatus: "Closed", TxnDate: "2026-06-02", VendorRef: { value: "6", name: "Supplier B" }, Line: [ibl("1", 30, null, 0)] }
];
const poMock = (list) => ({ ...jMock([]), Item: () => [], PurchaseOrder: rangeFilter(list), TaxCode: docTaxCodes, Term: () => [{ Id: "3", Name: "Net 30" }] });

test("Purchase Order: account and item lines fill their own columns, always <txnId>_<DocNumber>, tax rule, terms, ZA only, date range", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/PurchaseOrder.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), POHEAD);
    reset(poMock(poData()));
    const dataset = await fetchAllForExport(session, ["purchaseOrder"], undefined, {});
    const res = await generateCombinedExport("ZA", dataset, ["purchaseOrder"]);
    assert.equal(res.summary[0].skippedRows, 0);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet("PurchaseOrder"); const head = ws.getRow(1).values; const out = [];
    ws.eachRow((row, i) => { if (i > 1) out.push(POHEAD.map((h) => row.values[head.indexOf(h)] ?? "")); });
    assert.deepEqual(out, [
        ["21_PO-1", "Supplier A", "Open", "01/06/2026", "30/06/2026", "m", "TaxExcluded", "Fee Income:Litigation", "d1", 100, "Cust A", "Region:East", "Standard", "", "", "", "", "", "", "", "", "", "", "", "X-1", "Net 30"],
        ["21_PO-1", "Supplier A", "Open", "01/06/2026", "30/06/2026", "m", "TaxExcluded", "", "", "", "", "", "", "Widget", "i2", 5, 10, 50, "Out of Scope", 0, "Region:East", "", "", "", "X-1", "Net 30"],
        ["22", "Supplier B", "Closed", "02/06/2026", "", "", "TaxExcluded", "", "", "", "", "", "", "Widget", "i1", 1, 30, 30, "Out of Scope", 0, "Region:East", "", "", "", "", ""]
    ]);
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("\"purchaseOrder\""));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"purchaseOrder\""), r);
    reset(poMock(poData()));
    const rows = await fetchEntity(session, "purchaseOrder", undefined, {}, { purchaseOrder: { startDate: "2026-06-02", endDate: "2026-06-02" } });
    assert.deepEqual([...new Set(rows.map((r) => r.txnId))], ["22"]);
});

// ---------- 22e. Credit note allocations (ZA) ----------
const ICAHEAD = ["Transaction No.", "TxnDate", "CustomerRef Name", "Deposit To Account Ref", "Private Note", "CurrencyRef Value", "ExchangeRate", "TotalAmount", "Line Amount*", "Voucher No", "AppliedToTxnTxnType"];
const icaMock = (pays) => ({
    ...payMock(pays),
    CreditMemo: () => [{ Id: "20", DocNumber: "CN-9" }, { Id: "21", DocNumber: "" }],
    JournalEntry: (q) => (/select Id, DocNumber/.test(q) ? [{ Id: "30", DocNumber: "J-5" }] : [])
});

test("Invoice Credit Note Allocation: payments with a credit memo / journal link -> one row per linked txn, numbers equal the Invoice / Credit Note / Journal sheets, ZA only, date range", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/InvoiceCreditAllocation.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), ICAHEAD);
    const pays = [
        { Id: "1", PaymentRefNum: "A-1", TxnDate: "2026-06-01", CustomerRef: { value: "1", name: "Cust A" }, DepositToAccountRef: { value: "100" }, PrivateNote: "alloc", TotalAmt: 100,
          Line: [payLine(100, ["11"]), payLine(100, ["20", "CreditMemo"])] },
        { Id: "2", PaymentRefNum: "PLAIN", TxnDate: "2026-06-02", CustomerRef: { value: "1", name: "Cust A" }, DepositToAccountRef: { value: "100" }, Line: [payLine(50, ["11"])] },
        { Id: "3", TxnDate: "2026-06-03", CustomerRef: { value: "2", name: "Cust B" }, CurrencyRef: { value: "USD" }, ExchangeRate: 18.5, TotalAmt: 30, Line: [payLine(30, ["12"]), payLine(30, ["30", "JournalEntry"]), payLine(5, ["21", "CreditMemo"])] }
    ];
    reset(icaMock(pays));
    const dataset = await fetchAllForExport(session, ["invoiceCreditAllocation"], undefined, {});
    const res = await generateCombinedExport("ZA", dataset, ["invoiceCreditAllocation"]);
    assert.equal(res.summary[0].skippedRows, 0);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet("InvoiceCreditAllocation"); const head = ws.getRow(1).values; const out = [];
    ws.eachRow((row, i) => { if (i > 1) out.push(ICAHEAD.map((h) => row.values[head.indexOf(h)] ?? "")); });
    assert.deepEqual(out, [
        ["A-1", "01/06/2026", "Cust A", "Bank:Current", "alloc", "", "", 100, 100, "INV-1", "Invoice"],
        ["A-1", "01/06/2026", "Cust A", "Bank:Current", "alloc", "", "", 100, 100, "9", "CreditMemo"],           // "CN-" prefix removed
        ["3", "03/06/2026", "Cust B", "Undeposited Funds", "", "USD", 18.5, 30, 30, "12", "Invoice"],
        ["3", "03/06/2026", "Cust B", "Undeposited Funds", "", "USD", 18.5, 30, 30, "J-5", "JournalEntry"],
        ["3", "03/06/2026", "Cust B", "Undeposited Funds", "", "USD", 18.5, 30, 5, "21", "CreditMemo"]
    ]);
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("\"invoiceCreditAllocation\""));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"invoiceCreditAllocation\""), r);
    reset(icaMock(pays));
    const rows = await fetchEntity(session, "invoiceCreditAllocation", undefined, {}, { invoiceCreditAllocation: { startDate: "2026-06-03", endDate: "2026-06-03" } });
    assert.deepEqual([...new Set(rows.map((r) => r.txnId))], ["3"]);
});

const BCAHEAD = ["Transaction No.", "DocNumber", "TxnDate", "VendorRef", "BankCreditAccount", "Private Note", "CurrencyRef Value", "ExchangeRate", "TotalAmount", "Line Amount*", "Voucher No", "Txn Type"];
test("Bill Credit Note Allocation: BillPayments with a vendor credit -> one row per linked Bill / VendorCredit (team example layout), ZA only, date range", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/BillCreditAllocation.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), BCAHEAD);
    const bl = (amount, id, type) => ({ Amount: amount, LinkedTxn: [{ TxnId: id, TxnType: type }] });
    const pays = [
        { Id: "7", DocNumber: "BP-1", PayType: "Check", TxnDate: "2026-06-01", VendorRef: { value: "5", name: "Supplier A" }, TotalAmt: 5500, PrivateNote: "x", CheckPayment: { BankAccountRef: { value: "100" } },
          Line: [bl(5497.32, "40", "Bill"), bl(2.68, "41", "Bill"), bl(5500, "50", "VendorCredit")] },
        { Id: "8", DocNumber: "BP-2", PayType: "Check", TxnDate: "2026-06-02", VendorRef: { value: "5", name: "Supplier A" }, TotalAmt: 80, CheckPayment: { BankAccountRef: { value: "100" } }, Line: [bl(80, "40", "Bill")] },
        { Id: "9", PayType: "CreditCard", TxnDate: "2026-06-03", VendorRef: { value: "6", name: "Supplier B" }, TotalAmt: 10, CurrencyRef: { value: "USD" }, ExchangeRate: 18.5, CreditCardPayment: { CCAccountRef: { value: "100" } }, Line: [bl(10, "41", "Bill"), bl(10, "50", "VendorCredit")] }
    ];
    const mock = () => ({ ...jMock([]), BillPayment: rangeFilter(pays), Bill: () => [{ Id: "40", DocNumber: "B-40" }, { Id: "41", DocNumber: "" }], VendorCredit: () => [{ Id: "50", DocNumber: "VC-1" }] });
    reset(mock());
    const dataset = await fetchAllForExport(session, ["billCreditAllocation"], undefined, {});
    const res = await generateCombinedExport("ZA", dataset, ["billCreditAllocation"]);
    assert.equal(res.summary[0].skippedRows, 0);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet("BillCreditAllocation"); const head = ws.getRow(1).values; const out = [];
    ws.eachRow((row, i) => { if (i > 1) out.push(BCAHEAD.map((h) => row.values[head.indexOf(h)] ?? "")); });
    assert.deepEqual(out, [
        ["7", "BP-1", "01/06/2026", "Supplier A", "Bank:Current", "x", "", "", 5500, 5497.32, "B-40", "Bill"],
        ["7", "BP-1", "01/06/2026", "Supplier A", "Bank:Current", "x", "", "", 5500, 2.68, "41", "Bill"],
        ["7", "BP-1", "01/06/2026", "Supplier A", "Bank:Current", "x", "", "", 5500, 5500, "VC-1", "VendorCredit"],
        ["9", "9", "03/06/2026", "Supplier B", "Bank:Current", "", "USD", 18.5, 10, 10, "41", "Bill"],
        ["9", "9", "03/06/2026", "Supplier B", "Bank:Current", "", "USD", 18.5, 10, 10, "VC-1", "VendorCredit"]
    ]);
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("\"billCreditAllocation\""));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"billCreditAllocation\""), r);
    reset(mock());
    const rows = await fetchEntity(session, "billCreditAllocation", undefined, {}, { billCreditAllocation: { startDate: "2026-06-03", endDate: "2026-06-03" } });
    assert.deepEqual([...new Set(rows.map((r) => r.txnId))], ["9"]);
});

// ---------- 22f. Other Journal Types (ZA, from the Journal report) ----------
const jrCell = (value, id) => (id !== undefined ? { value, id } : { value });
const jrLine = (date, type, id, num, name, memo, account, debit, credit, klass = "") => ({ type: "Data", ColData: [jrCell(date), jrCell(type, id), jrCell(num), jrCell(name), jrCell(memo), jrCell(account), jrCell(klass), jrCell(debit), jrCell(credit)] });
const jrReport = () => ({
    Columns: { Column: ["Date", "Transaction Type", "Num", "Name", "Memo/Description", "Account", "Class", "Debit", "Credit"].map((t) => ({ ColTitle: t })) },
    Rows: { Row: [
        { type: "Section", Header: { ColData: [jrCell("")] }, Rows: { Row: [
            jrLine("2026-06-01", "Inventory Qty Adjust", "501", "IA-1", "", "adj", "Inventory Asset", "100.00", ""),
            jrLine("2026-06-01", "Inventory Qty Adjust", "501", "IA-1", "", "adj", "Inventory Shrinkage", "", "100.00", "East")
        ] }, Summary: { ColData: [jrCell("Total")] } },
        { type: "Section", Rows: { Row: [
            jrLine("2026-06-01", "Item Receipt", "502", "", "Supplier A", "", "Inventory Asset", "40.5", ""),
            jrLine("2026-06-01", "Item Receipt", "502", "", "Supplier A", "", "Accounts Payable", "", "40.5")
        ] } },
        { type: "Section", Rows: { Row: [
            jrLine("2026-06-01", "Sales Tax Payment", "503", "", "", "vat", "VAT Control", "15", ""),
            jrLine("2026-06-01", "Sales Tax Payment", "503", "", "", "vat", "Bank", "", "15")
        ] } },
        { type: "Section", Rows: { Row: [
            jrLine("2026-06-02", "Journal Entry", "504", "J-9", "", "", "Bank", "9", ""),
            jrLine("2026-06-02", "Journal Entry", "504", "J-9", "", "", "Equity", "", "9")
        ] } },
        { type: "Section", Rows: { Row: [
            jrLine("2026-06-03", "Inventory Starting Value", "505", "A-VERY-LONG-REFERENCE-NUMBER-12345", "", "", "Inventory Asset", "7", ""),
            jrLine("2026-06-03", "Inventory Starting Value", "505", "A-VERY-LONG-REFERENCE-NUMBER-12345", "", "", "Opening Equity", "", "7")
        ] } }
    ] }
});
const OJHEAD = ["Journal No *", "Journal Date *", "Memo", "Account *", "Amount *", "Description", "Name", "Tax Code", "Class", "Currency Code", "Exchange Rate"];

test("Other Journal Types: only the wanted transaction types, one journal per transaction (date number + Num), Debit - Credit, 21-char limit, ZA only", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/OtherJournal.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), OJHEAD);
    reset({ ...jMock([]), JournalReport: () => jrReport() });
    const dataset = await fetchAllForExport(session, ["otherJournal"], undefined, {});
    assert.deepEqual([...new Set(dataset.otherJournal.map((r) => r.txnType))], ["Inventory Qty Adjust", "Item Receipt", "Sales Tax Payment", "Inventory Starting Value"], "Journal Entry is not one of the 'other' types");
    const res = await generateCombinedExport("ZA", dataset, ["otherJournal"]);
    assert.equal(res.summary[0].skippedRows, 0);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet("OtherJournal"); const head = ws.getRow(1).values; const out = [];
    ws.eachRow((row, i) => { if (i > 1) out.push(OJHEAD.map((h) => row.values[head.indexOf(h)] ?? "")); });
    assert.deepEqual(out, [
        ["20260601_IA-1", "01/06/2026", "", "Inventory Asset", 100, "adj", "", "", "", "", ""],
        ["20260601_IA-1", "01/06/2026", "", "Inventory Shrinkage", -100, "adj", "", "", "East", "", ""],
        ["20260601", "01/06/2026", "", "Inventory Asset", 40.5, "", "Supplier A", "", "", "", ""],
        ["20260601", "01/06/2026", "", "Accounts Payable", -40.5, "", "Supplier A", "", "", "", ""],
        ["20260601_2", "01/06/2026", "", "VAT Control", 15, "vat", "", "", "", "", ""],
        ["20260601_2", "01/06/2026", "", "Bank", -15, "vat", "", "", "", "", ""],
        ["20260603_A-VERY-LONG-", "03/06/2026", "", "Inventory Asset", 7, "", "", "", "", "", ""],
        ["20260603_A-VERY-LONG-", "03/06/2026", "", "Opening Equity", -7, "", "", "", "", "", ""]
    ].map((r) => r));
    assert.ok(out.every((r) => String(r[0]).length <= 21));
    const jr = calls.find((c) => c.path === "reports/JournalReport");
    assert.deepEqual([jr.params.start_date, jr.params.accounting_method], ["1990-01-01", "Accrual"]);
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("\"otherJournal\""));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"otherJournal\""), r);
    reset({ ...jMock([]), JournalReport: () => jrReport() });
    await fetchEntity(session, "otherJournal", undefined, {}, { otherJournal: { startDate: "2026-06-02", endDate: "2026-06-03" } });
    assert.deepEqual([calls.find((c) => c.path === "reports/JournalReport").params.start_date, calls.find((c) => c.path === "reports/JournalReport").params.end_date], ["2026-06-02", "2026-06-03"]);
});

// ---------- 22g. Bill (Detailed Transactions): tax code + tax amount from the live Bill JSON shape ----------
test("Bill: tax code and tax amount come from the line TaxCodeRef + TxnTaxDetail (VAT present -> Standard, zero -> Out of Scope)", async () => {
    const bl = (id, amount, tax) => ({ Id: id, Amount: amount, Description: `d${id}`, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "200", name: "Activity supplier:Sandwich Harbour" }, BillableStatus: "NotBillable", TaxCodeRef: { value: tax } } });
    const bills = [
        { Id: "30661", DocNumber: "1019405", TxnDate: "2025-02-27", DueDate: "2025-03-14", VendorRef: { value: "3", name: "Abenteuer Afrika" }, TotalAmt: 8680, TxnTaxDetail: { TotalTax: 1132.17, TaxLine: [tl("6", 1132.17, 15)] }, Line: [bl("1", 7547.83, "3")] },
        { Id: "29448", DocNumber: "12023179", TxnDate: "2024-02-01", DueDate: "2024-02-16", VendorRef: { value: "266", name: "Namibia Dream Safaris" }, TotalAmt: 4160, TxnTaxDetail: { TotalTax: 0, TaxLine: [tl("11", 0, 0)] }, Line: [bl("1", 4160, "6")] },
        { Id: "29501", DocNumber: "8514", TxnDate: "2024-02-29", DueDate: "2024-03-15", VendorRef: { value: "77", name: "Catamaran" }, TotalAmt: 0, TxnTaxDetail: { TotalTax: 0, TaxLine: [tl("6", 0, 15)] }, Line: [bl("1", 0, "3")] }
    ];
    reset({ ...jMock([]), Item: () => [], Bill: () => bills, TaxCode: () => [
        { Id: "3", Name: "S", PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "6" } }] } },
        { Id: "6", Name: "Z", PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "11" } }] } }
    ] });
    const dataset = await fetchAllForExport(session, ["billDetail"], undefined, {});
    const res = await generateCombinedExport("ZA", dataset, ["billDetail"]);
    assert.equal(res.summary[0].skippedRows, 0);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet("Bill"); const head = ws.getRow(1).values; const out = [];
    ws.eachRow((row, i) => { if (i > 1) out.push([row.values[head.indexOf("Line Amount / Foreign Amount *")], row.values[head.indexOf("Tax Code *")], row.values[head.indexOf("Tax Amount *")]]); });
    assert.deepEqual(out, [[7547.83, "Standard", 1132.17], [4160, "Out of Scope", 0], [0, "Out of Scope", 0]]);
});

// ---------- 22h. Bill Payment + Bill Credit (Supplier Credit) ----------
const BILLPAYHEAD = ["Ref No *", "Payment Date *", "Memo", "Vendor *", "Bank or CC Account *", "Amount *", "Bill No *", "Currency Code", "Exchange Rate", "Journal No", "Transaction Type"];
const readSheet = async (res, name, heads) => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet(name); const head = ws.getRow(1).values; const out = [];
    ws.eachRow((row, i) => { if (i > 1) out.push(heads.map((h) => row.values[head.indexOf(h)] ?? "")); });
    return out;
};
test("Bill Payment: one row per payment -> Bill link, Ref No blank->txn id / duplicate->number-txnId, Bill No as the Bill sheet, vendor-credit lines skipped, ZA only, date range", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/BillPayment.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), BILLPAYHEAD);
    const bl = (amount, id, type = "Bill") => ({ Amount: amount, LinkedTxn: [{ TxnId: id, TxnType: type }] });
    const pays = [
        { Id: "7", DocNumber: "BP-1", PayType: "Check", TxnDate: "2026-06-01", VendorRef: { value: "5", name: "Supplier A" }, TotalAmt: 150, PrivateNote: "m", CheckPayment: { BankAccountRef: { value: "100" } }, Line: [bl(100, "40"), bl(50, "41"), bl(20, "50", "VendorCredit")] },
        { Id: "8", DocNumber: "BP-1", PayType: "Check", TxnDate: "2026-06-02", VendorRef: { value: "5", name: "Supplier A" }, TotalAmt: 80, CheckPayment: { BankAccountRef: { value: "100" } }, Line: [bl(80, "40")] },
        { Id: "9", PayType: "CreditCard", TxnDate: "2026-06-03", VendorRef: { value: "6", name: "Supplier B" }, TotalAmt: 10, CurrencyRef: { value: "USD" }, ExchangeRate: 18.5, CreditCardPayment: { CCAccountRef: { value: "100" } }, Line: [bl(10, "41")] }
    ];
    const mock = () => ({ ...jMock([]), BillPayment: rangeFilter(pays), Bill: () => [{ Id: "40", DocNumber: "B-40" }, { Id: "41", DocNumber: "" }] });
    reset(mock());
    const dataset = await fetchAllForExport(session, ["billPayment"], undefined, {});
    const res = await generateCombinedExport("ZA", dataset, ["billPayment"]);
    assert.equal(res.summary[0].skippedRows, 0);
    assert.deepEqual(await readSheet(res, "BillPayment", BILLPAYHEAD), [
        ["BP-1-7", "01/06/2026", "m", "Supplier A", "Bank:Current", 100, "B-40", "", "", "", "Bill"],
        ["BP-1-7", "01/06/2026", "m", "Supplier A", "Bank:Current", 50, "41", "", "", "", "Bill"],
        ["BP-1-8", "02/06/2026", "", "Supplier A", "Bank:Current", 80, "B-40", "", "", "", "Bill"],
        ["9", "03/06/2026", "", "Supplier B", "Bank:Current", 10, "41", "USD", 18.5, "", "Bill"]
    ]);
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("\"billPayment\""));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"billPayment\""), r);
    reset(mock());
    const rows = await fetchEntity(session, "billPayment", undefined, {}, { billPayment: { startDate: "2026-06-03", endDate: "2026-06-03" } });
    assert.deepEqual([...new Set(rows.map((r) => r.txnId))], ["9"]);
});

const SUPCREDHEAD = ["Ref No *", "Supplier *", "Date *", "Global Tax Calculation *", "Account *", "Description *", "Amount *", "Tax Code *", "Taxable Amount *", "Class", "Location", "Terms", "Currency", "Exchange rate", "SKU", "Service Date *", "Product/Service *", "Qty *", "Unit Price/Rate *", "Line Item", "Line Item Description", "Line Item Tax Code", "Line Item Tax Amount", "Expense Customer Ref Name", "Line Customer Ref Name", "Memo"];
test("Bill Credit: VendorCredit lines, Ref No rule, VAT present -> Standard / zero -> Out of Scope, qty/rate, template headers, ZA only, date range", async () => {
    const wbT = new ExcelJS.Workbook(); await wbT.xlsx.readFile(path.join(here, "../templates/ZA/SupplierCredit.xlsx"));
    assert.deepEqual(wbT.worksheets[0].getRow(1).values.slice(1), SUPCREDHEAD);
    const al = (id, amount, tax) => ({ Id: id, Amount: amount, Description: `d${id}`, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "200" }, TaxCodeRef: { value: tax } } });
    const credits = [
        { Id: "60", DocNumber: "VC-1", TxnDate: "2026-06-01", VendorRef: { value: "5", name: "Supplier A" }, TxnTaxDetail: { TotalTax: 15, TaxLine: [tl("6", 15, 15)] }, Line: [al("1", 100, "3")] },
        { Id: "61", DocNumber: "VC-1", TxnDate: "2026-06-02", VendorRef: { value: "5", name: "Supplier A" }, TxnTaxDetail: { TotalTax: 0, TaxLine: [tl("11", 0, 0)] }, Line: [al("1", 40, "6")] },
        { Id: "62", TxnDate: "2026-06-03", VendorRef: { value: "6", name: "Supplier B" }, CurrencyRef: { value: "USD" }, ExchangeRate: 18.5, Line: [al("1", 7, "6")] }
    ];
    const mock = () => ({ ...jMock([]), Item: () => [], VendorCredit: rangeFilter(credits), TaxCode: () => [
        { Id: "3", Name: "S", PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "6" } }] } },
        { Id: "6", Name: "Z", PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "11" } }] } }
    ] });
    reset(mock());
    const dataset = await fetchAllForExport(session, ["billCredit"], undefined, {});
    const res = await generateCombinedExport("ZA", dataset, ["billCredit"]);
    assert.equal(res.summary[0].skippedRows, 0);
    const out = await readSheet(res, "SupplierCredit", ["Ref No *", "Supplier *", "Date *", "Global Tax Calculation *", "Amount *", "Tax Code *", "Taxable Amount *", "Currency", "Qty *", "Unit Price/Rate *"]);
    assert.deepEqual(out, [
        ["VC-1-60", "Supplier A", "01/06/2026", "TaxExcluded", 100, "Standard", 15, "", 1, 100],
        ["VC-1-61", "Supplier A", "02/06/2026", "TaxExcluded", 40, "Out of Scope", 0, "", 1, 40],
        ["62", "Supplier B", "03/06/2026", "TaxExcluded", 7, "Out of Scope", 0, "USD", 1, 7]
    ]);
    const { listAvailableTemplates } = await import(src("services/template.service.js"));
    assert.ok(JSON.stringify(listAvailableTemplates("ZA")).includes("\"billCredit\""));
    for (const r of ["AU", "CA", "NZ", "UK", "US"]) assert.ok(!JSON.stringify(listAvailableTemplates(r)).includes("\"billCredit\""), r);
    reset(mock());
    const rows = await fetchEntity(session, "billCredit", undefined, {}, { billCredit: { startDate: "2026-06-03", endDate: "2026-06-03" } });
    assert.deepEqual([...new Set(rows.map((r) => r.txnId))], ["62"]);
});

test("Bill + Bill Credit: Product & Service / Line Item side (item, description, tax code, tax amount), Customer Job per line kind, Memo", async () => {
    const acct = (id, amount, cust) => ({ Id: id, Amount: amount, Description: `a${id}`, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "200" }, TaxCodeRef: { value: "3" }, ...(cust ? { CustomerRef: cust } : {}) } });
    const itm = (id, amount, cust) => ({ Id: id, Amount: amount, Description: `i${id}`, DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: { ItemRef: { value: "9", name: "Widget" }, Qty: 2, UnitPrice: amount / 2, TaxCodeRef: { value: "3" }, ...(cust ? { CustomerRef: cust } : {}) } });
    const doc = (id, num) => ({ Id: id, DocNumber: num, TxnDate: "2026-06-01", DueDate: "2026-06-30", PrivateNote: `memo ${id}`, VendorRef: { value: "5", name: "Supplier A" }, TxnTaxDetail: { TotalTax: 30, TaxLine: [tl("6", 30, 15)] },
        Line: [acct("1", 100, { value: "77" }), itm("2", 100, { value: "88", name: "Cust B:Job 2" })] });
    reset({ ...jMock([]), Item: () => [], Bill: () => [doc("1", "B-1")], VendorCredit: () => [doc("2", "VC-1")],
        Customer: (q) => (/Active = false/.test(q) ? [] : [{ Id: "77", FullyQualifiedName: "Cust A:Job 1" }]),
        TaxCode: () => [{ Id: "3", Name: "S", PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "6" } }] } }] });
    const dataset = await fetchAllForExport(session, ["billDetail", "billCredit"], undefined, {});
    const res = await generateCombinedExport("ZA", dataset, ["billDetail", "billCredit"]);
    assert.deepEqual(await readSheet(res, "Bill", ["Product & Service (Item)", "Product & Service Description", "Product & Service Tax Code", "Product & Service Tax Amount", "Expense Customer Job", "Product & Service Customer Job", "Memo"]), [
        ["", "", "", "", "Cust A:Job 1", "", "memo 1"],
        ["Widget", "i2", "Standard", 15, "", "Cust B:Job 2", "memo 1"]
    ]);
    assert.deepEqual(await readSheet(res, "SupplierCredit", ["Line Item", "Line Item Description", "Line Item Tax Code", "Line Item Tax Amount", "Expense Customer Ref Name", "Line Customer Ref Name", "Memo"]), [
        ["", "", "", "", "Cust A:Job 1", "", "memo 2"],
        ["Widget", "i2", "Standard", 15, "", "Cust B:Job 2", "memo 2"]
    ]);
});

test("Invoice Payment: payment journal on the same line as the invoice carries Journal No; Cheque Number only for cheque payments", async () => {
    const pays = [
        { Id: "30", PaymentRefNum: "CH-77", TxnDate: "2026-06-10", CustomerRef: { value: "1", name: "Cust A" }, PaymentMethodRef: { value: "4" }, DepositToAccountRef: { value: "100" },
          Line: [{ Amount: 60, LinkedTxn: [{ TxnId: "11", TxnType: "Invoice" }, { TxnId: "900", TxnType: "JournalEntry" }] }] },
        { Id: "31", PaymentRefNum: "EFT-1", TxnDate: "2026-06-11", CustomerRef: { value: "1", name: "Cust A" }, PaymentMethodRef: { value: "3" }, DepositToAccountRef: { value: "100" }, Line: [payLine(10, ["11"])] }
    ];
    reset({ ...payMock(pays), PaymentMethod: () => [{ Id: "3", Name: "EFT" }, { Id: "4", Name: "Cheque" }], JournalEntry: () => [{ Id: "900", DocNumber: "JNL-9" }] });
    const dataset = await fetchAllForExport(session, ["invoicePayment"], undefined, {});
    const res = await generateCombinedExport("ZA", dataset, ["invoicePayment"]);
    assert.deepEqual(await readSheet(res, "Invoice Payment", ["Ref No *", "Invoice No *", "Amount *", "Journal No", "Transaction Type", "Cheque Number"]), [
        ["CH-77", "INV-1", 60, "JNL-9", "Invoice", "CH-77"],
        ["EFT-1", "INV-1", 10, "", "Invoice", ""]
    ]);
});

test("Overpayment: payments allocated through a journal / credit memo are not overpayments; Bill Overpayment counts journal-paid lines as applied", async () => {
    const jl = (amount, id, type) => ({ Amount: amount, LinkedTxn: [{ TxnId: id, TxnType: type }] });
    reset({ ...payMock([
        { Id: "40", PaymentRefNum: "OJ-1", TxnDate: "2026-06-01", CustomerRef: { value: "1", name: "A" }, DepositToAccountRef: { value: "100" }, TotalAmt: 100, UnappliedAmt: 100, Line: [jl(100, "900", "JournalEntry")] },
        { Id: "41", PaymentRefNum: "OJ-2", TxnDate: "2026-06-01", CustomerRef: { value: "1", name: "A" }, DepositToAccountRef: { value: "100" }, TotalAmt: 100, UnappliedAmt: 100, Line: [jl(60, "900", "JournalEntry")] },
        { Id: "42", PaymentRefNum: "OJ-3", TxnDate: "2026-06-01", CustomerRef: { value: "1", name: "A" }, DepositToAccountRef: { value: "100" }, TotalAmt: 100, UnappliedAmt: 100, Line: [] }
    ]) });
    const rows = await fetchEntity(session, "overpayment", undefined, {}, {});
    assert.deepEqual(rows.map((r) => [r.txnId, r.amount]), [["41", 40], ["42", 100]]);
    const { normalizeBillOverpaymentRecords } = await import(src("services/normalize.service.js"));
    const bp = [{ Id: "50", TotalAmt: 100, PayType: "Check", Line: [jl(100, "900", "JournalEntry")] }, { Id: "51", TotalAmt: 100, PayType: "Check", Line: [jl(30, "900", "JournalEntry")] }];
    assert.deepEqual(normalizeBillOverpaymentRecords(bp).map((r) => [r.txnId, r.amount]), [["51", 70]]);
});

test("Bill Payment: journal payments (Journal No + Transaction Type) and a journal on the same line as a bill", async () => {
    const pays = [{ Id: "60", DocNumber: "BJ-1", PayType: "Check", TxnDate: "2026-06-01", VendorRef: { value: "5", name: "Supplier A" }, CheckPayment: { BankAccountRef: { value: "100" } },
        Line: [{ Amount: 10, LinkedTxn: [{ TxnId: "40", TxnType: "Bill" }] }, { Amount: 20, LinkedTxn: [{ TxnId: "901", TxnType: "JournalEntry" }] }, { Amount: 5, LinkedTxn: [{ TxnId: "41", TxnType: "Bill" }, { TxnId: "901", TxnType: "JournalEntry" }] }] }];
    reset({ ...jMock([]), BillPayment: rangeFilter(pays), Bill: () => [{ Id: "40", DocNumber: "B-40" }, { Id: "41", DocNumber: "B-41" }], JournalEntry: () => [{ Id: "901", DocNumber: "J-1" }] });
    const dataset = await fetchAllForExport(session, ["billPayment"], undefined, {});
    const res = await generateCombinedExport("ZA", dataset, ["billPayment"]);
    assert.equal(res.summary[0].skippedRows, 0);
    assert.deepEqual(await readSheet(res, "BillPayment", ["Ref No *", "Amount *", "Bill No *", "Journal No", "Transaction Type"]), [
        ["BJ-1", 10, "B-40", "", "Bill"], ["BJ-1", 20, "", "J-1", "JournalEntry"], ["BJ-1", 5, "B-41", "J-1", "Bill"]
    ]);
});

test("Invoice Payment: a journal link typed 'Journal Entry' is still a journal; DEBUG_PAYMENT_LINKS prints the raw payment only when enabled", async () => {
    const pays = [{ Id: "70", PaymentRefNum: "JP-1", TxnDate: "2026-06-12", CustomerRef: { value: "1", name: "Cust A" }, DepositToAccountRef: { value: "100" }, Line: [{ Amount: 15, LinkedTxn: [{ TxnId: "900", TxnType: "Journal Entry" }] }] }];
    reset({ ...payMock(pays), JournalEntry: () => [{ Id: "900", DocNumber: "JNL-9" }] });
    const printed = []; const ol = console.log; console.log = (m) => printed.push(String(m));
    let rows;
    try {
        await fetchEntity(session, "invoicePayment", undefined, {}, {});
        assert.equal(printed.filter((m) => /DEBUG_PAYMENT_LINKS/.test(m)).length, 0);
        process.env.DEBUG_PAYMENT_LINKS = "true";
        rows = await fetchEntity(session, "invoicePayment", undefined, {}, {});
    } finally { console.log = ol; delete process.env.DEBUG_PAYMENT_LINKS; }
    assert.deepEqual(rows.map((r) => [r.journalNumber, r.transactionType, r.invoiceNumber]), [["JNL-9", "Journal Entry", ""]]);
    assert.ok(printed.join("\n").includes('"TxnType": "Journal Entry"'));
});

test("Diagnostics can analyse Purchase and Deposit tax codes", async () => {
    const { diagnoseInvoiceTaxCodes } = await import(src("services/diagnostics.service.js"));
    reset({ Purchase: () => [{ Id: "1", TxnTaxDetail: { TotalTax: 15 }, Line: [el("1", 100, "200", "5")] }], Deposit: () => [{ Id: "2", Line: [{ Amount: 5, DepositLineDetail: { TaxCodeRef: { value: "6" } } }] }], TaxCode: () => [{ Id: "5", Name: "S" }, { Id: "6", Name: "Z" }] });
    const p = await diagnoseInvoiceTaxCodes(session, { entity: "Purchase" });
    assert.equal(p.invoiceLines, 1); assert.equal(p.usedTaxCodes[0].taxCodeListName, "S"); assert.equal(p.taxDetail.documentsWithTotalTaxButNoTaxLines, 1);
    const d = await diagnoseInvoiceTaxCodes(session, { entity: "Deposit" });
    assert.equal(d.usedTaxCodes[0].taxCodeListName, "Z");
});

test("Expense/Cheque: unlinked-tax warning states WHY (TaxLine rates and the line tax codes' rate lists)", async () => {
    reset({ ...eMock([{ Id: "9", DocNumber: "W1", PaymentType: "Check", TxnDate: "2026-06-05", AccountRef: { value: "100" }, TxnTaxDetail: { TotalTax: 15, TaxLine: [tl("77", 15, 10)] }, Line: [el("1", 100, "200", "5")] }]), TaxCode: () => [{ Id: "5", Name: "Standard", SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "9" } }] } }] });
    const warnings = []; const ow = logger.warn; logger.warn = (m) => warnings.push(String(m));
    try { await fetchEntity(session, "cheque", undefined, {}, {}); } finally { logger.warn = ow; }
    const w = warnings.find((m) => /W1/.test(m));
    assert.ok(w && /TaxLine=\[77:15@10%\]/.test(w) && /5\(Standard\):inList sales=\[9\] purchase=\[\]/.test(w), w);
});

test("Cheque/Expense/Deposit: TaxLine rate id not in the TaxCode's list -> linked by PERCENT (the reported ZA case: TaxLine 58 vs code rates 42/43)", async () => {
    const tlp = (rate, amount, pct) => ({ Amount: amount, DetailType: "TaxLineDetail", TaxLineDetail: { TaxRateRef: { value: rate }, PercentBased: true, TaxPercent: pct } });
    const codes = () => [
        { Id: "22", Name: "Standard", Taxable: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "43" } }] }, PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "42" } }] } },
        { Id: "29", Name: "Out of Scope", Taxable: false, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "74" } }] }, PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "73" } }] } }
    ];
    const rates = () => [{ Id: "42", RateValue: 15 }, { Id: "43", RateValue: 15 }, { Id: "73", RateValue: 0 }, { Id: "74", RateValue: 0 }];
    const purchase = { Id: "1", DocNumber: "P1", PaymentType: "Check", TxnDate: "2026-06-01", AccountRef: { value: "100" },
        TxnTaxDetail: { TotalTax: 45, TaxLine: [tlp("58", 45, 15), tlp("73", 0, 0)] }, Line: [el("1", 100, "200", "22"), el("2", 200, "200", "22"), el("3", 80, "200", "29")] };
    const deposit = { Id: "2", DocNumber: "D1", TxnDate: "2026-06-01", DepositToAccountRef: { value: "100" }, TxnTaxDetail: { TotalTax: 30, TaxLine: [tlp("59", 30, 15)] },
        Line: [{ Id: "1", Amount: 200, DetailType: "DepositLineDetail", DepositLineDetail: { AccountRef: { value: "200" }, TaxCodeRef: { value: "22" } } }] };
    reset({ ...dMock([deposit]), ...eMock([purchase]), Deposit: () => [deposit], TaxCode: codes, TaxRate: rates });
    const ch = await fetchEntity(session, "cheque", undefined, {}, {});
    assert.deepEqual(ch.map((r) => [r.exportTaxCodeName, r.taxAmount, r.taxAmountSource]), [["Standard", 15, "txn-tax-line-by-percent"], ["Standard", 30, "txn-tax-line-by-percent"], ["Out of Scope", 0, "none"]]);
    const dp = await fetchEntity(session, "deposit", undefined, {}, {});
    assert.deepEqual(dp.map((r) => [r.exportTaxCodeName, r.taxRule]), [["Standard", "vat-present-standard"]]);
    // TaxRate list unavailable: the verified last-resort rule still links it (taxable Standard lines, the 0% line is claimed by Out of Scope, 300 x 15% = 45 verifies)
    reset({ ...eMock([purchase]), TaxCode: codes, TaxRate: () => [] });
    const viaResidual = await fetchEntity(session, "cheque", undefined, {}, {});
    assert.deepEqual(viaResidual.map((r) => [r.taxAmount, r.taxAmountSource]), [[15, "txn-tax-line-verified-by-percent"], [30, "txn-tax-line-verified-by-percent"], [0, "none"]]);
    // percent that does NOT reproduce the tax (14% x 300 = 42 != 45) -> never guessed, stays unlinked
    const wrong = { ...purchase, TxnTaxDetail: { TotalTax: 45, TaxLine: [tlp("58", 45, 14), tlp("73", 0, 0)] } };
    reset({ ...eMock([wrong]), TaxCode: codes, TaxRate: () => [] });
    const none = await fetchEntity(session, "cheque", undefined, {}, {});
    assert.ok(none.every((r) => r.taxRule === "kept-tax-unlinked" && r.taxAmount === 0));
    // two different unlinked non-zero tax lines -> ambiguous, stays unlinked
    const two = { ...purchase, TxnTaxDetail: { TotalTax: 60, TaxLine: [tlp("58", 45, 15), tlp("59", 15, 15)] } };
    reset({ ...eMock([two]), TaxCode: codes, TaxRate: () => [] });
    assert.ok((await fetchEntity(session, "cheque", undefined, {}, {})).every((r) => r.taxAmount === 0));
});

// ---------- 23. Dynamic Tax Mapping ----------
const tmx = async () => import(src("services/taxMapping.service.js"));
const taxCodesFixture = (q) => (/Active = false/.test(q) ? [{ Id: "40", Name: "Old Code", Taxable: true, Active: false, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "1" } }] } }] : [
    { Id: "22", Name: "Standard", Taxable: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "1" } }] } },
    { Id: "29", Name: "Out of Scope", Taxable: false, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "2" } }] } },
    { Id: "30", Name: "GST+PST", Taxable: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "3" }, TaxOrder: 0 }, { TaxRateRef: { value: "4" }, TaxOrder: 1 }] } },
    { Id: "31", Name: "Mystery", Taxable: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "99" } }] } },
    { Id: "32", Name: "Group 15", Taxable: true, TaxGroup: true, PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "1" } }] } }
]);
const taxRatesFixture = (q) => (/Active = false/.test(q) ? [] : [
    { Id: "1", Name: "VAT", RateValue: 15 }, { Id: "2", Name: "Zero", RateValue: 0 }, { Id: "3", Name: "GST", RateValue: 5 }, { Id: "4", Name: "PST", RateValue: 7 }
]);
const withTaxStore = async (fn) => {
    const fs = await import("node:fs"), os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taxmap-"));
    const prev = process.env.TAX_MAPPING_FILE; process.env.TAX_MAPPING_FILE = path.join(dir, "t.json");
    try { return await fn(); } finally { process.env.TAX_MAPPING_FILE = prev; fs.rmSync(dir, { recursive: true, force: true }); }
};

test("Tax mapping: source taxes fetched with rate, type, components, inactive, unknown-rate and multi-component flags", async () => {
    const { fetchSourceTaxes, effectiveRate } = await tmx();
    reset({ TaxCode: taxCodesFixture, TaxRate: taxRatesFixture });
    const taxes = await fetchSourceTaxes(session);
    const by = Object.fromEntries(taxes.map((t) => [t.name, t]));
    assert.equal(taxes.length, 6, "active + inactive");
    assert.deepEqual([by.Standard.rate, by.Standard.type, by.Standard.multiComponent], [15, "Taxable", false]);
    assert.deepEqual([by["Out of Scope"].rate, by["Out of Scope"].type], [0, "Non-taxable"]);
    assert.deepEqual([by["GST+PST"].multiComponent, by["GST+PST"].salesComponents.map((c) => c.rateId)], [true, ["3", "4"]]);
    assert.equal(by["GST+PST"].rate, 12);   // 5 + 7 on the same base
    assert.deepEqual([by.Mystery.rate, by.Mystery.missingRates], [null, ["99"]]);
    assert.deepEqual([by["Group 15"].type, by["Group 15"].rate], ["Tax group", 15]);
    assert.equal(by["Old Code"].active, false);
    assert.equal(effectiveRate([{ percent: 5, order: 0 }, { percent: 10, applicable: "TaxOnTax", order: 1 }]), 5.5, "tax on tax compounds on the first tax");
    assert.equal(effectiveRate([]), null);
});

test("Tax mapping: suggestions only for known single-component rates; manual entry validation errors are clear", async () => {
    const { fetchSourceTaxes, buildTaxMappingTable, validateTargetTax } = await tmx();
    reset({ TaxCode: taxCodesFixture, TaxRate: taxRatesFixture });
    const { rows, counts } = buildTaxMappingTable(await fetchSourceTaxes(session), { enabled: false, entries: {} });
    const by = Object.fromEntries(rows.map((r) => [r.sourceName, r]));
    assert.equal(by.Standard.status, "suggested"); assert.deepEqual([by.Standard.targetName, by.Standard.targetRate], ["Standard", 15]);
    assert.equal(by["GST+PST"].status, "unmapped", "components can't be compared -> never auto-suggested");
    assert.equal(by.Mystery.status, "unmapped", "unknown rate -> never auto-suggested");
    assert.equal(counts.suggested, 4); assert.equal(counts.unmapped, 2); assert.equal(counts.all, 6);

    const bad = (o) => validateTargetTax(o).errors.map((e) => e.field);
    assert.deepEqual(bad({ targetName: "", targetRate: 15 }), ["targetName"]);
    assert.deepEqual(bad({ targetName: "x", targetRate: "abc" }), ["targetRate"]);
    assert.deepEqual(bad({ targetName: "x", targetRate: "" }), ["targetRate"]);
    assert.deepEqual(bad({ targetName: "x", targetRate: -1 }), ["targetRate"]);
    assert.deepEqual(bad({ targetName: "x", targetRate: 100.5 }), ["targetRate"]);
    assert.deepEqual(bad({ targetName: "x", targetRate: "15.00001" }), ["targetRate"]);
    assert.deepEqual(bad({ targetName: "x", targetRate: 15, calcType: "weird" }), ["calcType"]);
    assert.deepEqual(bad({ targetName: "x".repeat(101), targetRate: 15 }), ["targetName"]);
    assert.deepEqual(validateTargetTax({ targetName: " VAT 7.5 ", targetRate: "7.5", calcType: "inclusive" }).value, { targetName: "VAT 7.5", targetRate: 7.5, targetType: "", calcType: "inclusive" });
});

test("Tax mapping: save accept / manual (confirmed vs not) / clear, statuses, rate-mismatch warning, duplicate target conflict, per-company storage", async () => {
    await withTaxStore(async () => {
        const { fetchSourceTaxes, saveTaxMappingChanges, buildTaxMappingTable, loadTaxMapping } = await tmx();
        reset({ TaxCode: taxCodesFixture, TaxRate: taxRatesFixture });
        const taxes = await fetchSourceTaxes(session);
        const table = (realm = session.realmId) => Object.fromEntries(buildTaxMappingTable(taxes, loadTaxMapping(realm, "ZA")).rows.map((r) => [r.sourceName, r]));

        saveTaxMappingChanges(session.realmId, "ZA", taxes, { enabled: true, changes: [
            { sourceId: "22", action: "accept-suggestion" },
            { sourceId: "30", action: "set", targetName: "Combined 12", targetRate: 12, confirmed: true },
            { sourceId: "31", action: "set", targetName: "Mystery Target", targetRate: 7, confirmed: false },
            { sourceId: "29", action: "set", targetName: "Zero", targetRate: 5, confirmed: true }
        ] });
        let t = table();
        assert.equal(t.Standard.status, "mapped");
        assert.equal(t["GST+PST"].status, "manual_rate"); assert.match(t["GST+PST"].message, /several components/);
        assert.equal(t.Mystery.status, "error"); assert.match(t.Mystery.message, /not confirmed/, "a typed percentage is NOT an existing target tax");
        assert.equal(t["Out of Scope"].status, "manual_rate"); assert.match(t["Out of Scope"].message, /differs from source rate 0%/);
        assert.equal(loadTaxMapping(session.realmId, "ZA").enabled, true);
        assert.equal(loadTaxMapping("another-company", "ZA").enabled, false, "stored per company");
        assert.equal(loadTaxMapping(session.realmId, "AU").enabled, false, "stored per region");

        // invalid manual values are rejected with field errors and nothing is saved
        assert.throws(() => saveTaxMappingChanges(session.realmId, "ZA", taxes, { changes: [{ sourceId: "32", action: "set", targetName: "", targetRate: "x" }] }), (e) => e.fieldErrors?.length === 2);
        assert.throws(() => saveTaxMappingChanges(session.realmId, "ZA", taxes, { changes: [{ sourceId: "nope", action: "clear" }] }), (e) => e.fieldErrors?.[0].field === "sourceId");
        assert.throws(() => saveTaxMappingChanges(session.realmId, "ZA", taxes, { changes: [{ sourceId: "29", action: "accept-suggestion" }, { sourceId: "31", action: "accept-suggestion" }] }), (e) => e.fieldErrors?.[0].sourceId === "31");
        assert.equal(table().Standard.status, "mapped", "failed save changed nothing");

        // duplicate target name with different rates -> error on both
        saveTaxMappingChanges(session.realmId, "ZA", taxes, { changes: [{ sourceId: "22", action: "set", targetName: "Shared", targetRate: 15, confirmed: true }, { sourceId: "32", action: "set", targetName: "shared", targetRate: 14, confirmed: true }] });
        t = table(); assert.equal(t.Standard.status, "error"); assert.equal(t["Group 15"].status, "error"); assert.match(t.Standard.message, /different rates/);

        saveTaxMappingChanges(session.realmId, "ZA", taxes, { changes: [{ sourceId: "22", action: "clear" }] });
        assert.equal(table().Standard.status, "suggested");
    });
});

test("Tax mapping: empty tax lists and API errors", async () => {
    const { fetchSourceTaxes, buildTaxMappingTable } = await tmx();
    reset({ TaxCode: () => [], TaxRate: () => [] });
    const taxes = await fetchSourceTaxes(session);
    assert.deepEqual(taxes, []);
    assert.deepEqual(buildTaxMappingTable(taxes, { enabled: false, entries: {} }), { rows: [], counts: { all: 0, mapped: 0, suggested: 0, manual_rate: 0, unmapped: 0, error: 0 } });
    reset({ TaxCode: () => { throw new Error("QBO 500"); }, TaxRate: () => [] });
    await assert.rejects(() => fetchSourceTaxes(session));
});

test("Tax mapping applied to export: invoices use the saved mapping, regional rules stay, unresolved lines are blocked (never substituted)", async () => {
    await withTaxStore(async () => {
        const { fetchSourceTaxes, saveTaxMappingChanges, getTaxMappingContext } = await tmx();
        const { flattenForExport } = await import(src("services/flatten.service.js"));
        reset({ TaxCode: taxCodesFixture, TaxRate: taxRatesFixture });
        const taxes = await fetchSourceTaxes(session);
        // ZA invoice rows: S + positive amount (regional rule -> Standard), a kept-source row with code 30, an unmapped kept-source row with code 31
        const rows = [
            { txnId: "1", docNumber: "A", taxCodeId: "22", taxCodeName: "S", exportTaxCodeName: "Standard", taxRule: "S-positive-standard" },
            { txnId: "2", docNumber: "B", taxCodeId: "30", taxCodeName: "GST+PST", exportTaxCodeName: "GST+PST", taxRule: "kept-source" },
            { txnId: "3", docNumber: "C", taxCodeId: "31", taxCodeName: "Mystery", exportTaxCodeName: "Mystery", taxRule: "kept-source" },
            { txnId: "4", docNumber: "D", taxCodeId: "", taxCodeName: "", exportTaxCodeName: "", taxRule: "kept-source" }
        ];
        // mapping NOT enabled -> output identical to no-mapping output
        saveTaxMappingChanges(session.realmId, "ZA", taxes, { enabled: false, changes: [{ sourceId: "30", action: "set", targetName: "Combined 12", targetRate: 12, confirmed: true }] });
        assert.equal(getTaxMappingContext(session, "ZA"), null);
        assert.deepEqual(flattenForExport("invoiceDetail", rows, null).map((r) => r.exportTaxCodeName), ["Standard", "GST+PST", "Mystery", ""]);

        saveTaxMappingChanges(session.realmId, "ZA", taxes, { enabled: true, changes: [] });
        const ctx = { region: "ZA", ...getTaxMappingContext(session, "ZA") };
        const out = flattenForExport("invoiceDetail", rows, ctx);
        assert.equal(out[0].exportTaxCodeName, "Standard", "regional S->Standard rule is final");
        assert.deepEqual([out[1].exportTaxCodeName, out[1].mappedTaxRate], ["Combined 12", 12]);
        assert.match(out[2]._taxMappingIssue.message, /Mystery.*no target tax selected/);
        assert.equal(out[3]._taxMappingIssue, undefined, "no source tax code -> nothing to map");

        // the blocked line is invalid in the preview and not written to Excel; the others are exported
        const full = (id, name, rule) => ({ txnId: id, docNumber: `N${id}`, customerName: "C", invoiceDate: "2026-01-01", dueDate: "2026-02-01", globalTaxCalculation: "TaxExcluded", productServiceName: "Svc", description: "d", quantity: 1, rate: 10, amount: 10, taxCodeId: id === "2" ? "30" : "31", taxCodeName: name, exportTaxCodeName: name, taxRule: rule, taxAmount: 0 });
        const recs = [full("2", "GST+PST", "kept-source"), full("3", "Mystery", "kept-source")];
        const report = buildEntityReport("invoiceDetail", recs, "ZA", ctx);
        assert.deepEqual([report.mappedCount, report.invalidCount], [1, 1]);
        assert.ok(report.rows.find((r) => r.status === "invalid").issues.some((i) => i.type === "unresolved_tax_mapping"));
        const res = await generateCombinedExport("ZA", { invoiceDetail: recs }, ["invoiceDetail"], ctx);
        assert.deepEqual([res.summary[0].writtenRows, res.summary[0].skippedRows], [1, 1]);
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res.buffer);
        const ws = wb.getWorksheet("Invoice"); const head = ws.getRow(1).values;
        assert.equal(ws.getRow(2).values[head.indexOf("Product/Service Tax Code *")], "Combined 12");

        // other region + no ctx -> unchanged
        assert.equal(getTaxMappingContext(session, "AU"), null);
    });
});

test("Tax mapping API handlers: GET table, PUT saves, invalid PUT -> 400 with fieldErrors, invalid region -> 400", async () => {
    await withTaxStore(async () => {
        const { getTaxMapping, saveTaxMapping } = await import(src("controllers/taxMapping.controller.js"));
        reset({ TaxCode: taxCodesFixture, TaxRate: taxRatesFixture });
        const call = (handler, req) => new Promise((resolve) => {
            const res = { statusCode: 0, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); return this; } };
            handler({ qboSession: session, query: {}, body: {}, ...req }, res, (err) => resolve({ code: err.statusCode || err.status || 500, body: { message: err.message } }));
        });
        let r = await call(getTaxMapping, { query: { region: "ZA" } });
        assert.equal(r.code, 200); assert.equal(r.body.rows.length, 6); assert.equal(r.body.target.targetCreationSupported, false);
        r = await call(getTaxMapping, { query: { region: "XX" } });
        assert.equal(r.code, 400);
        r = await call(saveTaxMapping, { body: { region: "ZA", enabled: true, changes: [{ sourceId: "22", action: "accept-suggestion" }] } });
        assert.equal(r.code, 200); assert.equal(r.body.enabled, true); assert.equal(r.body.rows.find((x) => x.sourceId === "22").status, "mapped");
        r = await call(saveTaxMapping, { body: { region: "ZA", changes: [{ sourceId: "29", action: "set", targetName: "", targetRate: "abc" }] } });
        assert.equal(r.code, 400); assert.equal(r.body.fieldErrors.length, 2);
    });
});

test("Bill / Bill Credit line diagnostics: one safe summary line; DEBUG_BILL_LINES prints raw JSON of item/customer documents only when enabled", async () => {
    const acct = { Id: "1", Amount: 5, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "200" }, CustomerRef: { value: "77", name: "Cust:Job" } } };
    const plain = { Id: "1", Amount: 5, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "200" } } };
    reset({ ...jMock([]), Item: () => [], Customer: () => [], TaxCode: () => [], Bill: () => [{ Id: "1", DocNumber: "A", VendorRef: { value: "5", name: "S" }, TxnDate: "2026-06-01", Line: [acct] }, { Id: "2", DocNumber: "B", VendorRef: { value: "5", name: "S" }, TxnDate: "2026-06-01", Line: [plain] }] });
    const infos = []; const oi = logger.info; logger.info = (m) => infos.push(String(m));
    const printed = []; const ol = console.log; console.log = (m) => printed.push(String(m));
    try {
        await fetchEntity(session, "billDetail", undefined, { account: [], item: [] }, {});
        assert.equal(printed.filter((m) => /DEBUG_BILL_LINES/.test(m)).length, 0, "off by default");
        process.env.DEBUG_BILL_LINES = "true";
        await fetchEntity(session, "billDetail", undefined, { account: [], item: [] }, {});
    } finally { logger.info = oi; console.log = ol; delete process.env.DEBUG_BILL_LINES; }
    const summary = infos.find((m) => /^Bill lines:/.test(m));
    assert.ok(summary && /withCustomerRef=1 \(withCustomerRefName=1\)/.test(summary) && /withItemRef=0/.test(summary) && /rowsWithCustomerJob=1/.test(summary), summary);
    const dump = printed.join("\n");
    assert.match(dump, /1 document\(s\) have an item line or a CustomerRef/);
    assert.ok(dump.includes('"value": "77"') && !dump.includes('"DocNumber": "B"'));
});
