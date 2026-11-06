import { collectLeafRowsWithSection } from "./reportRows.js";
// Converts raw QBO API objects into a clean, region-agnostic internal
// model. Nothing downstream (mapping engine, Excel export) should ever
// read a raw QBO field name directly - everything goes through here first.
//
// Every normalizer returns a flat-ish object with predictable keys and
// safe defaults for missing/optional QBO fields, since QBO frequently
// omits fields rather than sending null.

const safe = (value, fallback = "") => (value === undefined || value === null ? fallback : value);

// Like `safe`, but also falls back on an empty string - QBO frequently
// sends "" rather than omitting a field entirely (e.g. a Bill/Invoice
// with no due date set still has a DueDate key, just set to ""), which
// `safe()`'s undefined/null-only check doesn't catch.
const safeNonEmpty = (value, fallback = "") =>
    (value === undefined || value === null || String(value).trim() === "") ? fallback : value;

const refName = (ref) => safe(ref?.name, "");
const refId = (ref) => safe(ref?.value, "");

export const normalizeAccount = (raw) => ({
    id: raw.Id,
    name: safe(raw.Name),
    fullyQualifiedName: safe(raw.FullyQualifiedName, raw.Name),
    accountNumber: safe(raw.AcctNum),
    accountType: safe(raw.AccountType),
    accountSubType: safe(raw.AccountSubType),
    classification: safe(raw.Classification),
    description: safe(raw.Description),
    active: raw.Active !== false,
    currency: safe(raw.CurrencyRef?.value, "USD"),
    parentAccountId: refId(raw.ParentRef),
    parentAccountName: refName(raw.ParentRef),
    isSubAccount: raw.SubAccount === true,
    currentBalance: safe(raw.CurrentBalance, 0)
});

export const normalizeCustomer = (raw, { terms = new Map(), paymentMethods = new Map() } = {}) => ({
    id: raw.Id,
    title: safe(raw.Title),
    displayName: safe(raw.DisplayName),
    companyName: safe(raw.CompanyName),
    firstName: safe(raw.GivenName),
    middleName: safe(raw.MiddleName),
    lastName: safe(raw.FamilyName),
    suffix: safe(raw.Suffix),
    email: safe(raw.PrimaryEmailAddr?.Address),
    phone: safe(raw.PrimaryPhone?.FreeFormNumber),
    mobile: safe(raw.Mobile?.FreeFormNumber),
    fax: safe(raw.Fax?.FreeFormNumber),
    otherPhone: safe(raw.AlternatePhone?.FreeFormNumber),
    website: safe(raw.WebAddr?.URI),
    billingLine1: safe(raw.BillAddr?.Line1),
    billingLine2: safe(raw.BillAddr?.Line2),
    billingLine3: safe(raw.BillAddr?.Line3),
    billingCity: safe(raw.BillAddr?.City),
    billingRegion: safe(raw.BillAddr?.CountrySubDivisionCode),
    billingPostalCode: safe(raw.BillAddr?.PostalCode),
    billingCountry: safe(raw.BillAddr?.Country),
    shippingLine1: safe(raw.ShipAddr?.Line1),
    shippingLine2: safe(raw.ShipAddr?.Line2),
    shippingLine3: safe(raw.ShipAddr?.Line3),
    shippingCity: safe(raw.ShipAddr?.City),
    shippingRegion: safe(raw.ShipAddr?.CountrySubDivisionCode),
    shippingPostalCode: safe(raw.ShipAddr?.PostalCode),
    shippingCountry: safe(raw.ShipAddr?.Country),
    // SalesTermRef / PaymentMethodRef usually carry only an id - resolved
    // against the Term / PaymentMethod lists fetched once per export.
    termName: safe(raw.SalesTermRef?.name, terms.get(String(raw.SalesTermRef?.value ?? "")) || ""),
    paymentMethodName: safe(raw.PaymentMethodRef?.name, paymentMethods.get(String(raw.PaymentMethodRef?.value ?? "")) || ""),
    deliveryMethod: safe(raw.PreferredDeliveryMethod),
    notes: safe(raw.Notes),
    // Not defaulted to "USD": when QBO sends no CurrencyRef the cell is left
    // blank so the destination company's own home currency applies.
    currency: safe(raw.CurrencyRef?.value, ""),
    balance: safe(raw.Balance, 0),
    active: raw.Active !== false,
    taxable: raw.Taxable !== false,
    resaleNumber: safe(raw.ResaleNum),
    printOnCheckName: safe(raw.PrintOnCheckName)
});

export const normalizeVendor = (raw) => ({
    id: raw.Id,
    displayName: safe(raw.DisplayName),
    companyName: safe(raw.CompanyName),
    firstName: safe(raw.GivenName),
    lastName: safe(raw.FamilyName),
    email: safe(raw.PrimaryEmailAddr?.Address),
    phone: safe(raw.PrimaryPhone?.FreeFormNumber),
    billingLine1: safe(raw.BillAddr?.Line1),
    billingCity: safe(raw.BillAddr?.City),
    billingRegion: safe(raw.BillAddr?.CountrySubDivisionCode),
    billingPostalCode: safe(raw.BillAddr?.PostalCode),
    billingCountry: safe(raw.BillAddr?.Country),
    currency: safe(raw.CurrencyRef?.value, "USD"),
    taxIdentifier: safe(raw.TaxIdentifier),
    balance: safe(raw.Balance, 0),
    active: raw.Active !== false,
    is1099: raw.Vendor1099 === true,
    printOnCheckName: safe(raw.PrintOnCheckName)
});

export const normalizeItem = (raw) => ({
    id: raw.Id,
    name: safe(raw.Name),
    fullyQualifiedName: safe(raw.FullyQualifiedName, raw.Name),
    type: safe(raw.Type),
    sku: safe(raw.Sku),
    description: safe(raw.Description),
    purchaseDescription: safe(raw.PurchaseDesc),
    unitPrice: safe(raw.UnitPrice, 0),
    purchaseCost: safe(raw.PurchaseCost, 0),
    incomeAccountId: refId(raw.IncomeAccountRef),
    incomeAccountName: refName(raw.IncomeAccountRef),
    expenseAccountId: refId(raw.ExpenseAccountRef),
    expenseAccountName: refName(raw.ExpenseAccountRef),
    assetAccountId: refId(raw.AssetAccountRef),
    assetAccountName: refName(raw.AssetAccountRef),
    // Full Account Names (as shown on the Accounts sheet, e.g.
    // "Fee Income:Litigation"). QBO's AccountRef.name is only the short
    // name; resolveItemAccounts() fills these from the account list.
    incomeAccountFullName: refName(raw.IncomeAccountRef),
    expenseAccountFullName: refName(raw.ExpenseAccountRef),
    assetAccountFullName: refName(raw.AssetAccountRef),
    parentItemId: refId(raw.ParentRef),
    parentItemName: refName(raw.ParentRef),
    isSubItem: raw.SubItem === true,
    categoryName: "", // filled in by resolveItemCategories() once ALL items are known
    qtyOnHand: safe(raw.QtyOnHand, 0),
    asOfDate: safe(raw.InvStartDate),
    salesTaxCodeName: refName(raw.SalesTaxCodeRef),
    purchaseTaxCodeName: refName(raw.PurchaseTaxCodeRef),
    className: refName(raw.ClassRef),
    prefVendorName: refName(raw.PrefVendorRef),
    taxable: raw.Taxable !== false,
    active: raw.Active !== false
});

// AR = Accounts Receivable. Each row is ONE transaction's OPEN BALANCE
// (not its original line items) - this matches the QBO bulk "Open
// Balance" import format, which always uses a single generic
// Product/Service line at quantity 1 to represent the whole outstanding
// amount. Invoices and Credit Memos are exported as separate sheets
// (see compositeEntities.js), each with its own template headers, so
// `docType` (set from `__recordType`, tagged by fetch.service.js) is
// used to split the fetched records rather than to flip a sign.
// AR = Accounts Receivable, built directly from QBO's own "Aged
// Receivable Detail" report (see fetch.service.js's fetchAgingRows) -
// this is QBO's own "still open" calculation for each transaction, not
// something reconstructed by us from individual Invoice/CreditMemo/
// Payment entities. `row` is the flattened, column-mapped shape
// fetchAgingRows produces (txnType, docNumber, partyName, txnDate,
// dueDate, termName, memo, amount, openBalance).
export const normalizeARAgingRow = (row) => {

    const isInvoice = /^invoice$/i.test((row.txnType || "").trim());

    return {
        // Anything the report doesn't literally call "Invoice" (a
        // Payment or Credit Memo row still showing as open) behaves
        // like a standing credit, so it's tagged the same as a Credit
        // Memo and lands on the Adjustment Note sheet (see
        // compositeEntities.js).
        docType: isInvoice ? "Invoice" : "Credit Memo",
        docNumber: safe(row.docNumber),
        txnDate: safe(row.txnDate),
        dueDate: safe(row.dueDate),
        customerName: safe(row.partyName),
        currency: safe(row.currency, "USD"),
        exchangeRate: 1,
        salesTermName: safe(row.termName),
        openBalance: Math.abs(row.openBalance || row.amount || 0)
    };

};

// AP = Accounts Payable, built directly from QBO's own "Aged Payable
// Detail" report. Mirrors normalizeARAgingRow.
export const normalizeAPAgingRow = (row) => {

    const isBill = /^bill$/i.test((row.txnType || "").trim());

    return {
        // Anything the report doesn't literally call "Bill" (a Bill
        // Payment or Vendor Credit row still showing as open) behaves
        // like a standing credit, so it's tagged the same as a Vendor
        // Credit and lands on the Bill Credit sheet (see
        // compositeEntities.js).
        docType: isBill ? "Bill" : "Vendor Credit",
        docNumber: safe(row.docNumber),
        txnDate: safe(row.txnDate),
        dueDate: safe(row.dueDate),
        vendorName: safe(row.partyName),
        currency: safe(row.currency, "USD"),
        exchangeRate: 1,
        salesTermName: safe(row.termName),
        locationName: safe(row.locationName),
        memo: safe(row.memo),
        openBalance: Math.abs(row.openBalance || row.amount || 0)
    };

};

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// QBO account types whose balance a Trial Balance would otherwise carry
// as "Trade Receivables"/"Trade Payables" - per the destination Open
// Balance template's own instruction ("Retained Earnings should always
// be placed instead of Trade Receivables or Trade Payables"), these are
// collapsed into Retained Earnings instead. This is standard migration
// practice here because the AR/AP control account balance gets rebuilt
// automatically when the detailed open Invoices/Bills are imported
// separately (see the ar/ap modules) - carrying the SAME balance again
// under the real AR/AP account name in the opening journal would double
// it up. Parking it in Retained Earnings instead keeps the opening
// journal's total at zero without recreating that balance a second time.
const CONTROL_ACCOUNT_TYPES_TO_COLLAPSE = new Set(["Accounts Receivable", "Accounts Payable"]);

// Open Balance = one line per account in the opening trial-balance
// journal, built directly from QBO's own "Trial Balance" report (see
// fetch.service.js's fetchOpenBalance) as of the conversion cutoff date.
// `row` is { accountName, accountType, debit, credit }. Accounts with a
// net-zero balance are dropped entirely - there's nothing to migrate for
// them, and the exported journal would carry a pointless $0 line.
export const normalizeOpenBalanceRows = (rows, asOfDate) => {

    return rows
        .map((row) => {

            const amount = round2((row.debit || 0) - (row.credit || 0));
            if (amount === 0) return null;

            const isControlAccount = CONTROL_ACCOUNT_TYPES_TO_COLLAPSE.has(row.accountType);

            return {
                journalNo: "Opening Balance",
                journalDate: safe(asOfDate),
                accountName: isControlAccount ? "Retained Earnings" : safe(row.accountName),
                originalAccountName: safe(row.accountName),
                accountType: safe(row.accountType),
                collapsedFromControlAccount: isControlAccount,
                amount,
                currency: "",
                exchangeRate: 1
            };

        })
        .filter(Boolean);

};

// Bill (Detailed Transactions) - unlike the "ap" module's Bill sub-sheet
// (one summary row per bill, its open balance), this flattens EVERY Bill
// into one row PER LINE, carrying full transaction detail. A Bill's Line
// array mixes two detail types - an AccountBasedExpenseLineDetail (a
// plain expense posted to an Account) or an ItemBasedExpenseLineDetail
// (a Product/Service with its own quantity/rate) - other line types
// (SubTotalLineDetail, DescriptionOnly) carry no postable amount and are
// skipped. `lineType` ("Account"/"Item") records which kind each row
// came from, so the mapping config can waive the Account/Product-Service
// requirement on whichever column doesn't apply to that row (see
// requiredUnless in mapping.service.js) instead of flagging real rows as
// falsely invalid.
//
// `docNumber` is left as whatever QBO actually has (often blank) -
// filling blanks and resolving duplicate numbers against the real QBO
// transaction id happens in flatten.service.js's
// assignBillTransactionNumbers, which needs the FULL set of fetched
// bills to detect cross-transaction duplicates, not just one record at
// a time.
const LINE_DETAIL_TYPES = new Set(["AccountBasedExpenseLineDetail", "ItemBasedExpenseLineDetail"]);

export const normalizeBillDetailRecords = (rawBills, { accounts = [], items = [], taxCodes = new Map(), customers = new Map(), onTaxIssue = null, onTaxAmountIssue = null } = {}) => {

    const accountsById = new Map(accounts.filter((a) => a.id).map((a) => [String(a.id), a]));
    const itemsById = new Map(items.filter((i) => i.id).map((i) => [String(i.id), i]));

    const rows = [];

    for (const bill of rawBills) {

        const txnId = String(bill.Id);
        const vendorName = refName(bill.VendorRef);
        const billDate = safe(bill.TxnDate);
        const dueDate = safeNonEmpty(bill.DueDate, billDate);
        const currency = safe(bill.CurrencyRef?.value, "");
        const exchangeRate = safe(bill.ExchangeRate, 1);
        const termName = refName(bill.SalesTermRef);
        const locationName = refName(bill.DepartmentRef);

        const lines = (bill.Line || []).filter((line) => LINE_DETAIL_TYPES.has(line.DetailType));
        const billStart = rows.length;
        let unlinked = false;

        for (const line of lines) {

            const isItemLine = line.DetailType === "ItemBasedExpenseLineDetail";
            const detail = isItemLine ? line.ItemBasedExpenseLineDetail : line.AccountBasedExpenseLineDetail;

            const account = detail?.AccountRef?.value ? accountsById.get(String(detail.AccountRef.value)) : null;
            const accountName = account?.fullyQualifiedName || refName(detail?.AccountRef);

            const item = detail?.ItemRef?.value ? itemsById.get(String(detail.ItemRef.value)) : null;
            // On a purchase-side line, an item-based line with no account
            // of its own falls back to that item's own purchase/expense
            // account, when QBO has one configured for it.
            const itemFallbackAccountName = item?.expenseAccountName || "";
            const productServiceName = item?.fullyQualifiedName || refName(detail?.ItemRef);

            let quantity = isItemLine ? Number(detail?.Qty) : NaN;
            if (!Number.isFinite(quantity) || quantity === 0) quantity = 1;
            quantity = Math.abs(quantity);

            const amount = Number(line.Amount) || 0;
            const rate = quantity ? round2(amount / quantity) : amount;

            const description = safe(line.Description) || productServiceName || accountName || "";

            // Customer / Job of the line: the ref name, else the Customer list (full "Customer:Job" name).
            const customerRef = detail?.CustomerRef;
            const customerJob = customerRef?.name || (customerRef?.value !== undefined ? customers.get(String(customerRef.value)) || "" : "");

            rows.push({
                txnId,
                docNumber: safe(bill.DocNumber),
                memo: safe(bill.PrivateNote),
                // Account-based lines fill the Expense side, item-based lines the Product & Service side.
                itemName: isItemLine ? productServiceName : "",
                itemDescription: isItemLine ? description : "",
                itemTaxCodeName: "",
                itemTaxAmount: "",
                expenseCustomerJob: isItemLine ? "" : customerJob,
                itemCustomerJob: isItemLine ? customerJob : "",
                customerJobUnresolved: Boolean(customerRef?.value !== undefined && !customerJob),
                vendorName,
                billDate,
                dueDate,
                globalTaxCalculation: "TaxExcluded",
                lineType: isItemLine ? "Item" : "Account",
                accountName: accountName || itemFallbackAccountName,
                description,
                amount,
                // Tax CODE: the line's TaxCodeRef (usually only an id) resolved against the TaxCode
                // list. Tax AMOUNT: QBO only gives tax per rate in the Bill's TxnTaxDetail, so it is
                // allocated over the lines after this loop (same engine as Expense / Purchase Order).
                ...resolveLineTaxCode(detail?.TaxCodeRef, taxCodes, { invoice: bill, onTaxIssue }),
                taxAmount: 0,
                taxAmountSource: "none",
                className: refName(detail?.ClassRef),
                locationName,
                termName,
                currency,
                exchangeRate,
                sku: safe(item?.sku),
                serviceDate: safe(detail?.ServiceDate),
                productServiceName,
                quantity,
                rate
            });

        }

        // ZA team rule: VAT amount present -> "Standard", zero -> "Out of Scope"; when the Bill's tax could
        // not be linked to its lines the source tax code is kept (never a wrong "Out of Scope").
        allocateInvoiceTaxAmounts(bill, rows.slice(billStart), taxCodes, (issue) => {
            unlinked = true;
            if (onTaxAmountIssue) onTaxAmountIssue(issue);
        }, ["purchaseRateIds", "salesRateIds"]);

        rows.slice(billStart).forEach((row) => {
            Object.assign(row, applyCreditNoteTaxRule({ taxAmount: row.taxAmount, taxAmountResolved: !unlinked, sourceTaxCodeName: row.taxCodeName }));
            if (row.lineType === "Item") {
                row.itemTaxCodeName = row.exportTaxCodeName;
                row.itemTaxAmount = row.taxAmount;
            }
        });

    }

    return rows;

};

// Invoice (Detailed Transactions) - mirrors normalizeBillDetailRecords on
// the sales side: flattens every Invoice into one row PER LINE, carrying
// full product/service, tax and discount detail. QBO Invoice lines are
// item-based only (DetailType "SalesItemLineDetail") - other line types
// (SubTotalLineDetail, DiscountLineDetail, DescriptionOnly,
// SalesTaxLineDetail) carry no per-item row and are skipped, except
// DiscountLineDetail, which is read once per invoice (its
// DiscountPercent/Amount is an invoice-wide figure, not per line) and
// then applied to every line row, the same way DueDate is.
//
// `docNumber` is left as whatever QBO has (often blank) - the fill +
// duplicate-concat pass happens in flatten.service.js's
// assignTransactionNumbers, same as billDetail, with a 21-character cap
// here per this template's own note ("QBO has a limit of 21 characters
// in Invoice Number").
// Resolves a line's TaxCodeRef into the destination tax code NAME.
//   ref.name present        -> use it (source = "ref-name")
//   ref.value, found in list -> TaxCode.Name   (source = "taxcode-list")
//   ref.value, NOT found     -> the raw value, flagged (source = "unresolved")
//                               - never silently replaced with "Out of Scope"
//   no ref                   -> "" (source = "absent"); the mapping default applies
export const resolveLineTaxCode = (ref, taxCodes, { invoice, onTaxIssue } = {}) => {

    const id = ref?.value !== undefined && ref?.value !== null ? String(ref.value) : "";

    if (!id && !ref?.name) return { taxCodeName: "", taxCodeId: "", taxCodeSource: "absent" };

    if (ref?.name) return { taxCodeName: String(ref.name), taxCodeId: id, taxCodeSource: "ref-name" };

    const hit = taxCodes.get(id);
    if (hit) return { taxCodeName: hit.name, taxCodeId: id, taxCodeSource: "taxcode-list" };

    if (onTaxIssue) onTaxIssue({ invoiceId: invoice?.Id, docNumber: invoice?.DocNumber, taxCodeId: id });
    return { taxCodeName: id, taxCodeId: id, taxCodeSource: "unresolved" };

};

// Business rules for the exported Invoice tax code (ZA), applied PER LINE on
// top of the resolved SOURCE tax code (taxCodeName is never overwritten):
//   1. line amount > 0 AND the source tax code is "S"  -> "Standard"
//   2. line amount is exactly 0                         -> "Out of Scope"
//   3. anything else (other codes, negative amounts, missing/invalid amount,
//      missing or unresolved tax code)                  -> the source tax code
//      unchanged (blank stays blank, so the mapping's own default applies)
// "S" is identified from the real TaxCode name (taxCodeSource must be
// "ref-name" or "taxcode-list"), never from the amount.
export const INVOICE_TAX_RULES = Object.freeze({
    standardSourceCode: "S",
    standardExportName: "Standard",
    zeroAmountExportName: "Out of Scope"
});

// Strict amount parsing: only real numbers / numeric strings count. Anything
// else (undefined, null, "", "abc", NaN) is INVALID - it is never treated as 0.
export const parseLineAmount = (raw) => {
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
    if (typeof raw === "string" && raw.trim() !== "") return Number(raw.trim());
    return NaN;
};

export const applyInvoiceTaxRules = ({ rawAmount, taxCodeName, taxCodeSource }) => {

    const amount = parseLineAmount(rawAmount);

    if (!Number.isFinite(amount)) {
        return { exportTaxCodeName: taxCodeName, taxRule: "kept-invalid-amount" };
    }

    if (amount === 0) {
        return { exportTaxCodeName: INVOICE_TAX_RULES.zeroAmountExportName, taxRule: "zero-amount" };
    }

    const sourceKnown = taxCodeSource === "ref-name" || taxCodeSource === "taxcode-list";

    if (amount > 0 && sourceKnown && String(taxCodeName).trim() === INVOICE_TAX_RULES.standardSourceCode) {
        return { exportTaxCodeName: INVOICE_TAX_RULES.standardExportName, taxRule: "S-positive-standard" };
    }

    return { exportTaxCodeName: taxCodeName, taxRule: "kept-source" };

};

// Per-line Tax Amount. QBO does NOT expose tax per line - it only gives the
// invoice's own tax totals per tax RATE in TxnTaxDetail.TaxLine[]
// ({ Amount, TaxLineDetail: { TaxRateRef, TaxPercent, NetAmountTaxable } }).
// So each rate's Amount is allocated over the lines whose TaxCode uses that rate
// (TaxCode.SalesTaxRateList), proportionally to the line amounts, in whole cents
// with any rounding remainder put on the largest line - so the lines of an
// invoice add up EXACTLY to QBO's own tax total for that rate.
//   - lines that don't use the rate (zero-rated, exempt, out of scope) get 0
//   - a rate whose tax cannot be linked to any line (TaxCode rate list missing,
//     no eligible line, weights summing to 0) is reported through
//     onTaxAmountIssue and NOT guessed.
export const allocateInvoiceTaxAmounts = (invoice, invoiceRows, taxCodes, onTaxAmountIssue = null, rateListKey = "salesRateIds") => {

    const taxLines = (invoice.TxnTaxDetail?.TaxLine || []).filter(
        (t) => t?.TaxLineDetail?.TaxRateRef?.value !== undefined && Number.isFinite(Number(t.Amount))
    );

    let allocatedCents = 0;
    let unlinkedCents = 0;
    const unlinkedLines = [];

    const usable = (row) => Number.isFinite(row.amount) && row.amount !== 0;
    const listsOf = (code) => [].concat(rateListKey).flatMap((k) => code?.[k] || []);
    const codeOf = (row) => (row.taxCodeId ? taxCodes.get(String(row.taxCodeId)) : null);

    // Shares `totalCents` of tax across `eligible` rows proportionally to their amounts
    // (cent-exact, remainder to the largest line) and records how it was linked.
    const spread = (totalCents, eligible, linkedBy) => {
        const weightSum = eligible.reduce((sum, row) => sum + row.amount, 0);
        const shares = eligible.map((row) => Math.round((totalCents * row.amount) / weightSum));
        const diff = totalCents - shares.reduce((a, b) => a + b, 0);
        if (diff !== 0) {
            let big = 0;
            eligible.forEach((row, i) => { if (Math.abs(row.amount) > Math.abs(eligible[big].amount)) big = i; });
            shares[big] += diff;
        }
        eligible.forEach((row, i) => {
            row.taxAmount = round2((Math.round(row.taxAmount * 100) + shares[i]) / 100);
            row.taxAmountSource = linkedBy;
        });
        allocatedCents += totalCents;
    };

    for (const taxLine of taxLines) {

        const rateId = String(taxLine.TaxLineDetail.TaxRateRef.value);
        const totalCents = Math.round(Number(taxLine.Amount) * 100);
        if (totalCents === 0) continue;

        let eligible = invoiceRows.filter((row) => listsOf(codeOf(row)).includes(rateId) && codeOf(row) && usable(row));
        let linkedBy = "txn-tax-line";

        // The TaxLine's rate id is not in any line's TaxCode rate list (QBO can keep newer/older
        // rate versions on transactions, e.g. TaxLine rate 58 vs the code's rate 42). Fall back to the
        // rate's PERCENT: a line is eligible only if ITS OWN tax code carries a rate with that exact
        // percent (TaxRate.RateValue == TaxLine.TaxPercent). Never inferred from amounts alone.
        if (!eligible.length) {
            const percent = Number(taxLine.TaxLineDetail?.TaxPercent);
            if (Number.isFinite(percent) && percent !== 0) {
                eligible = invoiceRows.filter((row) => (codeOf(row)?.ratePercents || []).some((p) => Math.abs(p - percent) < 1e-9) && usable(row));
                linkedBy = "txn-tax-line-by-percent";
            }
        }

        if (!eligible.length || eligible.reduce((sum, row) => sum + row.amount, 0) === 0) {
            unlinkedLines.push({ taxLine, rateId, totalCents });
            continue;
        }

        spread(totalCents, eligible, linkedBy);
    }

    // Last resort, only when EXACTLY ONE non-zero tax line is still unlinked: it belongs to the
    // lines whose own tax code is taxable and is NOT claimed by any other tax line of this document
    // (e.g. the zero-rated "Out of Scope" code that owns the 0% line). It is accepted ONLY if it
    // verifies: base x TaxLine.TaxPercent must reproduce the tax amount (within rounding) - so tax
    // is never guessed from amounts alone, and tax-inclusive / mixed cases simply stay unlinked.
    if (unlinkedLines.length === 1) {
        const { taxLine, rateId, totalCents } = unlinkedLines[0];
        const percent = Number(taxLine.TaxLineDetail?.TaxPercent);
        if (Number.isFinite(percent) && percent > 0) {
            const claimed = new Set();
            for (const other of taxLines) {
                if (other === taxLine) continue;
                const otherRate = String(other.TaxLineDetail.TaxRateRef.value);
                invoiceRows.forEach((row) => { if (listsOf(codeOf(row)).includes(otherRate)) claimed.add(String(row.taxCodeId)); });
            }
            const eligible = invoiceRows.filter((row) => {
                const code = codeOf(row);
                return code && code.taxable !== false && !claimed.has(String(row.taxCodeId)) && !listsOf(code).includes(rateId) && usable(row);
            });
            const base = eligible.reduce((sum, row) => sum + row.amount, 0);
            const expectedCents = Math.round(base * percent);   // base * percent / 100 in cents
            if (eligible.length && Math.abs(expectedCents - totalCents) <= Math.max(5, eligible.length)) {
                spread(totalCents, eligible, "txn-tax-line-verified-by-percent");
                unlinkedLines.length = 0;
            }
        }
    }

    unlinkedLines.forEach((u) => { unlinkedCents += u.totalCents; });

    // The document says it carries tax (TotalTax <> 0) but NOTHING could be allocated
    // (no TaxLine[] in the response, or none linkable): that tax is "unlinked" too,
    // so callers never mistake it for "no VAT".
    const docTotalCents = Number.isFinite(Number(invoice.TxnTaxDetail?.TotalTax)) ? Math.round(Number(invoice.TxnTaxDetail.TotalTax) * 100) : 0;
    if (allocatedCents === 0 && unlinkedCents === 0 && docTotalCents !== 0) unlinkedCents = docTotalCents;

    if (unlinkedCents !== 0 && onTaxAmountIssue) {
        // Cause detail (why the tax could not be linked) - used only in warnings.
        const lineCodes = [...new Map(invoiceRows.filter((r) => r.taxCodeId).map((r) => {
            const code = taxCodes.get(String(r.taxCodeId));
            return [String(r.taxCodeId), `${r.taxCodeId}(${r.taxCodeName || code?.name || "?"}):${code ? `inList sales=[${(code.salesRateIds || []).join(",")}] purchase=[${(code.purchaseRateIds || []).join(",")}] percents=[${(code.ratePercents || []).join(",")}]` : "NOT-in-TaxCode-list"}`];
        })).values()];
        onTaxAmountIssue({
            invoiceId: invoice.Id, docNumber: invoice.DocNumber, unlinkedTax: unlinkedCents / 100,
            taxLines: (invoice.TxnTaxDetail?.TaxLine || []).map((t) => `${t?.TaxLineDetail?.TaxRateRef?.value ?? "no-rate"}:${t?.Amount}@${t?.TaxLineDetail?.TaxPercent ?? "?"}%`),
            lineCodes
        });
    }

    return { allocated: allocatedCents / 100, unlinked: unlinkedCents / 100 };

};

export const normalizeInvoiceDetailRecords = (rawInvoices, { items = [], taxCodes = new Map(), onTaxIssue = null, onTaxAmountIssue = null } = {}) => {

    const itemsById = new Map(items.filter((i) => i.id).map((i) => [String(i.id), i]));

    const rows = [];

    for (const invoice of rawInvoices) {

        const txnId = String(invoice.Id);
        const customerName = refName(invoice.CustomerRef);
        const invoiceDate = safe(invoice.TxnDate);
        const dueDate = safeNonEmpty(invoice.DueDate, invoiceDate);
        const currency = safe(invoice.CurrencyRef?.value, "");
        const exchangeRate = safe(invoice.ExchangeRate, 1);
        const termName = refName(invoice.SalesTermRef);
        const customerMemo = safe(invoice.CustomerMemo?.value);
        const privateNote = safe(invoice.PrivateNote);

        const lines = invoice.Line || [];

        const discountLine = lines.find((line) => line.DetailType === "DiscountLineDetail");
        const discountPercent = safe(discountLine?.DiscountLineDetail?.DiscountPercent, "");

        const itemLines = lines.filter((line) => line.DetailType === "SalesItemLineDetail");

        const invoiceStart = rows.length;

        for (const line of itemLines) {

            const detail = line.SalesItemLineDetail || {};

            const item = detail.ItemRef?.value ? itemsById.get(String(detail.ItemRef.value)) : null;
            const productServiceName = item?.fullyQualifiedName || refName(detail.ItemRef);

            let quantity = Number(detail.Qty);
            if (!Number.isFinite(quantity) || quantity === 0) quantity = 1;
            quantity = Math.abs(quantity);

            const amount = Number(line.Amount) || 0;
            const rate = quantity ? round2(amount / quantity) : amount;

            const description = safe(line.Description) || productServiceName || "";

            rows.push({
                txnId,
                docNumber: safe(invoice.DocNumber),
                customerName,
                invoiceDate,
                dueDate,
                globalTaxCalculation: "TaxExcluded",
                serviceDate: safe(detail.ServiceDate),
                productServiceName,
                description,
                quantity,
                rate,
                amount,
                // Per-line tax AMOUNT isn't exposed by QBO the way this
                // template wants it (tax lives on the Invoice's
                // TxnTaxDetail, not allocated per line) - starts at 0 and is
                // filled by allocateInvoiceTaxAmounts() after the loop.
                //
                // Tax CODE: SalesItemLineDetail.TaxCodeRef normally carries
                // only the TaxCode Id (`value`), usually WITHOUT a `name`,
                // so it is resolved against the TaxCode list. When the line
                // has no TaxCodeRef at all the value stays "" and the
                // mapping's own "Out of Scope" default applies.
                ...(() => {
                    const resolved = resolveLineTaxCode(detail.TaxCodeRef, taxCodes, { invoice, onTaxIssue });
                    return { ...resolved, ...applyInvoiceTaxRules({ rawAmount: line.Amount, taxCodeName: resolved.taxCodeName, taxCodeSource: resolved.taxCodeSource }) };
                })(),
                taxAmount: 0,
                taxAmountSource: "none",
                className: refName(detail.ClassRef),
                customerMemo,
                privateNote,
                sku: safe(item?.sku),
                termName,
                discountPercent,
                currency,
                exchangeRate
            });

        }

        // Tax Amount per line = QBO's own TxnTaxDetail total per rate, allocated.
        allocateInvoiceTaxAmounts(invoice, rows.slice(invoiceStart), taxCodes, onTaxAmountIssue);

    }

    return rows;

};

// Shared: the payment's account as a FULL account name from the Accounts list.
const fullAccountName = (ref, accountById) => {
    if (ref?.value === undefined) return { name: "", source: "none" };
    const acct = accountById.get(String(ref.value));
    return { name: acct?.fullyQualifiedName || acct?.name || safe(ref?.name, ""), source: acct ? "account-list" : (ref?.name ? "ref-name" : "unresolved") };
};

// Invoice Credit Note Allocation: QBO Payments that apply a Credit Memo (or a Journal Entry) - one row per
// Line -> linked transaction, in the team's allocation layout. The row's amount (Line.Amount) belongs to
// the linked transaction named in `appliedType` (Invoice / CreditMemo / JournalEntry); only that
// transaction's own number column is filled. Numbers are the ones the Invoice, Credit Note and Journal
// sheets export (maps built over ALL documents), never invented: an unknown id falls back to the id.
export const normalizeInvoiceCreditAllocationRecords = (rawPayments, { invoiceNumbers = new Map(), creditNoteNumbers = new Map(), journalNumbers = new Map(), accounts = [], creditNotePrefixToStrip = "" } = {}) => {

    // Team rule: the Credit Note number carries no prefix such as "CN-" (13074, not CN-13074).
    const stripPrefix = (value) => {
        const prefix = String(creditNotePrefixToStrip || "");
        return prefix && String(value).toLowerCase().startsWith(prefix.toLowerCase()) && String(value).length > prefix.length ? String(value).slice(prefix.length) : value;
    };

    const accountById = new Map(accounts.map((a) => [String(a.id), a]));
    const undeposited = accounts.find((a) => a.accountSubType === "UndepositedFunds");
    const rows = [];

    for (const payment of rawPayments) {

        const allLinks = (payment.Line || []).flatMap((l) => l.LinkedTxn || []);
        if (!allLinks.some((t) => t.TxnType === "CreditMemo" || isJournalType(t.TxnType))) continue;

        let deposit = fullAccountName(payment.DepositToAccountRef, accountById);
        if (!deposit.name && undeposited) deposit = { name: undeposited.fullyQualifiedName || undeposited.name, source: "undeposited-funds-default" };

        for (const line of payment.Line || []) {
            for (const link of line.LinkedTxn || []) {

                const id = String(link.TxnId);
                const type = String(link.TxnType || "");
                const numberOf = (map) => map.get(id) || id;

                rows.push({
                    txnId: String(payment.Id),
                    docNumber: safe(payment.PaymentRefNum),
                    paymentDate: safe(payment.TxnDate),
                    customerName: refName(payment.CustomerRef),
                    depositAccountName: deposit.name,
                    depositSource: deposit.source,
                    memo: safe(payment.PrivateNote),
                    currency: safe(payment.CurrencyRef?.value, ""),
                    exchangeRate: payment.CurrencyRef?.value ? safe(payment.ExchangeRate, 1) : "",
                    totalAmount: Number(payment.TotalAmt) || 0,
                    amount: Number(line.Amount) || 0,
                    // ONE combined number column (team): the number of the linked Invoice, Journal or Credit Note.
                    voucherNo: type === "Invoice" ? numberOf(invoiceNumbers)
                        : type === "CreditMemo" ? stripPrefix(numberOf(creditNoteNumbers))
                            : isJournalType(type) ? numberOf(journalNumbers) : id,
                    invoiceNumber: type === "Invoice" ? numberOf(invoiceNumbers) : "",
                    journalNumber: isJournalType(type) ? numberOf(journalNumbers) : "",
                    creditNoteNumber: type === "CreditMemo" ? stripPrefix(numberOf(creditNoteNumbers)) : "",
                    appliedType: type,
                    linkedNumberSource: (type === "Invoice" ? invoiceNumbers : type === "CreditMemo" ? creditNoteNumbers : isJournalType(type) ? journalNumbers : new Map()).has(id) ? "document-list" : "unresolved"
                });

            }
        }

    }

    return rows;

};

// Bill Payment: QBO BillPayments applied to Bills - one row per Line -> linked Bill. Lines linked to
// anything else (a VendorCredit) are not payments of a bill: they are reported through onSkip and are
// covered by the Bill Credit Note Allocation module. Bill No = the number the Bill sheet exports.
export const normalizeBillPaymentRecords = (rawBillPayments, { billNumbers = new Map(), journalNumbers = new Map(), accounts = [], onSkip = null } = {}) => {

    const accountById = new Map(accounts.map((a) => [String(a.id), a]));
    const rows = [];

    for (const payment of rawBillPayments) {

        const account = fullAccountName(payment.PayType === "CreditCard" ? payment.CreditCardPayment?.CCAccountRef : payment.CheckPayment?.BankAccountRef, accountById);

        for (const line of payment.Line || []) {

            const links = line.LinkedTxn || [];
            const billLinks = links.filter((l) => l.TxnType === "Bill");
            const journalLinks = links.filter((l) => isJournalType(l.TxnType));
            const link = billLinks[0] || journalLinks[0];

            if (!link) {
                if (onSkip && links.length) onSkip({ reason: "non-bill-link", paymentId: payment.Id, types: links.map((l) => l.TxnType) });
                continue;
            }
            // One line has ONE Amount: with several Bill links only the first is exported (the others are reported).
            if (billLinks.length > 1 && onSkip) onSkip({ reason: "extra-bill-links-not-exported", paymentId: payment.Id, types: billLinks.slice(1).map((l) => l.TxnType) });

            const isJournal = !billLinks.length;
            const billId = isJournal ? "" : String(link.TxnId);
            // A Journal link on the same line as a Bill is that bill's payment journal.
            const journalId = isJournal ? String(link.TxnId) : (journalLinks.length ? String(journalLinks[0].TxnId) : "");
            const journalKnown = journalId ? journalNumbers.get(journalId) : "";

            rows.push({
                txnId: String(payment.Id),
                docNumber: safe(payment.DocNumber),
                paymentDate: safe(payment.TxnDate),
                memo: safe(payment.PrivateNote),
                vendorName: refName(payment.VendorRef),
                accountName: account.name,
                accountSource: account.source,
                amount: Number(line.Amount) || 0,
                billNumber: isJournal ? "" : (billNumbers.get(billId) || billId),
                billNumberSource: isJournal ? "not-applicable" : (billNumbers.has(billId) ? "bill-list" : "unresolved"),
                journalNumber: journalId ? (journalKnown || journalId) : "",
                journalNumberSource: journalId ? (journalKnown ? "journal-list" : "unresolved") : "not-applicable",
                transactionType: isJournal ? "JournalEntry" : "Bill",
                payType: safe(payment.PayType),
                currency: safe(payment.CurrencyRef?.value, ""),
                exchangeRate: payment.CurrencyRef?.value ? safe(payment.ExchangeRate, 1) : ""
            });

        }

    }

    return rows;

};

// Bill Credit (Supplier Credit): QBO VendorCredits have the same line structure as Bills (account-based and
// item-based lines, TxnTaxDetail), so they go through the Bill engine: tax code from the TaxCode list,
// tax amount from the TxnTaxDetail allocation, ZA rule VAT present -> Standard / zero -> Out of Scope.
// A VendorCredit has no due date or terms (those stay blank / unused).
export const normalizeBillCreditRecords = (rawVendorCredits, options = {}) =>
    normalizeBillDetailRecords(rawVendorCredits, options).map((row) => ({ ...row, termName: "", dueDate: "" }));

// Bill Credit Note Allocation: QBO BillPayments that apply a Vendor Credit - one row per Line -> linked
// transaction (Bill or VendorCredit), in the team's allocation layout (their example sheet lists every
// bill AND the vendor credit of the payment). Voucher No = the number of the linked Bill / Vendor Credit;
// Txn Type = the QBO type (Bill / VendorCredit); TotalAmount = the payment's TotalAmt; Line Amount = Line.Amount.
export const normalizeBillCreditAllocationRecords = (rawBillPayments, { billNumbers = new Map(), vendorCreditNumbers = new Map(), accounts = [] } = {}) => {

    const accountById = new Map(accounts.map((a) => [String(a.id), a]));
    const rows = [];

    for (const payment of rawBillPayments) {

        const allLinks = (payment.Line || []).flatMap((l) => l.LinkedTxn || []);
        if (!allLinks.some((t) => t.TxnType === "VendorCredit")) continue;

        const account = fullAccountName(payment.PayType === "CreditCard" ? payment.CreditCardPayment?.CCAccountRef : payment.CheckPayment?.BankAccountRef, accountById);

        for (const line of payment.Line || []) {
            for (const link of line.LinkedTxn || []) {

                const id = String(link.TxnId);
                const type = String(link.TxnType || "");
                const map = type === "Bill" ? billNumbers : type === "VendorCredit" ? vendorCreditNumbers : new Map();

                rows.push({
                    txnId: String(payment.Id),
                    docNumber: safe(payment.DocNumber),
                    paymentDate: safe(payment.TxnDate),
                    vendorName: refName(payment.VendorRef),
                    accountName: account.name,
                    accountSource: account.source,
                    memo: safe(payment.PrivateNote),
                    currency: safe(payment.CurrencyRef?.value, ""),
                    exchangeRate: payment.CurrencyRef?.value ? safe(payment.ExchangeRate, 1) : "",
                    totalAmount: Number(payment.TotalAmt) || 0,
                    amount: Number(line.Amount) || 0,
                    voucherNo: map.get(id) || id,
                    txnType: type,
                    linkedNumberSource: map.has(id) ? "document-list" : "unresolved"
                });

            }
        }

    }

    return rows;

};

// ---- Other Journal Types (QBO Journal report) -----------------------------------------------------
// The Journal report lists every transaction as journal lines: Date, Transaction Type, Num, Name,
// Memo/Description, Account, Debit, Credit (plus Class when requested). The cells are located by their
// COLUMN TITLE, never by position, so extra / reordered columns cannot shift the data.
const reportNumber = (value) => {
    const n = parseFloat(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
};

export const parseJournalReportLines = (report) => {

    const titles = (report?.Columns?.Column || []).map((c) => String(c.ColTitle || c.ColType || "").trim().toLowerCase());
    const indexOf = (...names) => titles.findIndex((t) => names.includes(t));
    const col = {
        date: indexOf("date"),
        type: indexOf("transaction type", "type"),
        num: indexOf("num", "no.", "no", "doc num"),
        name: indexOf("name"),
        memo: indexOf("memo/description", "memo", "description"),
        account: indexOf("account", "account name"),
        debit: indexOf("debit"),
        credit: indexOf("credit"),
        klass: indexOf("class")
    };
    const text = (cells, i) => (i >= 0 ? String(cells[i]?.value ?? "").trim() : "");

    return collectLeafRowsWithSection(report?.Rows).map(({ row, sectionIndex }) => {
        const cells = row.ColData || [];
        return {
            sectionIndex,
            date: text(cells, col.date),
            txnType: text(cells, col.type),
            txnId: col.type >= 0 && cells[col.type]?.id !== undefined ? String(cells[col.type].id) : "",
            num: text(cells, col.num),
            name: text(cells, col.name),
            memo: text(cells, col.memo),
            accountName: text(cells, col.account),
            accountId: col.account >= 0 && cells[col.account]?.id !== undefined ? String(cells[col.account].id) : "",
            debit: reportNumber(text(cells, col.debit)),
            credit: reportNumber(text(cells, col.credit)),
            className: text(cells, col.klass)
        };
    }).filter((l) => l.date || l.txnType || l.accountName);

};

// Other Journal Types: keeps only the lines of the wanted transaction types and turns every TRANSACTION into
// its own journal ("each type is created separately"). A transaction = one report Section, or the same
// transaction id, or (when the report has neither) the same date + type + num + name.
//   Journal No = <date as a number YYYYMMDD>_<Num>   (just the date number when the transaction has no Num);
//   different transactions that still get the same number are told apart with _2, _3 ...; max 21 characters
//   (only the Num part is cut). Amount = Debit - Credit.
export const normalizeOtherJournalRecords = (lines, { types = [], accounts = [], onSummary = null } = {}) => {

    const wanted = new Map(types.map((t) => [String(t).trim().toLowerCase(), t]));
    const accountById = new Map(accounts.map((a) => [String(a.id), a]));
    const seenTypes = {};
    const groups = new Map();

    for (const line of lines) {
        const key = String(line.txnType || "").trim().toLowerCase();
        seenTypes[line.txnType || "(blank)"] = (seenTypes[line.txnType || "(blank)"] || 0) + 1;
        if (!wanted.has(key)) continue;
        const groupKey = line.sectionIndex >= 0 ? `s${line.sectionIndex}` : (line.txnId ? `${key}#${line.txnId}` : `${line.date}|${key}|${line.num}|${line.name}`);
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(line);
    }

    const MAX = 21;
    const used = new Set();
    const rows = [];
    let unbalanced = 0;

    for (const group of groups.values()) {

        const head = group[0];
        const datePart = String(head.date).replace(/\D/g, "").slice(0, 8);
        const num = head.num.replace(/\s+/g, " ").trim();
        const fit = (suffix) => {
            const prefix = num ? `${datePart}_` : datePart;
            const room = Math.max(0, MAX - prefix.length - suffix.length);
            return `${prefix}${num ? num.slice(0, room) : ""}${suffix}`.slice(0, MAX);
        };
        let docNumber = fit("");
        for (let n = 2; used.has(docNumber.toLowerCase()); n += 1) docNumber = fit(`_${n}`);
        used.add(docNumber.toLowerCase());

        const transactionTotal = group.reduce((sum, l) => sum + Math.round((l.debit - l.credit) * 100), 0);
        if (transactionTotal !== 0) unbalanced += 1;

        for (const line of group) {
            const acct = line.accountId ? accountById.get(line.accountId) : null;
            rows.push({
                txnId: docNumber,
                docNumber,
                txnType: wanted.get(String(line.txnType).trim().toLowerCase()),
                journalDate: line.date,
                memo: "",
                accountName: acct?.fullyQualifiedName || line.accountName,
                amount: Math.round((line.debit - line.credit) * 100) / 100,
                description: line.memo,
                entityName: line.name,
                className: line.className,
                currency: "",
                exchangeRate: ""
            });
        }

    }

    if (onSummary) onSummary({ seenTypes, transactions: groups.size, lines: rows.length, unbalanced });

    return rows;

};

// QBO exposes up to three custom fields per sales/purchase transaction as CustomField[]
// ({ Name, StringValue }). The "CustomFieldPONumber" column is the one named like
// "P.O. Number" / "PO Number" / "PO No"; blank when the company has no such field.
const PO_NUMBER_FIELD = /^\s*p\.?\s*o\.?\s*(number|no\.?|num\.?|#)?\s*$/i;
const customFieldPoNumber = (doc) => {
    const field = (doc.CustomField || []).find((f) => PO_NUMBER_FIELD.test(String(f?.Name || "")));
    return field ? safe(field.StringValue, "") : "";
};

// Estimates: one row per SalesItemLine of each QBO Estimate ("QBo (New)" Estimates layout).
// Same line logic as the invoice / credit note rows (qty blank or 0 -> 1, rate = amount / qty).
// Tax rule (ZA team rule): line VAT amount present -> "Standard", zero -> "Out of Scope"; when the
// estimate's tax could not be linked to its lines the source tax code is kept (never guessed).
export const normalizeEstimateRecords = (rawEstimates, { items = [], taxCodes = new Map(), onTaxIssue = null, onTaxAmountIssue = null } = {}) => {

    const itemsById = new Map(items.filter((i) => i.id).map((i) => [String(i.id), i]));
    const rows = [];

    for (const estimate of rawEstimates) {

        const txnId = String(estimate.Id);
        const lines = estimate.Line || [];
        const discountLine = lines.find((line) => line.DetailType === "DiscountLineDetail");
        const start = rows.length;
        let unlinked = false;

        for (const line of lines.filter((l) => l.DetailType === "SalesItemLineDetail")) {

            const detail = line.SalesItemLineDetail || {};
            const item = detail.ItemRef?.value ? itemsById.get(String(detail.ItemRef.value)) : null;
            const productServiceName = item?.fullyQualifiedName || refName(detail.ItemRef);

            let quantity = Number(detail.Qty);
            if (!Number.isFinite(quantity) || quantity === 0) quantity = 1;
            quantity = Math.abs(quantity);

            const amount = Number(line.Amount) || 0;

            rows.push({
                txnId,
                docNumber: safe(estimate.DocNumber),
                customerName: refName(estimate.CustomerRef),
                estimateDate: safe(estimate.TxnDate),
                expirationDate: safe(estimate.ExpirationDate),
                estimateStatus: safe(estimate.TxnStatus),
                acceptedBy: safe(estimate.AcceptedBy),
                acceptedDate: safe(estimate.AcceptedDate),
                memo: safe(estimate.PrivateNote),
                customerMemo: safe(estimate.CustomerMemo?.value),
                globalTaxCalculation: "TaxExcluded",
                discountPercent: safe(discountLine?.DiscountLineDetail?.DiscountPercent, ""),
                productServiceName,
                description: safe(line.Description) || productServiceName || "",
                quantity,
                rate: quantity ? round2(amount / quantity) : amount,
                amount,
                ...resolveLineTaxCode(detail.TaxCodeRef, taxCodes, { invoice: estimate, onTaxIssue }),
                taxAmount: 0,
                taxAmountSource: "none",
                className: refName(detail.ClassRef),
                locationName: refName(estimate.DepartmentRef),
                currency: safe(estimate.CurrencyRef?.value, ""),
                exchangeRate: safe(estimate.ExchangeRate, 1),
                poNumber: customFieldPoNumber(estimate)
            });

        }

        allocateInvoiceTaxAmounts(estimate, rows.slice(start), taxCodes, (issue) => {
            unlinked = true;
            if (onTaxAmountIssue) onTaxAmountIssue(issue);
        });

        rows.slice(start).forEach((row) => {
            Object.assign(row, applyCreditNoteTaxRule({ taxAmount: row.taxAmount, taxAmountResolved: !unlinked, sourceTaxCodeName: row.taxCodeName }));
        });

    }

    return rows;

};

// Purchase Orders: one row per line of each QBO PurchaseOrder ("QBo (New)" Purchase Order layout).
//   AccountBasedExpenseLineDetail -> Expense Account / Description / Line Amount / Customer / Class / Tax Code
//   ItemBasedExpenseLineDetail    -> Product/Service / Description / Quantity / Rate / Amount / Tax Code / Tax Amount / Class
// The columns of the other line kind stay blank. Tax rule as for Estimates (VAT present -> Standard,
// zero -> Out of Scope; tax that cannot be linked to a line keeps the source code).
export const normalizePurchaseOrderRecords = (rawOrders, { accounts = [], items = [], classes = new Map(), terms = new Map(), taxCodes = new Map(), onTaxIssue = null, onTaxAmountIssue = null } = {}) => {

    const accountById = new Map(accounts.map((a) => [String(a.id), a]));
    const itemsById = new Map(items.filter((i) => i.id).map((i) => [String(i.id), i]));
    const className = (ref) => (ref?.value !== undefined ? (classes.get(String(ref.value)) || safe(ref?.name, "")) : "");
    const rows = [];

    for (const order of rawOrders) {

        const txnId = String(order.Id);
        const termRef = order.SalesTermRef;
        const termName = termRef?.name || (termRef?.value !== undefined ? terms.get(String(termRef.value)) || "" : "");
        const start = rows.length;
        let unlinked = false;

        for (const line of order.Line || []) {

            const base = {
                txnId,
                docNumber: safe(order.DocNumber),
                vendorName: refName(order.VendorRef),
                poStatus: safe(order.POStatus),
                orderDate: safe(order.TxnDate),
                dueDate: safe(order.DueDate),
                memo: safe(order.PrivateNote),
                globalTaxCalculation: "TaxExcluded",
                locationName: refName(order.DepartmentRef),
                currency: safe(order.CurrencyRef?.value, ""),
                exchangeRate: order.CurrencyRef?.value ? safe(order.ExchangeRate, "") : "",
                poNumber: customFieldPoNumber(order),
                termName,
                taxAmount: 0,
                taxAmountSource: "none"
            };

            if (line.DetailType === "AccountBasedExpenseLineDetail" && line.AccountBasedExpenseLineDetail) {

                const detail = line.AccountBasedExpenseLineDetail;
                const acct = detail.AccountRef?.value !== undefined ? accountById.get(String(detail.AccountRef.value)) : null;
                rows.push({
                    ...base,
                    lineKind: "account",
                    expenseAccountName: acct?.fullyQualifiedName || acct?.name || safe(detail.AccountRef?.name, ""),
                    expenseDescription: safe(line.Description),
                    expenseAmount: Number(line.Amount) || 0,
                    expenseCustomerName: safe(detail.CustomerRef?.name, ""),
                    expenseClassName: className(detail.ClassRef),
                    amount: Number(line.Amount) || 0,
                    ...resolveLineTaxCode(detail.TaxCodeRef, taxCodes, { invoice: order, onTaxIssue })
                });

            } else if (line.DetailType === "ItemBasedExpenseLineDetail" && line.ItemBasedExpenseLineDetail) {

                const detail = line.ItemBasedExpenseLineDetail;
                const item = detail.ItemRef?.value ? itemsById.get(String(detail.ItemRef.value)) : null;
                const productServiceName = item?.fullyQualifiedName || refName(detail.ItemRef);
                let quantity = Number(detail.Qty);
                if (!Number.isFinite(quantity) || quantity === 0) quantity = 1;
                const amount = Number(line.Amount) || 0;
                const unitPrice = Number(detail.UnitPrice);
                rows.push({
                    ...base,
                    lineKind: "item",
                    productServiceName,
                    description: safe(line.Description) || productServiceName || "",
                    quantity,
                    rate: Number.isFinite(unitPrice) && detail.UnitPrice !== undefined ? unitPrice : round2(amount / quantity),
                    amount,
                    productServiceAmount: amount,
                    className: className(detail.ClassRef),
                    ...resolveLineTaxCode(detail.TaxCodeRef, taxCodes, { invoice: order, onTaxIssue })
                });

            }

        }

        allocateInvoiceTaxAmounts(order, rows.slice(start), taxCodes, (issue) => {
            unlinked = true;
            if (onTaxAmountIssue) onTaxAmountIssue(issue);
        }, ["purchaseRateIds", "salesRateIds"]);

        rows.slice(start).forEach((row) => {
            const rule = applyCreditNoteTaxRule({ taxAmount: row.taxAmount, taxAmountResolved: !unlinked, sourceTaxCodeName: row.taxCodeName });
            Object.assign(row, rule);
            // Each line kind fills only its own tax columns (the other kind stays blank).
            const code = rule.exportTaxCodeName || "Out of Scope";
            if (row.lineKind === "account") {
                row.expenseTaxCodeName = code;
                row.productServiceTaxCodeName = "";
                row.productServiceTaxAmount = "";
            } else {
                row.expenseTaxCodeName = "";
                row.productServiceTaxCodeName = code;
                row.productServiceTaxAmount = row.taxAmount;
            }
        });

    }

    return rows;

};

export const NORMALIZERS = {
    account: normalizeAccount,
    customer: normalizeCustomer,
    vendor: normalizeVendor,
    item: normalizeItem
};

export const normalizeCollection = (entityKey, rawRecords) => {
    const normalizer = NORMALIZERS[entityKey];
    if (!normalizer) return [];
    return rawRecords.map((record) => normalizer(record));
};


// Parent/child relationships between Items. In the QBO API a sub-item points
// at its immediate parent through ParentRef ({ value: <parent Item Id>,
// name: <optional> }) with SubItem = true. The ref's NAME is frequently
// absent, so everything is resolved from the already-fetched Item list by id
// (no extra API calls). Two SEPARATE fields are produced:
//
//   parentItemName - the IMMEDIATE parent item, whatever its type (its
//                    FullyQualifiedName, so nested parents stay unambiguous,
//                    e.g. "Hardware:Tools"). Blank for top-level items.
//   categoryName   - only the Category-type ancestors, joined top-down with
//                    ":" (e.g. "Hardware"). Blank when no ancestor is a
//                    Category (a plain Parent:Sub item is NOT a category).
//
// If the parent id is not in the fetched list (e.g. an inactive parent,
// which QBO queries omit by default) the ref's own name is kept and the
// item is counted as unresolved in the fetch log.
export const resolveItemRelations = (items, lookupItems = []) => {

    // `lookupItems` (optional) are extra records used ONLY to resolve parent
    // names - e.g. inactive parents, which a default QBO query omits. They
    // are never added to the exported rows.
    const byId = new Map([...lookupItems, ...items].map((item) => [String(item.id), item]));

    for (const item of items) {

        const parent = item.parentItemId ? byId.get(String(item.parentItemId)) : null;

        if (parent) {
            item.parentItemName = parent.fullyQualifiedName || parent.name || item.parentItemName;
        }

        const names = [];
        const visited = new Set([String(item.id)]);
        let ancestor = parent;

        while (ancestor && !visited.has(String(ancestor.id))) {
            visited.add(String(ancestor.id));
            if (ancestor.type === "Category") names.unshift(ancestor.name);
            ancestor = ancestor.parentItemId ? byId.get(String(ancestor.parentItemId)) : null;
        }

        item.categoryName = names.join(":");

    }

    return items;

};

// Backwards-compatible alias (earlier code/tests imported this name).
export const resolveItemCategories = resolveItemRelations;


// Resolves each Item's Income / Expense / Asset account reference to the
// FULL Account Name used on the Accounts sheet (fullyQualifiedName).
// Strategy, per reference:
//   1. match by account id (reliable) -> that account's fullyQualifiedName
//   2. no id: match by name, but ONLY when exactly one account has that
//      fully-qualified name or short name (duplicates are never guessed)
//   3. otherwise keep the existing value and report a warning
// Returns { resolved, kept, warnings } - never throws, never blanks a value.
const ACCOUNT_REF_FIELDS = [
    ["incomeAccountId", "incomeAccountName", "incomeAccountFullName", "Income Account"],
    ["expenseAccountId", "expenseAccountName", "expenseAccountFullName", "Expense Account"],
    ["assetAccountId", "assetAccountName", "assetAccountFullName", "Inventory asset account"]
];

export const unresolvedItemAccountIds = (items, accounts = []) => {
    const known = new Set(accounts.map((a) => String(a.id)));
    const missing = new Set();
    for (const item of items) {
        for (const [idField] of ACCOUNT_REF_FIELDS) {
            if (item[idField] && !known.has(String(item[idField]))) missing.add(String(item[idField]));
        }
    }
    return [...missing];
};

export const resolveItemAccounts = (items, accounts = []) => {

    const byId = new Map(accounts.map((a) => [String(a.id), a]));
    const byFullName = new Map();
    const byShortName = new Map();
    const push = (map, key, account) => {
        const k = String(key || "").trim().toLowerCase();
        if (!k) return;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(account);
    };
    accounts.forEach((a) => { push(byFullName, a.fullyQualifiedName, a); push(byShortName, a.name, a); });

    const stats = { resolved: 0, kept: 0, warnings: [] };

    for (const item of items) {
        for (const [idField, nameField, fullField, label] of ACCOUNT_REF_FIELDS) {

            const id = item[idField];
            const name = item[nameField];
            if (!id && !name) continue;

            let match = id ? byId.get(String(id)) : null;

            if (!match && name) {
                const key = String(name).trim().toLowerCase();
                const exact = byFullName.get(key) || [];
                const short = byShortName.get(key) || [];
                if (exact.length === 1) match = exact[0];
                else if (exact.length === 0 && short.length === 1) match = short[0];
                else if (exact.length > 1 || short.length > 1) {
                    stats.warnings.push(`Item "${item.fullyQualifiedName}": ${label} "${name}" matches ${Math.max(exact.length, short.length)} accounts - kept as is`);
                }
            }

            if (match) {
                item[fullField] = match.fullyQualifiedName || match.name;
                stats.resolved += 1;
            } else {
                item[fullField] = name || "";
                stats.kept += 1;
                if (!stats.warnings.some((w) => w.includes(`"${item.fullyQualifiedName}": ${label}`))) {
                    stats.warnings.push(`Item "${item.fullyQualifiedName}": ${label} "${name || id}" not found in Accounts - kept as is`);
                }
            }
        }
    }

    return stats;
};

// Invoice Credit Note (Detailed Transactions) - one row per SalesItemLine of each
// QBO CreditMemo. Same line logic as the invoice detail rows (qty forced
// positive, blank/zero qty -> 1, rate = amount / qty). Tax rule (ZA team rule):
//   per-line VAT amount present (<> 0)  -> "Standard"
//   per-line VAT amount is 0            -> "Out of Scope"
// The VAT amount is QBO's own CreditMemo TxnTaxDetail total allocated to the
// lines (see allocateInvoiceTaxAmounts). If that tax could NOT be linked to the
// lines, the rule is not applied (the source tax code is kept) instead of
// wrongly reporting "Out of Scope".
export const applyCreditNoteTaxRule = ({ taxAmount, taxAmountResolved, sourceTaxCodeName }) => {

    if (!taxAmountResolved) {
        return { exportTaxCodeName: sourceTaxCodeName, taxRule: "kept-tax-unlinked" };
    }

    return Number(taxAmount) !== 0
        ? { exportTaxCodeName: "Standard", taxRule: "vat-present-standard" }
        : { exportTaxCodeName: "Out of Scope", taxRule: "vat-zero-out-of-scope" };

};

export const normalizeCreditMemoDetailRecords = (rawCreditMemos, { items = [], taxCodes = new Map(), onTaxIssue = null, onTaxAmountIssue = null } = {}) => {

    const itemsById = new Map(items.filter((i) => i.id).map((i) => [String(i.id), i]));
    const rows = [];

    for (const memo of rawCreditMemos) {

        const txnId = String(memo.Id);
        const lines = memo.Line || [];
        const discountLine = lines.find((line) => line.DetailType === "DiscountLineDetail");
        const itemLines = lines.filter((line) => line.DetailType === "SalesItemLineDetail");
        const memoStart = rows.length;
        let unlinked = false;

        for (const line of itemLines) {

            const detail = line.SalesItemLineDetail || {};
            const item = detail.ItemRef?.value ? itemsById.get(String(detail.ItemRef.value)) : null;
            const productServiceName = item?.fullyQualifiedName || refName(detail.ItemRef);

            let quantity = Number(detail.Qty);
            if (!Number.isFinite(quantity) || quantity === 0) quantity = 1;
            quantity = Math.abs(quantity);

            const amount = Number(line.Amount) || 0;
            const rate = quantity ? round2(amount / quantity) : amount;
            const resolved = resolveLineTaxCode(detail.TaxCodeRef, taxCodes, { invoice: memo, onTaxIssue });

            rows.push({
                txnId,
                docNumber: safe(memo.DocNumber),
                customerName: refName(memo.CustomerRef),
                creditDate: safe(memo.TxnDate),
                globalTaxCalculation: "TaxExcluded",
                serviceDate: safe(detail.ServiceDate),
                productServiceName,
                description: safe(line.Description) || productServiceName || "",
                quantity,
                rate,
                amount,
                ...resolved,
                taxAmount: 0,
                taxAmountSource: "none",
                className: refName(detail.ClassRef),
                customerMemo: safe(memo.CustomerMemo?.value),
                privateNote: safe(memo.PrivateNote),
                sku: safe(item?.sku),
                termName: refName(memo.SalesTermRef),
                discountPercent: safe(discountLine?.DiscountLineDetail?.DiscountPercent, ""),
                currency: safe(memo.CurrencyRef?.value, ""),
                exchangeRate: safe(memo.ExchangeRate, 1),
                locationName: refName(memo.DepartmentRef)
            });

        }

        allocateInvoiceTaxAmounts(memo, rows.slice(memoStart), taxCodes, (issue) => {
            unlinked = true;
            if (onTaxAmountIssue) onTaxAmountIssue(issue);
        });

        rows.slice(memoStart).forEach((row) => {
            Object.assign(row, applyCreditNoteTaxRule({
                taxAmount: row.taxAmount,
                taxAmountResolved: !unlinked,
                sourceTaxCodeName: row.taxCodeName
            }));
        });

    }

    return rows;

};


// A QBO linked-transaction type that is a journal ("JournalEntry", but tolerant of "Journal Entry" / "Journal").
const isJournalType = (type) => /journal/i.test(String(type || ""));

// Invoice Payment: one row per Payment -> Invoice link (Payment.Line[].LinkedTxn
// with TxnType "Invoice"; Line.Amount is the amount applied to that invoice).
//   Ref No        PaymentRefNum (flatten.service.js fills blanks / concatenates duplicates)
//   Invoice No    the same number the Invoice sheet writes (invoiceNumbers map)
//   Payment method  PaymentMethodRef name (list lookup - the ref usually has only an id)
//   Deposit To    DepositToAccountRef -> FULL account name from the Accounts list; when the
//                 payment has none, QBO books it to Undeposited Funds, so that account's
//                 name is used (looked up by AccountSubType, never hard-coded)
// Lines that apply a Credit Memo, or that have more than one linked transaction,
// are not exported (reported through onSkip) - never guessed.
export const normalizeInvoicePaymentRecords = (rawPayments, { invoiceNumbers = new Map(), journalNumbers = new Map(), paymentMethods = new Map(), accounts = [], onSkip = null, defaultPaymentMethod = "" } = {}) => {

    const accountById = new Map(accounts.map((a) => [String(a.id), a]));
    const undeposited = accounts.find((a) => a.accountSubType === "UndepositedFunds");
    const rows = [];

    for (const payment of rawPayments) {

        const methodRef = payment.PaymentMethodRef;
        let paymentMethodName = methodRef?.name || (methodRef?.value !== undefined ? paymentMethods.get(String(methodRef.value)) || "" : "");
        let paymentMethodSource = methodRef?.name ? "ref-name" : (paymentMethodName ? "method-list" : (methodRef?.value !== undefined ? "unresolved-id" : "no-method-on-payment"));
        if (!paymentMethodName && defaultPaymentMethod) {
            paymentMethodName = defaultPaymentMethod;
            paymentMethodSource = "configured-default";
        }

        const depositRef = payment.DepositToAccountRef;
        let depositAccountName = "";
        let depositSource = "none";
        if (depositRef?.value !== undefined) {
            const acct = accountById.get(String(depositRef.value));
            depositAccountName = acct?.fullyQualifiedName || depositRef.name || "";
            depositSource = acct ? "account-list" : (depositRef.name ? "ref-name" : "unresolved");
        } else if (undeposited) {
            depositAccountName = undeposited.fullyQualifiedName || undeposited.name;
            depositSource = "undeposited-funds-default";
        }

        for (const line of payment.Line || []) {

            const links = line.LinkedTxn || [];
            // A payment line is exported when it settles an Invoice OR is paid through a Journal Entry
            // (payment journal). Other links on the same line (e.g. a Credit Memo) do not change the line
            // Amount, which belongs to the Invoice / Journal link. A line with two or more Invoice / Journal
            // links cannot be split (one Amount), so it is reported instead of double counted.
            const invoiceLinksOfLine = links.filter((l) => l.TxnType === "Invoice");
            const journalLinksOfLine = links.filter((l) => isJournalType(l.TxnType));
            // Exactly one Invoice link (a Journal link on the SAME line is its payment journal: its number is
            // carried on the Invoice row), or a Journal-only line. Two or more Invoice links, or two or more
            // Journal links without an Invoice, cannot be split (one Amount) and are reported.
            const paidLinks = invoiceLinksOfLine.length ? invoiceLinksOfLine : journalLinksOfLine;

            if (!paidLinks.length) {
                if (onSkip && links.length) onSkip({ reason: "non-invoice-link", paymentId: payment.Id, types: links.map((l) => l.TxnType) });
                continue;
            }
            if (paidLinks.length > 1) {
                if (onSkip) onSkip({ reason: "multiple-linked-txn", paymentId: payment.Id, types: paidLinks.map((l) => l.TxnType) });
                continue;
            }

            const link = paidLinks[0];
            const isJournal = isJournalType(link.TxnType);
            const linkedId = String(link.TxnId);
            const knownNumber = (isJournal ? journalNumbers : invoiceNumbers).get(linkedId);
            const sameLineJournal = !isJournal && journalLinksOfLine.length ? String(journalLinksOfLine[0].TxnId) : "";
            const journalId = isJournal ? linkedId : sameLineJournal;
            const journalKnown = journalId ? journalNumbers.get(journalId) : "";

            rows.push({
                txnId: String(payment.Id),
                docNumber: safe(payment.PaymentRefNum),
                // Cheque Number: the payment reference when the payment method is a cheque.
                chequeNumber: /che?que?|check/i.test(paymentMethodName) ? safe(payment.PaymentRefNum) : "",
                customerName: refName(payment.CustomerRef),
                paymentDate: safe(payment.TxnDate),
                paymentMethodName,
                paymentMethodSource,
                memo: safe(payment.PrivateNote),
                depositAccountName,
                depositSource,
                invoiceId: isJournal ? "" : linkedId,
                invoiceNumber: isJournal ? "" : (knownNumber || linkedId),
                invoiceNumberSource: isJournal ? "not-applicable" : (knownNumber ? "invoice-list" : "unresolved"),
                journalNumber: journalId ? (journalKnown || journalId) : "",
                journalNumberSource: journalId ? (journalKnown ? "journal-list" : "unresolved") : "not-applicable",
                transactionType: String(link.TxnType),
                amount: Number(line.Amount) || 0,
                currency: safe(payment.CurrencyRef?.value, ""),
                exchangeRate: safe(payment.ExchangeRate, 1)
            });

        }

    }

    return rows;

};

// Journal Entry -> one row per journal line (QBo "New" Journal layout).
// Amount = Debit - Credit (a Credit line is negative), per the team note
// "formula apply -credit+debit". Account / Class names are resolved to their
// FULL names (Parent:Child) from the shared lists when available.
export const normalizeJournalRecords = (rawJournals, { accounts = [], classes = new Map(), taxCodes = new Map(), onSkip = null } = {}) => {

    const accountById = new Map(accounts.map((a) => [String(a.id), a]));
    const rows = [];

    for (const journal of rawJournals) {

        const hasCurrency = journal.CurrencyRef?.value !== undefined && String(journal.CurrencyRef.value).trim() !== "";

        for (const line of journal.Line || []) {

            const detail = line.JournalEntryLineDetail;
            if (!detail) continue;   // e.g. subtotal / description-only lines

            const postingType = String(detail.PostingType || "").toLowerCase();
            const amount = Number(line.Amount);

            if (!Number.isFinite(amount) || (postingType !== "debit" && postingType !== "credit")) {
                if (onSkip) onSkip({ reason: "invalid-line", journalId: journal.Id, lineId: line.Id });
                continue;
            }

            const accountRef = detail.AccountRef;
            const acct = accountRef?.value !== undefined ? accountById.get(String(accountRef.value)) : null;
            const accountName = acct?.fullyQualifiedName || acct?.name || safe(accountRef?.name, "");
            const accountSource = acct ? "account-list" : (accountRef?.name ? "ref-name" : "unresolved");

            const classRef = detail.ClassRef;
            const className = classRef?.value !== undefined ? (classes.get(String(classRef.value)) || safe(classRef?.name, "")) : "";

            const taxRef = detail.TaxCodeRef;
            const taxCodeName = taxRef?.value !== undefined
                ? (safe(taxRef?.name, "") || taxCodes.get(String(taxRef.value))?.name || String(taxRef.value))
                : "";

            rows.push({
                txnId: String(journal.Id),
                docNumber: safe(journal.DocNumber),
                journalDate: safe(journal.TxnDate),
                memo: safe(journal.PrivateNote),
                accountName,
                accountSource,
                amount: Math.round((postingType === "debit" ? amount : -amount) * 100) / 100,
                postingType: postingType === "debit" ? "Debit" : "Credit",
                description: safe(line.Description),
                entityName: safe(detail.Entity?.EntityRef?.name, ""),
                taxCodeName,
                className,
                currency: hasCurrency ? String(journal.CurrencyRef.value) : "",
                exchangeRate: hasCurrency ? safe(journal.ExchangeRate, "") : "",
                adjustment: journal.Adjustment === true
            });

        }

    }

    return rows;

};

// Overpayment: the part of a QBO Payment NOT applied to any invoice
// (Payment.UnappliedAmt > 0), one row per payment. Amount = UnappliedAmt.
// Customer / method / deposit-account / ref no resolve exactly as in Invoice Payment.
export const normalizeOverpaymentRecords = (rawPayments, { paymentMethods = new Map(), accounts = [], defaultPaymentMethod = "", onSkip = null } = {}) => {

    const accountById = new Map(accounts.map((a) => [String(a.id), a]));
    const undeposited = accounts.find((a) => a.accountSubType === "UndepositedFunds");
    const rows = [];

    for (const payment of rawPayments) {

        let unapplied = Math.round(Number(payment.UnappliedAmt) * 100) / 100;
        if (!Number.isFinite(unapplied) || unapplied <= 0) continue;

        // Allocated through a payment journal / credit memo: those line amounts are NOT an overpayment even when
        // QBO's UnappliedAmt still counts them. Unapplied = min(UnappliedAmt, TotalAmt - every linked line).
        const linkedLines = (payment.Line || []).filter((l) => (l.LinkedTxn || []).length);
        if (linkedLines.some((l) => l.LinkedTxn.some((t) => isJournalType(t.TxnType) || t.TxnType === "CreditMemo"))) {
            const allocated = linkedLines.reduce((sum, l) => sum + (Number(l.Amount) || 0), 0);
            const remaining = Math.round((Number(payment.TotalAmt) - allocated) * 100) / 100;
            if (Number.isFinite(remaining)) unapplied = Math.min(unapplied, remaining);
            if (unapplied <= 0) { if (onSkip) onSkip({ reason: "allocated-through-journal-or-credit", paymentId: payment.Id }); continue; }
        }

        const methodRef = payment.PaymentMethodRef;
        let paymentMethodName = methodRef?.name || (methodRef?.value !== undefined ? paymentMethods.get(String(methodRef.value)) || "" : "");
        let paymentMethodSource = methodRef?.name ? "ref-name" : (paymentMethodName ? "method-list" : (methodRef?.value !== undefined ? "unresolved-id" : "no-method-on-payment"));
        if (!paymentMethodName && defaultPaymentMethod) {
            paymentMethodName = defaultPaymentMethod;
            paymentMethodSource = "configured-default";
        }

        const depositRef = payment.DepositToAccountRef;
        let depositAccountName = "";
        let depositSource = "none";
        if (depositRef?.value !== undefined) {
            const acct = accountById.get(String(depositRef.value));
            depositAccountName = acct?.fullyQualifiedName || depositRef.name || "";
            depositSource = acct ? "account-list" : (depositRef.name ? "ref-name" : "unresolved");
        } else if (undeposited) {
            depositAccountName = undeposited.fullyQualifiedName || undeposited.name;
            depositSource = "undeposited-funds-default";
        }

        const appliedToInvoices = (payment.Line || []).some((l) => (l.LinkedTxn || []).some((t) => t.TxnType === "Invoice"));

        rows.push({
            txnId: String(payment.Id),
            docNumber: safe(payment.PaymentRefNum),
            customerName: refName(payment.CustomerRef),
            paymentDate: safe(payment.TxnDate),
            paymentMethodName,
            paymentMethodSource,
            memo: safe(payment.PrivateNote),
            depositAccountName,
            depositSource,
            amount: unapplied,
            partiallyApplied: appliedToInvoices,
            currency: safe(payment.CurrencyRef?.value, ""),
            exchangeRate: safe(payment.ExchangeRate, 1)
        });

    }

    return rows;

};

// Bill Overpayment: QBO BillPayment whose total is larger than what it applies to bills.
//   overpayment amount = TotalAmt - (sum of Line amounts linked to a Bill - sum linked to a VendorCredit)
// One row per bill payment; payments that are fully applied are not exported. The paying account is
// CheckPayment.BankAccountRef (PayType Check) or CreditCardPayment.CCAccountRef (PayType CreditCard),
// resolved to its FULL account name from the Accounts list.
export const normalizeBillOverpaymentRecords = (rawBillPayments, { accounts = [] } = {}) => {

    const accountById = new Map(accounts.map((a) => [String(a.id), a]));
    const cents = (n) => Math.round(Number(n) * 100);
    const rows = [];

    for (const payment of rawBillPayments) {

        const total = cents(payment.TotalAmt);
        if (!Number.isFinite(total)) continue;

        let billsApplied = 0;
        let creditsApplied = 0;
        for (const line of payment.Line || []) {
            const types = (line.LinkedTxn || []).map((t) => t.TxnType);
            if (types.includes("VendorCredit")) creditsApplied += cents(line.Amount) || 0;
            else if (types.includes("Bill") || types.some(isJournalType)) billsApplied += cents(line.Amount) || 0; // paid through a payment journal = applied
        }

        const unapplied = total - (billsApplied - creditsApplied);
        if (unapplied <= 0) continue;

        const accountRef = payment.PayType === "CreditCard" ? payment.CreditCardPayment?.CCAccountRef : payment.CheckPayment?.BankAccountRef;
        let accountName = "";
        let accountSource = "none";
        if (accountRef?.value !== undefined) {
            const acct = accountById.get(String(accountRef.value));
            accountName = acct?.fullyQualifiedName || accountRef.name || "";
            accountSource = acct ? "account-list" : (accountRef.name ? "ref-name" : "unresolved");
        }

        rows.push({
            txnId: String(payment.Id),
            docNumber: safe(payment.DocNumber),
            paymentDate: safe(payment.TxnDate),
            memo: safe(payment.PrivateNote),
            vendorName: refName(payment.VendorRef),
            accountName,
            accountSource,
            payType: safe(payment.PayType),
            amount: unapplied / 100,
            partiallyApplied: billsApplied > 0 || creditsApplied > 0,
            currency: safe(payment.CurrencyRef?.value, ""),
            exchangeRate: safe(payment.ExchangeRate, 1)
        });

    }

    return rows;

};

// Expense (QBO Purchase: Credit Card charge / Cheque / Cash) -> one row per
// account-based expense line, in the "QBo (New)" Expense layout.
// Tax rule (South Africa file): line tax amount present -> "Standard", zero -> "Out of Scope".
// Item-based expense lines have no Expense Account and are reported via onSkip (never guessed).
const EXPENSE_TYPE_BY_PAYMENT_TYPE = { CreditCard: "Credit Card", Check: "Cheque", Cash: "Cash" };

export const normalizeExpenseRecords = (rawPurchases, { accounts = [], classes = new Map(), paymentMethods = new Map(), taxCodes = new Map(), onSkip = null, onTaxIssue = null, onTaxAmountIssue = null } = {}) => {

    const accountById = new Map(accounts.map((a) => [String(a.id), a]));
    const acctName = (ref) => {
        if (ref?.value === undefined) return { name: "", source: "none" };
        const a = accountById.get(String(ref.value));
        return { name: a?.fullyQualifiedName || a?.name || safe(ref?.name, ""), source: a ? "account-list" : (ref?.name ? "ref-name" : "unresolved") };
    };
    const rows = [];

    for (const purchase of rawPurchases) {

        const txnId = String(purchase.Id);
        const header = acctName(purchase.AccountRef);
        const methodRef = purchase.PaymentMethodRef;
        const paymentMethodName = methodRef?.name || (methodRef?.value !== undefined ? paymentMethods.get(String(methodRef.value)) || "" : "");
        const start = rows.length;
        let unlinked = false;

        for (const line of purchase.Line || []) {

            if (line.DetailType === "ItemBasedExpenseLineDetail") {
                if (onSkip) onSkip({ reason: "item-based-line", purchaseId: txnId, lineId: line.Id });
                continue;
            }
            const detail = line.AccountBasedExpenseLineDetail;
            if (!detail) continue;

            const expenseAccount = acctName(detail.AccountRef);
            const classRef = detail.ClassRef;

            rows.push({
                txnId,
                docNumber: safe(purchase.DocNumber),
                expenseType: EXPENSE_TYPE_BY_PAYMENT_TYPE[purchase.PaymentType] || safe(purchase.PaymentType, ""),
                accountName: header.name,
                accountSource: header.source,
                payeeName: safe(purchase.EntityRef?.name, ""),
                paymentDate: safe(purchase.TxnDate),
                memo: safe(purchase.PrivateNote),
                globalTaxCalculation: "TaxExcluded",
                expenseAccountName: expenseAccount.name,
                expenseAccountSource: expenseAccount.source,
                description: safe(line.Description),
                amount: Number(line.Amount) || 0,
                ...resolveLineTaxCode(detail.TaxCodeRef, taxCodes, { invoice: purchase, onTaxIssue }),
                taxAmount: 0,
                taxAmountSource: "none",
                className: classRef?.value !== undefined ? (classes.get(String(classRef.value)) || safe(classRef?.name, "")) : "",
                currency: safe(purchase.CurrencyRef?.value, ""),
                exchangeRate: purchase.CurrencyRef?.value ? safe(purchase.ExchangeRate, "") : "",
                paymentMethodName,
                customerName: safe(detail.CustomerRef?.name, "")
            });

        }

        allocateInvoiceTaxAmounts(purchase, rows.slice(start), taxCodes, (issue) => {
            unlinked = true;
            if (onTaxAmountIssue) onTaxAmountIssue(issue);
        }, ["purchaseRateIds", "salesRateIds"]);

        rows.slice(start).forEach((row) => {
            Object.assign(row, applyCreditNoteTaxRule({ taxAmount: row.taxAmount, taxAmountResolved: !unlinked, sourceTaxCodeName: row.taxCodeName }));
        });

    }

    return rows;

};

// Transfer (QBO Transfer): one row per transfer. From/To accounts resolve to their
// FULL account names from the shared account list. Ref no = the transfer's own QBO
// transaction id (QBO transfers have no document number; the id is unique).
export const normalizeTransferRecords = (rawTransfers, { accounts = [] } = {}) => {

    const accountById = new Map(accounts.map((a) => [String(a.id), a]));
    const acctName = (ref) => {
        if (ref?.value === undefined) return { name: "", source: "none" };
        const a = accountById.get(String(ref.value));
        return { name: a?.fullyQualifiedName || a?.name || safe(ref?.name, ""), source: a ? "account-list" : (ref?.name ? "ref-name" : "unresolved") };
    };

    return rawTransfers.map((t) => {
        const from = acctName(t.FromAccountRef);
        const to = acctName(t.ToAccountRef);
        const hasCurrency = t.CurrencyRef?.value !== undefined && String(t.CurrencyRef.value).trim() !== "";
        return {
            txnId: String(t.Id),
            fromAccountName: from.name,
            toAccountName: to.name,
            accountSource: `${from.source}/${to.source}`,
            amount: Number(t.Amount) || 0,
            transferDate: safe(t.TxnDate),
            memo: safe(t.PrivateNote),
            currency: hasCurrency ? String(t.CurrencyRef.value) : "",
            exchangeRate: hasCurrency ? safe(t.ExchangeRate, "") : "",
            refNo: String(t.Id)
        };
    });

};

// Deposit (QBO Deposit) -> one row per deposit line, "QBo (New)" Deposit layout.
// - Line Account: the line's AccountRef; a line that only LINKS a payment/transaction
//   (LinkedTxn, no AccountRef) sits in QBO's Undeposited Funds, so that account is used.
// - Linked Transaction Type: DepositLineDetail.TxnType, else the LinkedTxn type.
// - Tax (South Africa file): line tax amount present -> "Standard", zero -> "Out of Scope";
//   VAT that cannot be linked to a line keeps the source tax code and is reported.
export const normalizeDepositRecords = (rawDeposits, { accounts = [], classes = new Map(), paymentMethods = new Map(), taxCodes = new Map(), onTaxIssue = null, onTaxAmountIssue = null } = {}) => {

    const accountById = new Map(accounts.map((a) => [String(a.id), a]));
    const undeposited = accounts.find((a) => a.accountSubType === "UndepositedFunds");
    const acctName = (ref) => {
        if (ref?.value === undefined) return { name: "", source: "none" };
        const a = accountById.get(String(ref.value));
        return { name: a?.fullyQualifiedName || a?.name || safe(ref?.name, ""), source: a ? "account-list" : (ref?.name ? "ref-name" : "unresolved") };
    };
    const rows = [];

    for (const deposit of rawDeposits) {

        const txnId = String(deposit.Id);
        const header = acctName(deposit.DepositToAccountRef);
        const hasCurrency = deposit.CurrencyRef?.value !== undefined && String(deposit.CurrencyRef.value).trim() !== "";
        const start = rows.length;
        let unlinked = false;

        for (const line of deposit.Line || []) {

            const detail = line.DepositLineDetail;
            const linked = line.LinkedTxn || [];
            if (!detail && !linked.length) continue;   // subtotal etc.

            let lineAccount = acctName(detail?.AccountRef);
            if (lineAccount.source === "none" && linked.length && undeposited) {
                lineAccount = { name: undeposited.fullyQualifiedName || undeposited.name, source: "undeposited-funds-default" };
            }

            const methodRef = detail?.PaymentMethodRef;
            const classRef = detail?.ClassRef;

            rows.push({
                txnId,
                docNumber: safe(deposit.DocNumber),
                depositDate: safe(deposit.TxnDate),
                depositAccountName: header.name,
                depositAccountSource: header.source,
                receivedFrom: safe(detail?.Entity?.name, ""),
                globalTaxCalculation: "TaxExcluded",
                lineAccountName: lineAccount.name,
                lineAccountSource: lineAccount.source,
                description: safe(line.Description),
                amount: Number(line.Amount) || 0,
                className: classRef?.value !== undefined ? (classes.get(String(classRef.value)) || safe(classRef?.name, "")) : "",
                locationName: refName(deposit.DepartmentRef),
                ...resolveLineTaxCode(detail?.TaxCodeRef, taxCodes, { invoice: deposit, onTaxIssue }),
                taxApplicableOn: "Sales",
                taxAmount: 0,
                taxAmountSource: "none",
                memo: safe(deposit.PrivateNote),
                currency: hasCurrency ? String(deposit.CurrencyRef.value) : "",
                exchangeRate: hasCurrency ? safe(deposit.ExchangeRate, "") : "",
                paymentMethodName: methodRef?.name || (methodRef?.value !== undefined ? paymentMethods.get(String(methodRef.value)) || "" : ""),
                linkedTxnType: safe(detail?.TxnType) || safe(linked[0]?.TxnType, ""),
                checkNumber: safe(detail?.CheckNum, "")
            });

        }

        allocateInvoiceTaxAmounts(deposit, rows.slice(start), taxCodes, (issue) => {
            unlinked = true;
            if (onTaxAmountIssue) onTaxAmountIssue(issue);
        }, ["salesRateIds", "purchaseRateIds"]);

        rows.slice(start).forEach((row) => {
            Object.assign(row, applyCreditNoteTaxRule({ taxAmount: row.taxAmount, taxAmountResolved: !unlinked, sourceTaxCodeName: row.taxCodeName }));
        });

    }

    return rows;

};
