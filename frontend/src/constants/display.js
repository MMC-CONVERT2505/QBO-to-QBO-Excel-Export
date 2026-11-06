// Presentational-only lookups used purely for UI polish (flags, icons).
// These never decide business logic — the backend's region/module data
// (codes, labels, currencies, available modules) is always the source
// of truth; this file just decorates it.

export const REGION_FLAG = {
    US: "🇺🇸",
    CA: "🇨🇦",
    UK: "🇬🇧",
    AU: "🇦🇺",
    NZ: "🇳🇿",
    ZA: "🇿🇦"
};

export const getRegionFlag = (code) => REGION_FLAG[code] || "🌐";

export const MODULE_META = {
    account: { label: "Accounts", icon: "Landmark" },
    customer: { label: "Customers", icon: "Users" },
    vendor: { label: "Vendors", icon: "Truck" },
    item: { label: "Items", icon: "Package" },
    ar: { label: "AR (Invoices & Credit Notes)", icon: "FileText" },
    ap: { label: "AP (Bills & Vendor Credits)", icon: "Receipt" },
    openBalance: { label: "Open Balance (Opening Journal)", icon: "Scale" },
    billDetail: { label: "Bill (Detailed Transactions)", icon: "FileSpreadsheet" },
    invoiceDetail: { label: "Invoice (Detailed Transactions)", icon: "FileSpreadsheet" },
    creditMemoDetail: { label: "Invoice Credit Note (Detailed Transactions)", icon: "FileSpreadsheet" },
    invoicePayment: { label: "Invoice Payment", icon: "FileSpreadsheet" },
    deposit: { label: "Deposit", icon: "FileSpreadsheet" },
    transfer: { label: "Transfer", icon: "FileSpreadsheet" },
    expense: { label: "Expense (Cash)", icon: "Receipt" },
    creditCard: { label: "Credit Card", icon: "Receipt" },
    cheque: { label: "Cheque", icon: "Receipt" },
    otherJournal: { label: "Other Journal Types", icon: "FileSpreadsheet" },
    invoiceCreditAllocation: { label: "Invoice Credit Note Allocation", icon: "FileSpreadsheet" },
    billCreditAllocation: { label: "Bill Credit Note Allocation", icon: "FileSpreadsheet" },
    billPayment: { label: "Bill Payment", icon: "FileSpreadsheet" },
    billCredit: { label: "Bill Credit (Supplier Credit)", icon: "FileSpreadsheet" },
    estimate: { label: "Estimates", icon: "FileText" },
    purchaseOrder: { label: "Purchase Order", icon: "FileText" },
    billOverpayment: { label: "Bill Overpayment", icon: "FileSpreadsheet" },
    overpayment: { label: "Overpayment", icon: "FileSpreadsheet" },
    journal: { label: "Journal Entry", icon: "FileSpreadsheet" }
};
