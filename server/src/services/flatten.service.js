import { applyTaxMapping } from "./taxMapping.service.js";
// AR and AP are already ONE ROW PER TRANSACTION as normalized (they come
// straight from QBO's own Aged Receivable/Payable Detail report - see
// normalizeARAgingRow/normalizeAPAgingRow), so they need no line-
// flattening. Only the Item entity gets filtered here (QBO's "Category"
// type items are grouping labels only, not real exportable items).

const filterExportableItems = (records) => {

    // A Category-type Item is exported ONLY when it is the (direct or
    // indirect) parent of an exported item - e.g. "Consultation" must be
    // present as its own row above "Consultation:Consultation", otherwise
    // the sub-item has no parent to attach to on import. Childless
    // categories stay out, exactly as before.
    const byId = new Map(records.map((r) => [String(r.id), r]));
    const keepIds = new Set(records.filter((r) => r.type !== "Category").map((r) => String(r.id)));

    for (const record of records) {
        if (record.type === "Category") continue;
        const seen = new Set([String(record.id)]);
        let parent = record.parentItemId ? byId.get(String(record.parentItemId)) : null;
        while (parent && !seen.has(String(parent.id))) {
            seen.add(String(parent.id));
            if (parent.type === "Category") keepIds.add(String(parent.id));
            parent = parent.parentItemId ? byId.get(String(parent.parentItemId)) : null;
        }
    }

    const kept = records.filter((r) => keepIds.has(String(r.id)));

    // Order: every parent directly above its children (depth-first), each
    // record exactly once. Records whose parent is not in the export are
    // treated as top-level and keep their original relative order.
    const keptIds = new Set(kept.map((r) => String(r.id)));
    const childrenOf = new Map();
    const roots = [];
    for (const r of kept) {
        const pid = r.parentItemId ? String(r.parentItemId) : null;
        if (pid && keptIds.has(pid) && pid !== String(r.id)) {
            if (!childrenOf.has(pid)) childrenOf.set(pid, []);
            childrenOf.get(pid).push(r);
        } else {
            roots.push(r);
        }
    }

    const ordered = [];
    const emitted = new Set();
    const emit = (r) => {
        const id = String(r.id);
        if (emitted.has(id)) return;
        emitted.add(id);
        ordered.push(r);
        (childrenOf.get(id) || []).forEach(emit);
    };
    roots.forEach(emit);
    kept.forEach(emit); // safety net for any parent cycle

    return ordered;

};

// AR and AP sub-sheets (Invoice, Adjustment Note, Bill, Bill Credit) each
// need a usable, unique document number:
// - If a record has no doc number at all (common in QBO - many bills
//   and even some invoices are entered without one), fall back to a
//   row-based reference so the row still has something to write. The
//   Aging Detail report doesn't expose each transaction's own QBO id
//   (only the customer/vendor's id), so the fallback is positional
//   rather than an id.
// - If two records end up with the SAME doc number (either a genuine
//   duplicate from QBO, or two records that both happened to fall back
//   to a colliding reference), disambiguate every repeat after the
//   first by appending a running suffix, so no row silently shares a
//   reference with another.
const AR_AP_SUBKEYS = new Set(["ar_invoice", "ar_creditmemo", "ap_bill", "ap_billcredit"]);

const assignUniqueDocNumbers = (records) => {

    const seenCount = new Map();

    return records.map((record, index) => {

        let docNumber = record.docNumber || `ROW-${index + 1}`;

        const timesSeen = seenCount.get(docNumber) || 0;
        seenCount.set(docNumber, timesSeen + 1);

        if (timesSeen > 0) {
            docNumber = `${docNumber}-${timesSeen + 1}`;
        }

        return { ...record, docNumber };

    });

};

// Bill/Invoice (Detailed Transactions) - fills in each transaction's
// document number and resolves duplicates, per the team's explicit
// requirement (asked separately for each module, same rule both times):
//   "fill the blank cells with the corresponding transaction numbers,
//    and concatenate the duplicate numbers with the transaction numbers"
//
// Unlike the AR/AP aging-report rows above, a billDetail/invoiceDetail
// row DOES carry the real QBO transaction id (`txnId` - the Bill's or
// Invoice's own Id, see normalizeBillDetailRecords/
// normalizeInvoiceDetailRecords), so this can use the actual transaction
// number instead of a positional placeholder:
// - A transaction with no DocNumber at all gets its own QBO transaction
//   id as its document number (filling the blank cell).
// - Two (or more) DIFFERENT transactions that happen to share the same
//   DocNumber are genuine duplicates - EVERY one of them gets its
//   number concatenated with its own transaction id ("1023-451"), so
//   none of them silently collide with another.
// - Every LINE of the SAME transaction keeps that one resolved number,
//   since this is a multi-line-per-transaction sheet (one bill/invoice
//   can produce several rows here).
//
// `maxLength`, when given, truncates the FINAL resolved number (after
// fill + dedup) - QBO's Invoice Number field has a documented 21
// character limit (per the Invoice template's own note; Bill has no
// such limit documented). This is applied last, so in the vanishingly
// rare case a duplicate-concat result is both longer than the limit AND
// collides with another truncated result, that collision isn't
// re-detected - flagged as a known edge case, not expected to matter in
// practice.
// Options: maxLength (cut the number to this many characters), separator (default "-"),
// transactionIdFirst (true -> "<txnId><sep><number>", e.g. Journal "1573_253472"; default
// "<number><sep><txnId>"). When a number has to be shortened, the NUMBER part is cut and the
// transaction id is always kept whole.
const assignTransactionNumbers = (records, { maxLength, separator = "-", transactionIdFirst = false } = {}) => {

    // Duplicates are detected on a normalised key (trimmed, case-insensitive),
    // because QBO / the destination treat "inv-1", "INV-1" and "INV-1 " as the same number.
    const keyOf = (value) => String(value).trim().toLowerCase();

    const baseNumberByTxnId = new Map();
    const txnIdsBySharedBase = new Map();

    for (const record of records) {

        if (baseNumberByTxnId.has(record.txnId)) continue;

        const base = (record.docNumber && String(record.docNumber).trim()) || record.txnId;
        baseNumberByTxnId.set(record.txnId, base);

        const key = keyOf(base);
        if (!txnIdsBySharedBase.has(key)) txnIdsBySharedBase.set(key, new Set());
        txnIdsBySharedBase.get(key).add(record.txnId);

    }

    // Fits `base` + "-" + txnId into maxLength by shortening the BASE, never the
    // transaction id (the id is what keeps the number unique).
    const withSuffix = (base, txnId) => {
        if (transactionIdFirst) {
            const prefix = `${txnId}${separator}`;
            if (!maxLength) return `${prefix}${base}`;
            return `${prefix}${base.slice(0, Math.max(0, maxLength - prefix.length))}`.slice(0, Math.max(maxLength, 0));
        }
        const suffix = `${separator}${txnId}`;
        if (!maxLength) return `${base}${suffix}`;
        return `${base.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`.slice(0, maxLength);
    };

    const resolvedNumberByTxnId = new Map();

    for (const txnIds of txnIdsBySharedBase.values()) {
        for (const txnId of txnIds) {
            const base = baseNumberByTxnId.get(txnId);
            resolvedNumberByTxnId.set(txnId, txnIds.size > 1 ? withSuffix(base, txnId) : (maxLength ? base.slice(0, maxLength) : base));
        }
    }

    // Final guard: truncation (or an existing number that looks like "X-123") can still
    // make two different transactions collide - give every later one its own id suffix.
    const used = new Map();
    for (const [txnId, number] of resolvedNumberByTxnId.entries()) {
        let candidate = number;
        let n = 0;
        while (used.has(keyOf(candidate)) && used.get(keyOf(candidate)) !== txnId) {
            n += 1;
            candidate = withSuffix(baseNumberByTxnId.get(txnId), n === 1 ? txnId : `${txnId}${separator}${n}`);
        }
        used.set(keyOf(candidate), txnId);
        resolvedNumberByTxnId.set(txnId, candidate);
    }

    return records.map((record) => ({ ...record, docNumber: resolvedNumberByTxnId.get(record.txnId) }));

};

// Invoice Id -> the EXACT Invoice No the Invoice (Detailed Transactions) sheet
// writes (blank -> transaction id, duplicates -> number-transactionId, 21-char
// limit), so payments always reference the same number as the invoice sheet.
// `invoices` = [{ Id, DocNumber }] as returned by QBO.
export const buildInvoiceNumberMap = (invoices) => {
    const resolved = assignTransactionNumbers(
        invoices.map((inv) => ({ txnId: String(inv.Id), docNumber: inv.DocNumber || "" })),
        { maxLength: 21 }
    );
    return new Map(resolved.map((r) => [r.txnId, r.docNumber]));
};

// Document id -> the EXACT number that document's own sheet exports, for allocation modules that
// reference other documents. `kind`: invoice | creditMemo (21-char limit), journal (txnId_number,
// 21-char limit), anything else (bill, vendorCredit): blank -> id, duplicates -> number-id.
export const buildDocumentNumberMap = (kind, docs) => {
    const options = kind === "invoice" || kind === "creditMemo" ? { maxLength: 21 }
        : kind === "journal" ? { maxLength: 21, separator: "_", transactionIdFirst: true }
            : {};
    const resolved = assignTransactionNumbers(docs.map((d) => ({ txnId: String(d.Id), docNumber: d.DocNumber || "" })), options);
    return new Map(resolved.map((r) => [r.txnId, r.docNumber]));
};

// Estimates / Purchase Orders (team rule): ALWAYS "<transaction id>_<DocNumber>" (not only for
// duplicates), transaction id first so it is never trimmed; a blank DocNumber leaves the transaction
// id alone. 21-character QBO limit: only the DocNumber part is cut.
const concatenateTransactionNumbers = (records, { maxLength = 21, separator = "_" } = {}) =>
    records.map((record) => {
        const doc = record.docNumber ? String(record.docNumber).trim() : "";
        if (!doc) return { ...record, docNumber: String(record.txnId) };
        const prefix = `${record.txnId}${separator}`;
        return { ...record, docNumber: `${prefix}${doc.slice(0, Math.max(0, maxLength - prefix.length))}`.slice(0, maxLength) };
    });

const flattenCore = (entityKey, records) => {

    if (entityKey === "item") return filterExportableItems(records);

    if (AR_AP_SUBKEYS.has(entityKey)) return assignUniqueDocNumbers(records);

    if (entityKey === "billDetail") return assignTransactionNumbers(records);

    // QBO's own documented 21-character limit on Invoice Number.
    if (entityKey === "invoiceDetail") return assignTransactionNumbers(records, { maxLength: 21 });

    // Invoice Credit Note: same rule (blank -> transaction number, duplicates ->
    // number-transactionId) and the same documented 21-character limit on the
    // Adjustment Note No (per the team's field-mapping sheet).
    if (entityKey === "creditMemoDetail") return assignTransactionNumbers(records, { maxLength: 21 });

    // Invoice Payment "Ref No": blank -> payment transaction id, duplicate refs
    // -> ref-transactionId (team rule: concatenate the number with the transaction number).
    if (entityKey === "invoicePayment") return assignTransactionNumbers(records);

    // Journal No: blank -> journal transaction id, duplicate numbers ->
    // number-transactionId (team rule: concatenate TxnNumber/RefNumber with the transaction number).
    // Overpayment "Ref No": same rule as Invoice Payment.
    // Expense "Ref No": blank -> transaction id, duplicates -> number-transactionId.
    // Deposit No: blank -> transaction id, duplicates -> number-transactionId.
    // Cheque no: blank -> transaction id, duplicates -> number-transactionId.
    if (entityKey === "cheque") return assignTransactionNumbers(records);

    if (entityKey === "deposit") return assignTransactionNumbers(records);

    if (entityKey === "expense") return assignTransactionNumbers(records);

    // Credit Card "Ref No": same rule (blank -> transaction id, duplicates -> number-transactionId).
    if (entityKey === "creditCard") return assignTransactionNumbers(records);

    if (entityKey === "overpayment") return assignTransactionNumbers(records);

    // Bill Overpayment "Ref No": blank -> transaction id, duplicates -> number-transactionId.
    // Credit note allocations: the payment number follows the Invoice Payment rule (blank -> transaction id,
    // duplicates -> number-transactionId); every row of one payment shares it.
    if (entityKey === "invoiceCreditAllocation" || entityKey === "billCreditAllocation") return assignTransactionNumbers(records);

    if (entityKey === "estimate" || entityKey === "purchaseOrder") return concatenateTransactionNumbers(records);

    if (entityKey === "billOverpayment") return assignTransactionNumbers(records);

    // Bill Payment "Ref No" and Bill Credit "Ref No": blank -> transaction id, duplicates -> number-transactionId
    // (team rule: fill blanks with the transaction number, concatenate duplicates with it).
    if (entityKey === "billPayment" || entityKey === "billCredit") return assignTransactionNumbers(records);

    // Journal No (team rule): duplicates -> "<transaction id>_<reference number>" (e.g. 1573_253472),
    // transaction id FIRST so it is never trimmed; QBO numbers are limited to 21 characters.
    if (entityKey === "journal") return assignTransactionNumbers(records, { maxLength: 21, separator: "_", transactionIdFirst: true });

    return records;

};

// ctx (optional) = { region, taxMapping } - when the user has ENABLED saved Tax Mapping for
// this company + region, source tax codes are replaced by the confirmed target tax names
// (see taxMapping.service.js). Without ctx the output is exactly as before.
export const flattenForExport = (entityKey, records, ctx = null) => {
    const flat = flattenCore(entityKey, records);
    return ctx?.taxMapping ? applyTaxMapping(entityKey, flat, ctx.region, ctx.taxMapping) : flat;
};
