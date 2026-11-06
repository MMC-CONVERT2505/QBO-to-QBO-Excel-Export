import {
    createExportJob,
    runExportJob,
    getExportJob
} from "../services/exportJob.service.js";
import { resolveFetchOrder, isValidEntity } from "../config/entities.js";
import { isValidRegion } from "../config/regions.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { parseDateRanges } from "../utils/dateRange.js";
import { getTaxMappingContext } from "../services/taxMapping.service.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/export
// Body: { region: "CA", modules: ["account", "customer"], asOfDate: "2025-12-31" }
// asOfDate is optional and only affects AR/AP: it restricts them to
// transactions dated on or before that date which are STILL open today
// (see fetch.service.js for why this isn't a true historical snapshot).
// Other modules ignore it. Kicks off the export pipeline as a background
// job and returns immediately with a jobId to poll - large QBO companies
// (thousands of records) can take a while to fetch, so we never block
// the HTTP request on the full pipeline.
export const startExport = asyncHandler(async (req, res) => {

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

    // Open Balance has no sensible "latest open items" default the way
    // AR/AP does - it's always a balance AS OF a specific conversion
    // cutoff date, so that date is mandatory for this module.
    if (modules.includes("openBalance") && !(asOfDate && ISO_DATE.test(asOfDate))) {
        throw new AppError("A conversion cutoff date (asOfDate) is required for the Open Balance module.", 400);
    }

    // Optional Start/End Date filters for Invoice and Bill (TxnDate); invalid
    // dates or Start > End are rejected here with a 400.
    const filters = parseDateRanges(dateRanges);

    const job = createExportJob();
    const requestedKeys = resolveFetchOrder(modules);

    // Fire and forget - the qboSession is captured now (from this
    // authenticated request) so the background job doesn't need req/res.
    const taxCtx = getTaxMappingContext(req.qboSession, region);
    runExportJob(job.id, req.qboSession, region, requestedKeys, asOfDate, filters, taxCtx ? { region, ...taxCtx } : null);

    res.status(202).json({
        success: true,
        jobId: job.id,
        status: job.status
    });

});

// GET /api/export/:jobId/status
export const getExportStatus = (req, res) => {

    const job = getExportJob(req.params.jobId);

    if (!job) {
        throw new AppError("Export job not found or has expired.", 404);
    }

    res.status(200).json({
        success: true,
        jobId: job.id,
        status: job.status,
        steps: job.steps,
        summary: job.summary || null,
        report: job.status === "complete" ? job.report : undefined,
        error: job.error
    });

};

// GET /api/export/:jobId/download
export const downloadExport = (req, res) => {

    const job = getExportJob(req.params.jobId);

    if (!job) {
        throw new AppError("Export job not found or has expired.", 404);
    }

    if (job.status !== "complete") {
        throw new AppError("Export is not ready yet.", 409);
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${job.fileName}"`);
    res.send(job.fileBuffer);

};
