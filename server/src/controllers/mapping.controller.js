import { fetchAllForExport } from "../services/fetch.service.js";
import { buildValidationReport } from "../services/validation.service.js";
import { resolveFetchOrder, isValidEntity } from "../config/entities.js";
import { isValidRegion } from "../config/regions.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { parseDateRanges } from "../utils/dateRange.js";
import { getTaxMappingContext } from "../services/taxMapping.service.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/mapping/preview
// Body: { region: "CA", modules: ["account", "customer", "ar"], asOfDate: "2025-12-31" }
// asOfDate is optional and only affects AR/AP: it restricts them to
// transactions dated on or before that date which are STILL open today
// (see fetch.service.js for why this isn't a true historical snapshot).
// Other modules ignore it.
//
// Fetches the requested modules from the source company, maps them against
// the destination region's templates, and returns per-entity validation
// summaries + row-level detail - this powers the "Data Preview" and
// "Validation" screens BEFORE the user commits to generating Excel files.
export const previewMapping = asyncHandler(async (req, res) => {

    const { region, modules, asOfDate, dateRanges } = req.body;

    if (!isValidRegion(region)) {
        throw new AppError("A valid destination region is required.", 400);
    }

    if (!Array.isArray(modules) || modules.length === 0) {
        throw new AppError("At least one accounting module must be selected.", 400);
    }

    const invalidModules = modules.filter((m) => !isValidEntity(m));
    if (invalidModules.length > 0) {
        throw new AppError(`Unknown module(s): ${invalidModules.join(", ")}`, 400);
    }

    if (modules.includes("openBalance") && !(asOfDate && ISO_DATE.test(asOfDate))) {
        throw new AppError("A conversion cutoff date (asOfDate) is required for the Open Balance module.", 400);
    }

    // Optional Start/End Date filters for Invoice and Bill (TxnDate); invalid
    // dates or Start > End are rejected here with a 400.
    const filters = parseDateRanges(dateRanges);

    const requestedKeys = resolveFetchOrder(modules);
    const dataset = await fetchAllForExport(req.qboSession, requestedKeys, asOfDate, filters);
    const taxCtx = getTaxMappingContext(req.qboSession, region);
    const report = buildValidationReport(dataset, region, modules, taxCtx ? { region, ...taxCtx } : null);

    res.status(200).json({
        success: true,
        region,
        modules,
        report
    });

});
