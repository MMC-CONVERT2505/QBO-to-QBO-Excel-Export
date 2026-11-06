import { v4 as uuidv4 } from "uuid";
import { fetchAllForExport } from "./fetch.service.js";
import { generateCombinedExport } from "./excel.service.js";
import { buildValidationReport } from "./validation.service.js";
import { logger } from "../utils/logger.js";

// In-memory job store. Fine for a single-instance deployment; if this ever
// runs behind multiple server instances or needs to survive a restart,
// swap this Map for Redis/a DB table keyed the same way - nothing else in
// the export flow needs to change.
const jobs = new Map();

const JOB_TTL_MS = 30 * 60 * 1000; // generated files are held for 30 minutes

const setStep = (job, step, status) => {
    job.steps[step] = status;
};

export const createExportJob = () => {

    const jobId = uuidv4();

    const job = {
        id: jobId,
        status: "processing", // processing | complete | failed
        createdAt: Date.now(),
        steps: {
            fetch: "pending",
            normalize: "pending",
            map: "pending",
            validate: "pending",
            generate: "pending"
        },
        report: null,
        fileBuffer: null,
        fileName: null,
        error: null
    };

    jobs.set(jobId, job);

    setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);

    return job;

};

export const getExportJob = (jobId) => jobs.get(jobId) || null;

// Runs the full pipeline (fetch -> normalize -> map -> validate ->
// generate a single combined Excel workbook) for a job. Called
// fire-and-forget from the controller right after createExportJob() so
// the HTTP response doesn't block on what can be a slow QBO fetch for
// large companies.
export const runExportJob = async (jobId, qboSession, region, requestedKeys, asOfDate, filters = {}, ctx = null) => {

    const job = jobs.get(jobId);
    if (!job) return;

    try {

        setStep(job, "fetch", "in_progress");
        const dataset = await fetchAllForExport(qboSession, requestedKeys, asOfDate, filters);
        setStep(job, "fetch", "done");
        setStep(job, "normalize", "done"); // normalization happens inline during fetch

        setStep(job, "map", "in_progress");
        setStep(job, "validate", "in_progress");
        const report = buildValidationReport(dataset, region, requestedKeys, ctx);
        setStep(job, "map", "done");
        setStep(job, "validate", "done");

        setStep(job, "generate", "in_progress");
        const { buffer, summary } = await generateCombinedExport(region, dataset, requestedKeys, ctx);

        job.fileBuffer = buffer;
        job.fileName = `QBO-Export-${region}-${new Date().toISOString().slice(0, 10)}.xlsx`;

        setStep(job, "generate", "done");

        job.report = report;
        job.summary = summary;

        job.status = "complete";

    } catch (error) {

        logger.error(`Export job ${jobId} failed:`, error.message);

        job.status = "failed";
        job.error = error.message || "Export failed unexpectedly.";

    }

};
