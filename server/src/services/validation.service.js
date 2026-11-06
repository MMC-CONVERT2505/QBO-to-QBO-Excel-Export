import { mapCollection } from "./mapping.service.js";
import { flattenForExport } from "./flatten.service.js";
import { COMPOSITE_ENTITIES, isCompositeEntity } from "../config/compositeEntities.js";

// Turns raw mapped rows + issues into the per-entity summary shape the
// frontend's validation screen expects (mapped / needs attention / invalid
// counts, plus the actual row-level detail for a preview table).
export const buildEntityReport = (entityKey, records, region, ctx = null) => {

    const flatRecords = flattenForExport(entityKey, records, ctx);

    const { config, mapped } = mapCollection(entityKey, flatRecords, region);

    let mappedCount = 0;
    let needsAttentionCount = 0;
    let invalidCount = 0;

    const rows = mapped.map(({ sourceId, row, issues }) => {

        let status = "mapped";

        if (issues.length > 0) {
            // Missing a required field makes the row unusable as-is;
            // anything else is a soft "needs attention" warning.
            const hasRequiredMiss = issues.some((i) => i.type === "missing_required" || i.type === "unresolved_tax_mapping");
            status = hasRequiredMiss ? "invalid" : "needs_attention";
        }

        if (status === "mapped") mappedCount += 1;
        else if (status === "needs_attention") needsAttentionCount += 1;
        else invalidCount += 1;

        return { sourceId, status, issues, row };

    });

    const report = {
        entity: entityKey,
        templateSheet: config.templateSheet,
        total: flatRecords.length,
        mappedCount,
        needsAttentionCount,
        invalidCount,
        rows
    };

    // Lookup misses (e.g. an Account Type with no entry in the client's
    // mapping sheet) are listed with counts so they can be reviewed and the
    // mapping sheet completed - these rows are still exported, but flagged.
    const unmapped = {};
    rows.forEach(({ issues }) => {
        issues.filter((i) => i.type === "unmapped_account_type" || i.type === "unmapped_lookup").forEach((i) => {
            const key = `${i.field}: ${i.value === "" ? "(blank)" : i.value}`;
            unmapped[key] = (unmapped[key] || 0) + 1;
        });
    });
    if (Object.keys(unmapped).length > 0) report.unmappedValues = unmapped;

    // The Open Balance journal's lines must sum to zero (every debit
    // needs a matching credit) - surface that check directly on the
    // report so the review screen can flag it before the user downloads
    // a journal QBO's own import would reject as unbalanced.
    if (entityKey === "openBalance") {

        const totalAmount = flatRecords.reduce((sum, record) => sum + (Number(record.amount) || 0), 0);
        const rounded = Math.round((totalAmount + Number.EPSILON) * 100) / 100;

        report.balanceCheck = {
            totalAmount: rounded,
            balanced: Math.abs(rounded) < 0.01
        };

    }

    return report;

};

// Builds the report for every requested entity in one shot - this is what
// backs both the /mapping/preview endpoint and the pre-export validation
// gate. A composite module (ar/ap) produces one report per sub-sheet
// (e.g. "ar_invoice", "ar_creditmemo") so the review screen shows them
// as separate cards, matching how they'll appear as separate sheets in
// the final download.
export const buildValidationReport = (dataset, region, requestedKeys, ctx = null) => {

    const entities = {};

    for (const key of requestedKeys) {

        if (isCompositeEntity(key)) {

            const allRecords = dataset[key] || [];

            for (const sub of COMPOSITE_ENTITIES[key]) {
                const records = allRecords.filter((record) => record.docType === sub.docType);
                entities[sub.subKey] = buildEntityReport(sub.subKey, records, region, ctx);
            }

            continue;

        }

        entities[key] = buildEntityReport(key, dataset[key] || [], region, ctx);

    }

    return entities;

};
