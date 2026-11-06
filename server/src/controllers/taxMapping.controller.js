import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { isValidRegion } from "../config/regions.js";
import { fetchSourceTaxes, loadTaxMapping, buildTaxMappingTable, saveTaxMappingChanges } from "../services/taxMapping.service.js";

const requireRegion = (value) => {
    if (!isValidRegion(value)) throw new AppError("A valid destination region is required.", 400);
    return String(value).toUpperCase();
};

// Honest statement about what this tool can/cannot do for the target company.
const TARGET_NOTE = {
    targetCreationSupported: false,
    message: "This tool is connected to the SOURCE company only. It cannot read or create tax codes in the target company. " +
        "A tax you enter here must already exist in the target company (create it there before migration) - it is only used as the name written to the export."
};

// GET /api/tax-mapping?region=ZA
export const getTaxMapping = asyncHandler(async (req, res) => {
    const region = requireRegion(req.query.region);
    const taxes = await fetchSourceTaxes(req.qboSession);
    const mapping = loadTaxMapping(req.qboSession.realmId, region);
    const { rows, counts } = buildTaxMappingTable(taxes, mapping);
    res.status(200).json({ success: true, region, enabled: mapping.enabled, counts, rows, target: TARGET_NOTE });
});

// PUT /api/tax-mapping
// Body: { region, enabled?, changes: [{ sourceId, action: "accept-suggestion"|"set"|"clear", targetName, targetRate, targetType, calcType, confirmed }] }
export const saveTaxMapping = asyncHandler(async (req, res) => {
    const region = requireRegion(req.body?.region);
    const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
    const taxes = await fetchSourceTaxes(req.qboSession);
    let mapping;
    try {
        mapping = saveTaxMappingChanges(req.qboSession.realmId, region, taxes, { enabled: req.body?.enabled, changes });
    } catch (error) {
        if (error.fieldErrors) return res.status(400).json({ success: false, message: error.message, fieldErrors: error.fieldErrors });
        throw error;
    }
    const { rows, counts } = buildTaxMappingTable(taxes, mapping);
    res.status(200).json({ success: true, region, enabled: mapping.enabled, counts, rows, target: TARGET_NOTE });
});
