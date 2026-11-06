import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { AppError } from "../utils/AppError.js";
import { isValidRegion, REGION_CODES } from "../config/regions.js";
import { COMPOSITE_ENTITIES } from "../config/compositeEntities.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "..", "templates");

// Simple, one-sheet-per-module entities.
const SIMPLE_ENTITY_FILE_NAME = {
    account: "Account",
    customer: "Customer",
    vendor: "Vendor",
    item: "Item",
    openBalance: "OpenBalance",
    billDetail: "BillDetail",
    invoiceDetail: "InvoiceDetail",
    creditMemoDetail: "CreditMemoDetail",
    invoicePayment: "InvoicePayment",
    journal: "Journal",
    overpayment: "Overpayment",
    expense: "Expense",
    transfer: "Transfer",
    deposit: "Deposit",
    cheque: "Cheque",
    creditCard: "CreditCard",
    billOverpayment: "BillOverpayment",
    estimate: "Estimate",
    otherJournal: "OtherJournal",
    invoiceCreditAllocation: "InvoiceCreditAllocation",
    billCreditAllocation: "BillCreditAllocation",
    billPayment: "BillPayment",
    billCredit: "SupplierCredit",
    purchaseOrder: "PurchaseOrder"
};

// Sub-template file names for composite modules (see compositeEntities.js)
// - e.g. "ar_invoice" -> "Invoice.xlsx", "ar_creditmemo" -> "AdjustmentNote.xlsx".
const COMPOSITE_SUB_FILE_NAME = Object.fromEntries(
    Object.values(COMPOSITE_ENTITIES).flat().map((sub) => [sub.subKey, sub.fileName])
);

const ENTITY_FILE_NAME = { ...SIMPLE_ENTITY_FILE_NAME, ...COMPOSITE_SUB_FILE_NAME };

export const getTemplatePath = (region, entityKey) => {

    const fileName = ENTITY_FILE_NAME[entityKey];

    if (!fileName) {
        throw new AppError(`No template file mapping for entity: ${entityKey}`, 400);
    }

    return path.join(TEMPLATES_DIR, region.toUpperCase(), `${fileName}.xlsx`);

};

// Lists which modules actually have all their template file(s) on disk
// for a region - lets the frontend only offer modules that region can
// currently export. A composite module (ar/ap) only counts as available
// once EVERY one of its sub-templates exists.
export const listAvailableTemplates = (region) => {

    if (!isValidRegion(region)) {
        throw new AppError(`Unsupported destination region: ${region}`, 400);
    }

    const regionDir = path.join(TEMPLATES_DIR, region.toUpperCase());

    if (!fs.existsSync(regionDir)) return [];

    const hasFile = (fileName) => fs.existsSync(path.join(regionDir, `${fileName}.xlsx`));

    const simple = Object.entries(SIMPLE_ENTITY_FILE_NAME)
        .filter(([, fileName]) => hasFile(fileName))
        .map(([entityKey]) => entityKey);

    const composite = Object.entries(COMPOSITE_ENTITIES)
        .filter(([, subs]) => subs.every((sub) => hasFile(sub.fileName)))
        .map(([entityKey]) => entityKey);

    return [...simple, ...composite];

};

export const listAllRegionTemplates = () => {
    const result = {};
    for (const region of REGION_CODES) {
        result[region] = listAvailableTemplates(region);
    }
    return result;
};

// Loads the destination template workbook for one entity so the Excel
// export step can fill it in place (preserving its sheet name, header
// row, column order and any existing formatting) rather than building a
// brand new spreadsheet from scratch.
export const loadTemplateWorkbook = async (region, entityKey) => {

    const filePath = getTemplatePath(region, entityKey);

    if (!fs.existsSync(filePath)) {
        throw new AppError(
            `Template not found for ${entityKey} in region ${region}. Upload it to templates/${region.toUpperCase()}/.`,
            404
        );
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    return workbook;

};
