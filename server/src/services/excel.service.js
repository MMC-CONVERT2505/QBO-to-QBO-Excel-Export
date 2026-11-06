import ExcelJS from "exceljs";
import { loadTemplateWorkbook } from "./template.service.js";
import { loadMappingConfig, mapCollection } from "./mapping.service.js";
import { flattenForExport } from "./flatten.service.js";
import { COMPOSITE_ENTITIES, isCompositeEntity } from "../config/compositeEntities.js";
import { logger } from "../utils/logger.js";

// Fills ONE entity's real destination template (preserving its sheet name,
// header row and column order) with mapped rows. Returns the live ExcelJS
// sheet (not yet serialized) so callers can either save it standalone or
// copy it into a combined workbook alongside other entities.
//
// Only rows missing a required field are skipped from the output - rows
// that only have soft "needs attention" warnings are still written, since
// reaching this step means the user reviewed the validation screen and
// chose to proceed.
const fillEntityTemplate = async (region, entityKey, records, ctx = null) => {

    const config = loadMappingConfig(region, entityKey);
    const workbook = await loadTemplateWorkbook(region, entityKey);
    const sheet = workbook.getWorksheet(config.templateSheet);

    // Map header text -> column index from the template's ACTUAL row 1,
    // so we write into the real template's column order even if it
    // differs from our config's declaration order (this is what lets a
    // client-provided template "just work" once dropped in).
    const headerRow = sheet.getRow(1);
    const columnIndexByHeader = {};

    headerRow.eachCell((cell, colNumber) => {
        columnIndexByHeader[String(cell.value).trim()] = colNumber;
    });

    const flatRecords = flattenForExport(entityKey, records, ctx);
    const { mapped } = mapCollection(entityKey, flatRecords, region);

    let writtenRows = 0;
    let skippedRows = 0;

    mapped.forEach(({ row, issues }) => {

        const hasRequiredMiss = issues.some((issue) => issue.type === "missing_required" || issue.type === "unresolved_tax_mapping");

        if (hasRequiredMiss) {
            skippedRows += 1;
            return;
        }

        const targetRow = sheet.getRow(headerRow.number + 1 + writtenRows);

        for (const [header, value] of Object.entries(row)) {
            const colNumber = columnIndexByHeader[header];
            if (colNumber) {
                targetRow.getCell(colNumber).value = value;
            }
        }

        targetRow.commit();
        writtenRows += 1;

    });

    logger.info(`${entityKey}: wrote ${writtenRows} row(s) to ${config.templateSheet}, skipped ${skippedRows} invalid`);

    return { entityKey, sheetName: config.templateSheet, sheet, writtenRows, skippedRows };

};

// Copies a filled worksheet's values, styles and column widths into a
// worksheet of the same name inside another (combined) workbook. A plain
// value+style copy is enough here since our templates are simple data
// grids, not formula-driven models.
const copySheetInto = (targetWorkbook, sourceSheet, sheetName) => {

    const targetSheet = targetWorkbook.addWorksheet(sheetName);

    targetSheet.columns = sourceSheet.columns.map((col) => ({ width: col.width }));

    sourceSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {

        const targetRow = targetSheet.getRow(rowNumber);

        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            const targetCell = targetRow.getCell(colNumber);
            targetCell.value = cell.value;
            targetCell.style = cell.style;
        });

        targetRow.commit();

    });

};

// Generates one standalone workbook buffer for a single entity - kept for
// any caller that wants just one entity's file on its own.
export const generateEntityWorkbook = async (region, entityKey, records) => {

    const { sheetName, sheet, writtenRows, skippedRows } = await fillEntityTemplate(region, entityKey, records);
    const buffer = await sheet.workbook.xlsx.writeBuffer();

    return {
        entityKey,
        sheetName,
        fileName: `${sheetName}.xlsx`,
        writtenRows,
        skippedRows,
        buffer
    };

};

// Generates ONE combined .xlsx workbook for every requested module - one
// sheet per entity (e.g. "Accounts", "Customers", "Vendors") - so the user
// downloads a single Excel file instead of a zip of separate files.
// A composite module (ar/ap) fans out into multiple sheets (Invoice +
// Adjustment Note, Bill + Vendor Credit), each filtered from the same
// fetched dataset by docType.
export const generateCombinedExport = async (region, dataset, requestedKeys, ctx = null) => {

    const masterWorkbook = new ExcelJS.Workbook();
    const summary = [];

    const fillAndCollect = async (entityKey, records) => {

        const { sheetName, sheet, writtenRows, skippedRows } = await fillEntityTemplate(
            region,
            entityKey,
            records,
            ctx
        );

        copySheetInto(masterWorkbook, sheet, sheetName);
        summary.push({ entityKey, sheetName, writtenRows, skippedRows });

    };

    for (const entityKey of requestedKeys) {

        if (isCompositeEntity(entityKey)) {

            const allRecords = dataset[entityKey] || [];

            for (const sub of COMPOSITE_ENTITIES[entityKey]) {
                const records = allRecords.filter((record) => record.docType === sub.docType);
                await fillAndCollect(sub.subKey, records);
            }

            continue;

        }

        await fillAndCollect(entityKey, dataset[entityKey] || []);

    }

    const buffer = await masterWorkbook.xlsx.writeBuffer();

    return { buffer, summary };

};
