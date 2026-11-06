// Every accounting entity the app knows how to export, and how to fetch it
// from QBO. `dependsOn` lists other entities whose data must be fetched
// first so the mapping engine can resolve references (e.g. an Invoice
// needs Customer + Item + Account already fetched).

export const ENTITIES = {

    account: {
        key: "account",
        label: "Accounts",
        qboEntity: "Account",
        query: "select * from Account",
        dependsOn: []
    },

    customer: {
        key: "customer",
        label: "Customers",
        qboEntity: "Customer",
        query: "select * from Customer",
        dependsOn: []
    },

    vendor: {
        key: "vendor",
        label: "Vendors",
        qboEntity: "Vendor",
        query: "select * from Vendor",
        dependsOn: []
    },

    item: {
        key: "item",
        label: "Items",
        qboEntity: "Item",
        query: "select * from Item",
        dependsOn: ["account"]
    },

    // AR = Accounts Receivable. Combines open Invoices AND Credit Memos
    // into ONE export (one row per transaction, using its outstanding
    // balance) - this is fetched specially in fetch.service.js since it
    // needs two separate QBO queries (Invoice + CreditMemo) merged
    // together, tagged by origin so normalize.service.js knows which is
    // which.
    ar: {
        key: "ar",
        label: "AR (Invoices & Credit Notes)",
        qboEntity: "Invoice + CreditMemo",
        query: null,
        dependsOn: ["customer"]
    },

    // AP = Accounts Payable. Mirrors AR on the payables side: open Bills
    // AND Vendor Credits combined into one export.
    ap: {
        key: "ap",
        label: "AP (Bills & Vendor Credits)",
        qboEntity: "Bill + VendorCredit",
        query: null,
        dependsOn: ["vendor"]
    },

    // Open Balance = the opening trial-balance journal used to seed the
    // destination company's account balances as of the conversion cutoff
    // date. Built from QBO's own "Trial Balance" report (the authoritative
    // as-of-date balance per account), the same way AR/AP are built from
    // QBO's own Aging Detail reports rather than reconstructed by hand.
    // Depends on "account" because each Trial Balance row has to be
    // matched back to its Account record to know its AccountType - that's
    // what lets us detect Accounts Receivable/Payable control accounts
    // and collapse them into Retained Earnings per the destination
    // template's own instructions (see normalize.service.js).
    openBalance: {
        key: "openBalance",
        label: "Open Balance (Opening Journal)",
        qboEntity: "TrialBalance",
        query: null,
        dependsOn: ["account"]
    },

    // Bill (Detailed Transactions) = every Bill, line by line, with full
    // transaction detail (account/item, tax, class, location, quantity,
    // rate...) - NOT the same thing as the "ap" module's Bill sub-sheet,
    // which only carries each bill's outstanding OPEN BALANCE as a single
    // summary row (built from the Aged Payable Detail report). This one is
    // for migrating full bill history line-by-line, fetched directly via
    // the Query API (every Bill, not just open ones) since the Reports
    // API doesn't expose line-level detail. Needs account + item fetched
    // first to resolve each line's Account/Product-Service to its full
    // Parent:Child name.
    billDetail: {
        key: "billDetail",
        label: "Bill (Detailed Transactions)",
        qboEntity: "Bill",
        query: "select * from Bill",
        dependsOn: ["account", "item"]
    },

    // Invoice (Detailed Transactions) - mirrors billDetail on the sales
    // side: every Invoice, line by line, with full product/service, tax
    // and discount detail. NOT the same thing as "ar"'s Invoice sub-sheet
    // (open-balance summary row per invoice, from the Aged Receivable
    // Detail report). Invoice lines in QBO are item-based only (no
    // account-based expense lines like Bills have), so this needs
    // customer + item fetched first, not account.
    invoiceDetail: {
        key: "invoiceDetail",
        label: "Invoice (Detailed Transactions)",
        qboEntity: "Invoice",
        query: "select * from Invoice",
        dependsOn: ["customer", "item"]
    },

    // Invoice Credit Note (Detailed Transactions) - every QBO CreditMemo, line by
    // line, in the "Adjustment Note" bulk-import layout with Global Tax
    // Calculation, tax code / tax amount and Location. Different from "ar"'s
    // Adjustment Note sheet, which is built from the open-balance aging report.
    creditMemoDetail: {
        key: "creditMemoDetail",
        label: "Invoice Credit Note (Detailed Transactions)",
        qboEntity: "CreditMemo",
        query: "select * from CreditMemo",
        dependsOn: ["customer", "item"]
    },

    // Invoice Payment: QBO Payments applied to invoices, one row per payment ->
    // invoice link (Payment.Line[].LinkedTxn). Needs account (deposit account
    // names) and customer fetched first.
    invoicePayment: {
        key: "invoicePayment",
        label: "Invoice Payment",
        qboEntity: "Payment",
        query: "select * from Payment",
        dependsOn: ["customer", "account"]
    },

    // Expense: QBO Purchase (cash expense - credit card charges go to the Credit Card module, cheques to Cheque), one row per account-based
    // expense line, in the "QBo (New)" Expense layout. Needs account fetched first.
    expense: {
        key: "expense",
        label: "Expense (Cash)",
        qboEntity: "Purchase",
        query: "select * from Purchase",
        dependsOn: ["account"]
    },

    // Credit Card: QBO Purchase with PaymentType = CreditCard, one row per account-based expense
    // line, "QBo (New)" Credit card charge (Expense) layout. Needs account fetched first.
    creditCard: {
        key: "creditCard",
        label: "Credit Card",
        qboEntity: "Purchase",
        query: "select * from Purchase",
        dependsOn: ["account"]
    },

    // Cheque: QBO Purchase with PaymentType = Check, one row per account-based expense line,
    // "QBo (New)" Cheque layout. The Expense module takes the non-cheque purchases.
    cheque: {
        key: "cheque",
        label: "Cheque",
        qboEntity: "Purchase",
        query: "select * from Purchase",
        dependsOn: ["account"]
    },

    // Deposit: QBO Deposit, one row per deposit line, "QBo (New)" Deposit layout. Needs
    // account fetched first (Deposit To Account / Line Account full names).
    deposit: {
        key: "deposit",
        label: "Deposit",
        qboEntity: "Deposit",
        query: "select * from Deposit",
        dependsOn: ["account"]
    },

    // Transfer: QBO Transfer (money moved between two accounts), one row per transfer.
    // Needs account fetched first so both accounts export with their full Account Name.
    transfer: {
        key: "transfer",
        label: "Transfer",
        qboEntity: "Transfer",
        query: "select * from Transfer",
        dependsOn: ["account"]
    },

    // Overpayment: QBO Payments (or the part of them) NOT applied to any invoice
    // (Payment.UnappliedAmt > 0), one row per payment. Separate from "Invoice Payment".
    overpayment: {
        key: "overpayment",
        label: "Overpayment",
        qboEntity: "Payment",
        query: "select * from Payment",
        dependsOn: ["customer", "account"]
    },

    // Estimates: every QBO Estimate, one row per item line, "QBo (New)" Estimates layout.
    estimate: {
        key: "estimate",
        label: "Estimates",
        qboEntity: "Estimate",
        query: "select * from Estimate",
        dependsOn: ["customer", "item"]
    },

    // Purchase Order: every QBO PurchaseOrder, one row per account-based or item-based line,
    // "QBo (New)" Purchase Order layout. Needs account + item names fetched first.
    purchaseOrder: {
        key: "purchaseOrder",
        label: "Purchase Order",
        qboEntity: "PurchaseOrder",
        query: "select * from PurchaseOrder",
        dependsOn: ["account", "item"]
    },

    // Other Journal: QBO transactions that are only visible as journal lines (no API entity of their own),
    // read from the Journal report and limited to OTHER_JOURNAL_TRANSACTION_TYPES. One row per journal line.
    otherJournal: {
        key: "otherJournal",
        label: "Other Journal Types",
        qboEntity: "JournalReport",
        query: null,
        dependsOn: ["account"]
    },

    // Invoice Credit Note Allocation: QBO Payments that apply a Credit Memo (or Journal Entry), one row per
    // Line -> linked transaction. Needs account fetched first (Deposit To Account full name).
    invoiceCreditAllocation: {
        key: "invoiceCreditAllocation",
        label: "Invoice Credit Note Allocation",
        qboEntity: "Payment",
        query: "select * from Payment",
        dependsOn: ["account"]
    },

    // Bill Payment: QBO BillPayments applied to Bills, one row per payment -> Bill link. Needs account
    // (bank / credit card account full name) fetched first.
    billPayment: {
        key: "billPayment",
        label: "Bill Payment",
        qboEntity: "BillPayment",
        query: "select * from BillPayment",
        dependsOn: ["account"]
    },

    // Bill Credit (Supplier Credit): every QBO VendorCredit, line by line, with the ZA VAT rule
    // (VAT amount present -> Standard, zero -> Out of Scope). Needs account + item fetched first.
    billCredit: {
        key: "billCredit",
        label: "Bill Credit (Supplier Credit)",
        qboEntity: "VendorCredit",
        query: "select * from VendorCredit",
        dependsOn: ["account", "item"]
    },

    // Bill Credit Note Allocation: QBO BillPayments that apply a Vendor Credit, one row per Line -> linked
    // Bill / VendorCredit. Needs account fetched first (bank / credit card account full name).
    billCreditAllocation: {
        key: "billCreditAllocation",
        label: "Bill Credit Note Allocation",
        qboEntity: "BillPayment",
        query: "select * from BillPayment",
        dependsOn: ["account"]
    },

    // Bill Overpayment: QBO BillPayments (or the part of them) NOT applied to any bill
    // (TotalAmt - applied lines > 0), one row per bill payment. Needs account fetched first
    // so the Bank / Credit Card account exports with its full Account Name.
    billOverpayment: {
        key: "billOverpayment",
        label: "Bill Overpayment",
        qboEntity: "BillPayment",
        query: "select * from BillPayment",
        dependsOn: ["account"]
    },

    // Journal Entry: every QBO JournalEntry, one row per journal line, in the
    // "QBo (New)" Journal bulk-import layout (Amount = debit - credit). Needs
    // account fetched first so line accounts export with their full Account Name.
    journal: {
        key: "journal",
        label: "Journal Entry",
        qboEntity: "JournalEntry",
        query: "select * from JournalEntry",
        dependsOn: ["account"]
    }

};

export const ENTITY_KEYS = Object.keys(ENTITIES);

export const isValidEntity = (key) => ENTITY_KEYS.includes(key);

// Resolves a requested list of entity keys into a fetch order where every
// dependency comes before the entity that needs it (topological sort).
export const resolveFetchOrder = (requestedKeys) => {

    const visited = new Set();
    const order = [];

    const visit = (key) => {
        if (visited.has(key)) return;
        if (!isValidEntity(key)) return;

        visited.add(key);

        for (const dep of ENTITIES[key].dependsOn) {
            visit(dep);
        }

        order.push(key);
    };

    requestedKeys.forEach(visit);

    return order;
};

// Team list of the QBO transaction types exported by the "Other Journal Types" module.
export const OTHER_JOURNAL_TRANSACTION_TYPES = Object.freeze([
    "Inventory Qty Adjust",
    "Inventory Starting Value from Desktop",
    "Inventory Starting Value",
    "Sales Tax Payment",
    "Item Receipt"
]);
