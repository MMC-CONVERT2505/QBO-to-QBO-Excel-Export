import { AppError } from "./AppError.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isRealDate = (value) => {
    if (!ISO_DATE.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

// Validates ONE optional { startDate, endDate } range (both "YYYY-MM-DD",
// either or both may be omitted/blank). Returns a clean object or null.
export const parseDateRange = (range, label) => {

    if (!range || typeof range !== "object") return null;

    const startDate = String(range.startDate ?? "").trim();
    const endDate = String(range.endDate ?? "").trim();

    if (!startDate && !endDate) return null;

    if (startDate && !isRealDate(startDate)) {
        throw new AppError(`${label}: Start Date must be a valid date (YYYY-MM-DD).`, 400);
    }
    if (endDate && !isRealDate(endDate)) {
        throw new AppError(`${label}: End Date must be a valid date (YYYY-MM-DD).`, 400);
    }
    if (startDate && endDate && startDate > endDate) {
        throw new AppError(`${label}: Start Date cannot be after End Date.`, 400);
    }

    return { startDate: startDate || null, endDate: endDate || null };

};

// { invoiceDetail: {startDate,endDate}, billDetail: {...} } from a request
// body; only modules that support a range are read, others are ignored.
export const parseDateRanges = (dateRanges) => {

    const filters = {};

    const invoice = parseDateRange(dateRanges?.invoiceDetail, "Invoice");
    if (invoice) filters.invoiceDetail = invoice;

    const creditMemo = parseDateRange(dateRanges?.creditMemoDetail, "Invoice Credit Note");
    if (creditMemo) filters.creditMemoDetail = creditMemo;

    const payment = parseDateRange(dateRanges?.invoicePayment, "Invoice Payment");
    if (payment) filters.invoicePayment = payment;

    const cheque = parseDateRange(dateRanges?.cheque, "Cheque");
    if (cheque) filters.cheque = cheque;

    const creditCard = parseDateRange(dateRanges?.creditCard, "Credit Card");
    if (creditCard) filters.creditCard = creditCard;

    const deposit = parseDateRange(dateRanges?.deposit, "Deposit");
    if (deposit) filters.deposit = deposit;

    const transfer = parseDateRange(dateRanges?.transfer, "Transfer");
    if (transfer) filters.transfer = transfer;

    const expense = parseDateRange(dateRanges?.expense, "Expense");
    if (expense) filters.expense = expense;

    const overpayment = parseDateRange(dateRanges?.overpayment, "Overpayment (Conversion Period)");
    if (overpayment) filters.overpayment = overpayment;

    const billOverpayment = parseDateRange(dateRanges?.billOverpayment, "Bill Overpayment (Conversion Period)");
    if (billOverpayment) filters.billOverpayment = billOverpayment;

    const invoiceCreditAllocation = parseDateRange(dateRanges?.invoiceCreditAllocation, "Invoice Credit Note Allocation");
    if (invoiceCreditAllocation) filters.invoiceCreditAllocation = invoiceCreditAllocation;

    const billCreditAllocation = parseDateRange(dateRanges?.billCreditAllocation, "Bill Credit Note Allocation");
    if (billCreditAllocation) filters.billCreditAllocation = billCreditAllocation;

    const billPayment = parseDateRange(dateRanges?.billPayment, "Bill Payment");
    if (billPayment) filters.billPayment = billPayment;

    const billCredit = parseDateRange(dateRanges?.billCredit, "Bill Credit");
    if (billCredit) filters.billCredit = billCredit;

    const otherJournal = parseDateRange(dateRanges?.otherJournal, "Other Journal Types");
    if (otherJournal) filters.otherJournal = otherJournal;

    const estimate = parseDateRange(dateRanges?.estimate, "Estimates");
    if (estimate) filters.estimate = estimate;

    const purchaseOrder = parseDateRange(dateRanges?.purchaseOrder, "Purchase Order");
    if (purchaseOrder) filters.purchaseOrder = purchaseOrder;

    const journal = parseDateRange(dateRanges?.journal, "Journal Entry");
    if (journal) filters.journal = journal;

    const bill = parseDateRange(dateRanges?.billDetail, "Bill");
    if (bill) filters.billDetail = bill;

    return filters;

};

// QBO query for an entity restricted by TRANSACTION DATE (TxnDate - the
// date shown on the invoice/bill itself). Both bounds are inclusive.
// QBO's query language supports AND (not OR) and quoted date literals.
export const buildTxnDateQuery = (entityName, range) => {

    const conditions = [];
    if (range?.startDate) conditions.push(`TxnDate >= '${range.startDate}'`);
    if (range?.endDate) conditions.push(`TxnDate <= '${range.endDate}'`);

    return conditions.length > 0
        ? `select * from ${entityName} where ${conditions.join(" and ")}`
        : `select * from ${entityName}`;

};
