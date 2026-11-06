// One-time generator for the default mapping configs shipped with the app
// (src/mappings/<REGION>/<entity>.json). These are reasonable, working
// defaults modeled on QBO's own field names and standard accounting
// terminology per region - NOT the client's real destination templates.
//
// Once real destination Excel templates are provided, re-run a regenerated
// version of this script (or hand-edit the JSON directly) to match their
// actual headers/columns. The JSON schema itself does not change.
//
// Usage: node scripts/generateMappings.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAPPINGS_DIR = path.join(__dirname, "..", "src", "mappings");

const REGIONS = {
    US: { taxLabel: "Sales Tax", currency: "USD" },
    CA: { taxLabel: "GST/HST", currency: "CAD" },
    UK: { taxLabel: "VAT", currency: "GBP" },
    AU: { taxLabel: "GST", currency: "AUD" },
    NZ: { taxLabel: "GST", currency: "NZD" }
};

// Column builders receive the region's metadata so a handful of fields
// (currency default, tax terminology, account-type wording) can vary per
// region without branching logic anywhere else in the app - everything
// region-specific lives in this data.

const accountColumns = (region) => [
    { header: "Account Name", source: "name", required: true, transform: "trim" },
    {
        header: "Account Type",
        source: "accountType",
        required: true,
        valueMap: {
            Income: "Income Account",
            Expense: "Expense Account",
            Bank: "Bank",
            "Accounts Receivable": "Accounts Receivable",
            "Accounts Payable": "Accounts Payable",
            "Fixed Asset": "Fixed Asset",
            "Other Current Asset": "Current Asset",
            "Other Current Liability": "Current Liability",
            "Long Term Liability": "Long Term Liability",
            Equity: "Equity",
            "Cost of Goods Sold": "Cost of Goods Sold"
        }
    },
    { header: "Account Sub Type", source: "accountSubType" },
    { header: "Account Number", source: "accountNumber" },
    { header: "Description", source: "description" },
    { header: "Currency", source: "currency", defaultValue: region.currency },
    { header: "Parent Account", source: "parentAccountId" },
    { header: "Status", source: "active", valueMap: { true: "Active", false: "Inactive" } }
];

const customerColumns = (region) => [
    { header: "Customer Name", source: "displayName", required: true, transform: "trim" },
    { header: "Company Name", source: "companyName" },
    { header: "First Name", source: "firstName" },
    { header: "Last Name", source: "lastName" },
    { header: "Email", source: "email" },
    { header: "Phone", source: "phone" },
    { header: "Billing Address Line 1", source: "billingLine1" },
    { header: "Billing City", source: "billingCity" },
    { header: "Billing Region/State", source: "billingRegion" },
    { header: "Billing Postal Code", source: "billingPostalCode" },
    { header: "Billing Country", source: "billingCountry" },
    { header: "Currency", source: "currency", defaultValue: region.currency },
    { header: `${region.taxLabel} Registered`, source: "taxable", valueMap: { true: "Yes", false: "No" } },
    { header: "Status", source: "active", valueMap: { true: "Active", false: "Inactive" } }
];

const vendorColumns = (region) => [
    { header: "Vendor Name", source: "displayName", required: true, transform: "trim" },
    { header: "Company Name", source: "companyName" },
    { header: "Email", source: "email" },
    { header: "Phone", source: "phone" },
    { header: "Billing Address Line 1", source: "billingLine1" },
    { header: "Billing City", source: "billingCity" },
    { header: "Billing Country", source: "billingCountry" },
    { header: "Tax ID", source: "taxIdentifier" },
    { header: "1099 Vendor", source: "is1099", valueMap: { true: "Yes", false: "No" } },
    { header: "Status", source: "active", valueMap: { true: "Active", false: "Inactive" } }
];

const itemColumns = () => [
    { header: "Item Name", source: "name", required: true, transform: "trim" },
    {
        header: "Type",
        source: "type",
        required: true,
        valueMap: { Inventory: "Inventory Item", NonInventory: "Non-Inventory Item", Service: "Service Item" }
    },
    { header: "SKU", source: "sku" },
    { header: "Description", source: "description" },
    { header: "Sales Price", source: "unitPrice", defaultValue: 0 },
    { header: "Purchase Cost", source: "purchaseCost", defaultValue: 0 },
    { header: "Income Account", source: "incomeAccountName", required: true },
    { header: "Expense Account", source: "expenseAccountName" },
    { header: "Taxable", source: "taxable", valueMap: { true: "Yes", false: "No" } },
    { header: "Status", source: "active", valueMap: { true: "Active", false: "Inactive" } }
];

// Invoice/Bill are exported as one row per line item (the common shape
// destination accounting-import templates expect), so their columns pull
// from both the header-level normalized fields and per-line fields that
// the export pipeline flattens before mapping (see excel.service.js).
const invoiceColumns = (region) => [
    { header: "Invoice Number", source: "docNumber", required: true },
    { header: "Invoice Date", source: "txnDate", required: true },
    { header: "Due Date", source: "dueDate" },
    { header: "Customer", source: "customerName", required: true },
    { header: "Line Description", source: "lineDescription" },
    { header: "Item", source: "lineItemName" },
    { header: "Quantity", source: "lineQuantity", defaultValue: 1 },
    { header: "Unit Price", source: "lineUnitPrice", defaultValue: 0 },
    { header: "Line Amount", source: "lineAmount", required: true },
    { header: `${region.taxLabel} Code`, source: "lineTaxCode" },
    { header: "Currency", source: "currency", defaultValue: region.currency },
    { header: "Total Amount", source: "totalAmount" },
    { header: "Status", source: "status" }
];

const billColumns = (region) => [
    { header: "Bill Number", source: "docNumber" },
    { header: "Bill Date", source: "txnDate", required: true },
    { header: "Due Date", source: "dueDate" },
    { header: "Vendor", source: "vendorName", required: true },
    { header: "Line Description", source: "lineDescription" },
    { header: "Account", source: "lineAccountName" },
    { header: "Item", source: "lineItemName" },
    { header: "Line Amount", source: "lineAmount", required: true },
    { header: `${region.taxLabel} Code`, source: "lineTaxCode" },
    { header: "Currency", source: "currency", defaultValue: region.currency },
    { header: "Total Amount", source: "totalAmount" },
    { header: "Status", source: "status" }
];

const ENTITY_BUILDERS = {
    account: { sheet: "Accounts", columns: accountColumns },
    customer: { sheet: "Customers", columns: customerColumns },
    vendor: { sheet: "Vendors", columns: vendorColumns },
    item: { sheet: "Items", columns: itemColumns },
    invoice: { sheet: "Invoices", columns: invoiceColumns },
    bill: { sheet: "Bills", columns: billColumns }
};

for (const [regionCode, regionMeta] of Object.entries(REGIONS)) {

    const regionDir = path.join(MAPPINGS_DIR, regionCode);
    fs.mkdirSync(regionDir, { recursive: true });

    for (const [entityKey, builder] of Object.entries(ENTITY_BUILDERS)) {

        const config = {
            entity: entityKey,
            region: regionCode,
            templateSheet: builder.sheet,
            columns: builder.columns(regionMeta)
        };

        const filePath = path.join(regionDir, `${entityKey}.json`);
        fs.writeFileSync(filePath, JSON.stringify(config, null, 4) + "\n");

    }

}

console.log("Mapping configs generated for regions:", Object.keys(REGIONS).join(", "));
