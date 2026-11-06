import { fetchCompanyInfo, fetchEntity } from "../services/fetch.service.js";
import { detectRegionFromCountry } from "../config/regions.js";
import { isValidEntity } from "../config/entities.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { diagnoseOpenBalance, diagnoseItems, diagnoseInvoiceTaxCodes } from "../services/diagnostics.service.js";

// GET /api/qbo/company-info
// Also detects the source region from the connected company's country, so
// the frontend can show "Source Region: United States (detected)".
export const getCompanyInfo = asyncHandler(async (req, res) => {

    const info = await fetchCompanyInfo(req.qboSession);

    const detectedRegion = detectRegionFromCountry(info.Country);

    res.status(200).json({
        success: true,
        companyName: info.CompanyName,
        legalName: info.LegalName,
        country: info.Country,
        detectedRegion,
        email: info.Email?.Address,
        fiscalYearStartMonth: info.FiscalYearStartMonth
    });

});

// Plural URL segment -> internal singular entity key, so routes read
// naturally (/api/qbo/accounts) while everything else in the app (config,
// mapping files, normalizers) uses the singular key consistently.
const PLURAL_TO_ENTITY_KEY = {
    accounts: "account",
    customers: "customer",
    vendors: "vendor",
    items: "item",
    ar: "ar",
    ap: "ap"
};

// GET /api/qbo/:entityPlural  (e.g. /api/qbo/accounts, /api/qbo/customers)
// Generic preview endpoint - fetches + normalizes one entity's data from
// the source company without mapping/exporting it yet.
export const getEntityData = asyncHandler(async (req, res) => {

    const entityKey = PLURAL_TO_ENTITY_KEY[req.params.entityPlural];

    if (!entityKey || !isValidEntity(entityKey)) {
        throw new AppError(`Unknown entity: ${req.params.entityPlural}`, 400);
    }

    const records = await fetchEntity(req.qboSession, entityKey);

    res.status(200).json({
        success: true,
        entity: entityKey,
        count: records.length,
        records
    });

});


// GET /api/qbo/diagnostics/open-balance?asOfDate=YYYY-MM-DD
// Read-only. Returns structural counts only (no names/amounts/tokens).
export const getOpenBalanceDiagnostics = asyncHandler(async (req, res) => {

    const { asOfDate } = req.query;

    if (!asOfDate || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
        throw new AppError("asOfDate (YYYY-MM-DD) is required.", 400);
    }

    const result = await diagnoseOpenBalance(req.qboSession, asOfDate);

    res.status(200).json({ success: true, ...result });

});


// GET /api/qbo/diagnostics/items - read-only, counts only (no names/ids).
export const getItemDiagnostics = asyncHandler(async (req, res) => {
    const result = await diagnoseItems(req.qboSession);
    res.status(200).json({ success: true, ...result });
});

// GET /api/qbo/diagnostics/invoice-tax-codes?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// read-only: where each exported invoice tax code comes from (ids, names, line counts only).
export const getInvoiceTaxCodeDiagnostics = asyncHandler(async (req, res) => {
    const result = await diagnoseInvoiceTaxCodes(req.qboSession, {
        startDate: req.query.startDate || null,
        endDate: req.query.endDate || null,
        entity: ["CreditMemo", "Purchase", "Deposit"].includes(req.query.entity) ? req.query.entity : "Invoice"
    });
    res.status(200).json({ success: true, ...result });
});
