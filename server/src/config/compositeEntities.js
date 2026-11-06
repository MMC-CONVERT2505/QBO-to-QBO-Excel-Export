// AR and AP are each ONE module the user picks, but they are NOT one flat
// sheet - QBO's real bulk-import format keeps Invoices and Credit Memos
// (or Bills and Vendor Credits) as separate templates with different
// headers (a Credit Memo/Vendor Credit has no Due Date or Terms column,
// and uses "Adjustment Note" wording). Each composite module fans out
// into multiple real sub-templates, each filled from the same fetched
// dataset, filtered by docType.

export const COMPOSITE_ENTITIES = {

    ar: [
        { subKey: "ar_invoice", fileName: "Invoice", docType: "Invoice" },
        { subKey: "ar_creditmemo", fileName: "AdjustmentNote", docType: "Credit Memo" }
    ],

    ap: [
        { subKey: "ap_bill", fileName: "Bill", docType: "Bill" },
        { subKey: "ap_billcredit", fileName: "BillCredit", docType: "Vendor Credit" }
    ]

};

export const isCompositeEntity = (key) =>
    Object.prototype.hasOwnProperty.call(COMPOSITE_ENTITIES, key);
