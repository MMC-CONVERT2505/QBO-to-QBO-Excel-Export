import { fetchReport, queryAll } from "./qboClient.js";
import { fetchCompanyInfo, resolveFiscalYearStart, parseTrialBalanceRow } from "./fetch.service.js";
import { parseLineAmount, applyInvoiceTaxRules } from "./normalize.service.js";
import { collectTypedDataRows, collectLeafRows, rowTypeHistogram } from "./reportRows.js";

// READ-ONLY diagnostics for the Open Balance module. Runs the Trial Balance
// report with several date-range variants against the connected company and
// returns ONLY structural counts - never account names, amounts or tokens -
// so the output can be shared safely to pin down exactly where records are lost.
export const diagnoseOpenBalance = async (qboSession, asOfDate) => {

    const fiscalStart = await resolveFiscalYearStart(qboSession, asOfDate);

    const variants = [
        { label: "A: fiscal-year start -> cutoff (what the export uses)", params: { start_date: fiscalStart, end_date: asOfDate, accounting_method: "Accrual" } },
        { label: "B: 2000-01-01 -> cutoff (full history)", params: { start_date: "2000-01-01", end_date: asOfDate, accounting_method: "Accrual" } },
        { label: "C: cutoff -> cutoff (single day)", params: { start_date: asOfDate, end_date: asOfDate, accounting_method: "Accrual" } },
        { label: "D: no date parameters (QBO default period)", params: {} },
        { label: "E: legacy report_date only", params: { report_date: asOfDate } }
    ];

    const results = [];

    for (const variant of variants) {
        const entry = { label: variant.label, params: variant.params };
        try {
            const report = await fetchReport(qboSession, "TrialBalance", variant.params);
            const titles = (report.Columns?.Column || []).map((c) => c.ColTitle || "(blank)");
            const header = report.Header || {};
            const options = Object.fromEntries((header.Option || []).map((o) => [o.Name, o.Value]));
            const tolerant = collectLeafRows(report.Rows).map((r) => parseTrialBalanceRow(r, report.Columns?.Column?.map((c) => c.ColTitle || "") || []));
            const nonZero = tolerant.filter((r) => r.debit !== 0 || r.credit !== 0);
            const totalDebit = nonZero.reduce((s, r) => s + r.debit, 0);
            const totalCredit = nonZero.reduce((s, r) => s + r.credit, 0);

            Object.assign(entry, {
                ok: true,
                period: `${header.StartPeriod || "?"}..${header.EndPeriod || "?"}`,
                basis: header.ReportBasis,
                currency: header.Currency,
                noReportData: options.NoReportData ?? null,
                columns: titles,
                rowTypes: rowTypeHistogram(report.Rows),
                leafRowsStrictTypeData: collectTypedDataRows(report.Rows).length,
                leafRowsTolerant: tolerant.length,
                nonZeroRows: nonZero.length,
                debitsEqualCredits: Math.abs(totalDebit - totalCredit) < 0.01
            });
        } catch (error) {
            Object.assign(entry, {
                ok: false,
                error: error.message,
                qboFault: error.details?.Error?.map((e) => ({ code: e.code, message: e.Message })) ?? null
            });
        }
        results.push(entry);
    }

    // Cross-check against the chart of accounts: how many accounts carry a
    // non-zero CURRENT balance at all? (counts only)
    let accounts = null;
    try {
        const all = await queryAll(qboSession, "select * from Account");
        accounts = { total: all.length, withNonZeroCurrentBalance: all.filter((a) => Number(a.CurrentBalance) !== 0).length };
    } catch (error) {
        accounts = { error: error.message };
    }

    let company = null;
    try {
        const info = await fetchCompanyInfo(qboSession);
        company = { country: info.Country, fiscalYearStartMonth: info.FiscalYearStartMonth };
    } catch { /* optional */ }

    return { asOfDate, fiscalYearStartUsed: fiscalStart, company, accounts, variants: results };

};

// READ-ONLY structural report on how parent/sub-item relationships appear in
// the connected company's real Item data. Counts only - no item names/ids.
export const diagnoseItems = async (qboSession) => {

    const active = await queryAll(qboSession, "select * from Item");
    let inactive = [];
    try { inactive = await queryAll(qboSession, "select * from Item where Active = false"); } catch { /* optional */ }

    const all = [...active, ...inactive];
    const byId = new Map(all.map((i) => [String(i.Id), i]));
    const activeIds = new Set(active.map((i) => String(i.Id)));

    const withParent = active.filter((i) => i.ParentRef?.value);
    const depthOf = (item) => {
        let depth = 0; let cur = item; const seen = new Set();
        while (cur?.ParentRef?.value && !seen.has(cur.Id)) { seen.add(cur.Id); depth += 1; cur = byId.get(String(cur.ParentRef.value)); }
        return depth;
    };

    const byType = {};
    active.forEach((i) => { byType[i.Type || "(none)"] = (byType[i.Type || "(none)"] || 0) + 1; });

    return {
        activeItems: active.length,
        inactiveItems: inactive.length,
        byType,
        subItemFlagTrue: active.filter((i) => i.SubItem === true).length,
        withParentRef: withParent.length,
        parentRefHasName: withParent.filter((i) => i.ParentRef.name).length,
        parentRefIdOnly: withParent.filter((i) => !i.ParentRef.name).length,
        parentFoundAmongActive: withParent.filter((i) => activeIds.has(String(i.ParentRef.value))).length,
        parentIsInactiveOnly: withParent.filter((i) => !activeIds.has(String(i.ParentRef.value)) && byId.has(String(i.ParentRef.value))).length,
        parentNotFoundAtAll: withParent.filter((i) => !byId.has(String(i.ParentRef.value))).length,
        parentIsCategoryType: withParent.filter((i) => byId.get(String(i.ParentRef.value))?.Type === "Category").length,
        parentIsRegularItem: withParent.filter((i) => { const p = byId.get(String(i.ParentRef.value)); return p && p.Type !== "Category"; }).length,
        topLevelWithoutParent: active.filter((i) => !i.ParentRef?.value).length,
        maxNestingDepth: active.reduce((m, i) => Math.max(m, depthOf(i)), 0)
    };

};

// READ-ONLY: shows, for every TaxCodeRef used on invoice lines, WHERE the
// exported tax code text comes from. Output = tax-code configuration (ids,
// names, taxable flag) plus line COUNTS - no customers, amounts or doc numbers.
//
// For each distinct TaxCodeRef.value on invoice lines:
//   refValue          raw TaxCodeRef.value on the invoice line (the code's Id)
//   refNameOnLine     TaxCodeRef.name exactly as QBO sent it ("" if QBO sent none)
//   taxCodeListName   Name of the TaxCode entity whose Id == refValue ("" if not found)
//   exportedAs        what the Excel column will contain
//   source            ref-name | taxcode-list | unresolved
export const diagnoseInvoiceTaxCodes = async (qboSession, { startDate = null, endDate = null, entity = "Invoice" } = {}) => {

    // entity: "Invoice" (default) or "CreditMemo" - same read-only analysis for either.
    if (!["Invoice", "CreditMemo", "Purchase", "Deposit"].includes(entity)) throw new Error("entity must be Invoice, CreditMemo, Purchase or Deposit");
    // Purchase = expenses and cheques; Deposit = deposits. Each keeps its tax code on a different line detail.
    const LINE_DETAIL = { Invoice: "SalesItemLineDetail", CreditMemo: "SalesItemLineDetail", Purchase: "AccountBasedExpenseLineDetail", Deposit: "DepositLineDetail" }[entity];

    const conds = [];
    if (startDate) conds.push(`TxnDate >= '${startDate}'`);
    if (endDate) conds.push(`TxnDate <= '${endDate}'`);
    const invoiceQuery = `select * from ${entity}${conds.length ? ` where ${conds.join(" and ")}` : ""}`;

    const [invoices, activeCodes, inactiveCodes, activeRates, inactiveRates] = await Promise.all([
        queryAll(qboSession, invoiceQuery),
        queryAll(qboSession, "select * from TaxCode"),
        queryAll(qboSession, "select * from TaxCode where Active = false"),
        queryAll(qboSession, "select * from TaxRate").catch(() => []),
        queryAll(qboSession, "select * from TaxRate where Active = false").catch(() => [])
    ]);

    const codeById = new Map([...activeCodes, ...inactiveCodes].map((t) => [String(t.Id), t]));

    const used = new Map();
    let totalLines = 0, linesWithoutRef = 0;

    // Tax AMOUNT linking: every tax rate that appears in invoices' TxnTaxDetail.TaxLine,
    // and which TaxCodes (by their SalesTaxRateList) can carry it to a line.
    const rateIdsOf = (t) => [...(t.SalesTaxRateList?.TaxRateDetail || []), ...(t.PurchaseTaxRateList?.TaxRateDetail || [])].map((d) => String(d.TaxRateRef?.value));
    const invoiceTaxRates = new Map();
    for (const invoice of invoices) {
        for (const taxLine of invoice.TxnTaxDetail?.TaxLine || []) {
            const rateId = String(taxLine.TaxLineDetail?.TaxRateRef?.value ?? "");
            if (!rateId) continue;
            const entry = invoiceTaxRates.get(rateId) || { rateId, rateName: taxLine.TaxLineDetail?.TaxRateRef?.name || "", percent: taxLine.TaxLineDetail?.TaxPercent ?? null, invoices: 0, totalTax: 0 };
            entry.invoices += 1;
            entry.totalTax = Math.round((entry.totalTax + (Number(taxLine.Amount) || 0)) * 100) / 100;
            invoiceTaxRates.set(rateId, entry);
        }
    }

    for (const invoice of invoices) {
        for (const line of invoice.Line || []) {
            if (!line[LINE_DETAIL]) continue;
            totalLines += 1;
            const ref = line[LINE_DETAIL]?.TaxCodeRef;
            if (!ref || (ref.value === undefined && !ref.name)) { linesWithoutRef += 1; continue; }
            const key = `${ref.value}|${ref.name || ""}`;
            const entry = used.get(key) || { ref, count: 0, byAmount: { positive: 0, zero: 0, negative: 0, invalid: 0 }, amounts: [] };
            entry.count += 1;
            const amt = parseLineAmount(line.Amount);
            entry.byAmount[!Number.isFinite(amt) ? "invalid" : amt > 0 ? "positive" : amt < 0 ? "negative" : "zero"] += 1;
            used.set(key, entry);
        }
    }

    const usedCodes = [...used.values()].map(({ ref, count, byAmount }) => {
        const id = ref.value !== undefined ? String(ref.value) : "";
        const listed = codeById.get(id);
        const source = ref.name ? "ref-name" : (listed ? "taxcode-list" : "unresolved");
        return {
            refValue: id,
            refNameOnLine: ref.name || "",
            taxCodeListName: listed?.Name || "",
            exportedAs: ref.name || listed?.Name || id,
            source,
            lines: count,
            linesByAmount: byAmount,
            // what the ZA Tax Code column becomes for positive / zero amounts
            exportedWhenPositive: applyInvoiceTaxRules({ rawAmount: 1, taxCodeName: ref.name || listed?.Name || id, taxCodeSource: source }).exportTaxCodeName,
            exportedWhenZero: applyInvoiceTaxRules({ rawAmount: 0, taxCodeName: ref.name || listed?.Name || id, taxCodeSource: source }).exportTaxCodeName
        };
    }).sort((a, b) => b.lines - a.lines);

    const taxRatesOnInvoices = [...invoiceTaxRates.values()].map((r) => ({
        ...r,
        linkedTaxCodes: [...codeById.values()].filter((t) => rateIdsOf(t).includes(r.rateId)).map((t) => t.Name),
        canAllocateToLines: [...codeById.values()].some((t) => rateIdsOf(t).includes(r.rateId))
    }));

    const docsWithTotalTax = invoices.filter((d) => Number(d.TxnTaxDetail?.TotalTax) !== 0 && Number.isFinite(Number(d.TxnTaxDetail?.TotalTax)));
    const taxDetail = {
        documentsWithTotalTax: docsWithTotalTax.length,
        documentsWithTotalTaxButNoTaxLines: docsWithTotalTax.filter((d) => !(d.TxnTaxDetail?.TaxLine || []).length).length,
        documentsWithoutAnyTxnTaxDetail: invoices.filter((d) => !d.TxnTaxDetail).length
    };

    return {
        entity,
        taxDetail,
        invoicesScanned: invoices.length,
        taxRatesOnInvoices,
        invoiceLines: totalLines,
        linesWithoutTaxCodeRef: linesWithoutRef,
        usedTaxCodes: usedCodes,
        taxRatesInQbo: [...activeRates.map((r) => ({ ...r, _a: true })), ...inactiveRates.map((r) => ({ ...r, _a: false }))].map((r) => ({ id: String(r.Id), name: r.Name, rateValue: r.RateValue, active: r._a, agency: r.AgencyRef?.value || "" })),
        allTaxCodesInQbo: [...codeById.values()].map((t) => ({
            id: String(t.Id), name: t.Name, salesTaxRateIds: rateIdsOf(t), salesRates: (t.SalesTaxRateList?.TaxRateDetail || []).length, purchaseRates: (t.PurchaseTaxRateList?.TaxRateDetail || []).length, taxable: t.Taxable, taxGroup: t.TaxGroup, active: t.Active !== false, description: t.Description || ""
        }))
    };
};
