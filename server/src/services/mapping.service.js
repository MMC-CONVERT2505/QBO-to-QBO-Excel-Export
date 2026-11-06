import { debugInvoiceJson, isInvoiceDebugEnabled } from "../utils/debugInvoice.js";
import { debugJson } from "../utils/debugJson.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AppError } from "../utils/AppError.js";
import { isValidRegion } from "../config/regions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAPPINGS_DIR = path.join(__dirname, "..", "mappings");

// Lookup tables (e.g. the client's Account Type -> Detail Type sheet,
// converted to JSON by scripts/buildAccountTypeMap.js) are cached the same way.
const lookupCache = new Map();

const loadLookupTable = (region, file) => {
    const cacheKey = `${region}:${file}`;
    if (!lookupCache.has(cacheKey)) {
        const filePath = path.join(MAPPINGS_DIR, region.toUpperCase(), file);
        if (!fs.existsSync(filePath)) {
            throw new AppError(`Lookup table ${file} not found for region ${region}.`, 500);
        }
        lookupCache.set(cacheKey, JSON.parse(fs.readFileSync(filePath, "utf-8")));
    }
    return lookupCache.get(cacheKey);
};

// Mapping configs are static JSON on disk (one file per region per entity),
// so we cache them in memory after first read instead of re-reading on
// every export request.
const configCache = new Map();

// Reads a dotted path off an object, e.g. "billing.city" -> obj.billing.city
const getByPath = (obj, dottedPath) =>
    dottedPath.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);

export const loadMappingConfig = (region, entityKey) => {

    if (!isValidRegion(region)) {
        throw new AppError(`Unsupported destination region: ${region}`, 400);
    }

    // entityKey may be a top-level module (account, customer...) or an
    // internal composite sub-key (ar_invoice, ar_creditmemo...) that
    // isn't independently selectable - both resolve to a real mapping
    // file on disk, checked just below, so no separate whitelist check
    // is needed here.

    const cacheKey = `${region}:${entityKey}`;

    if (configCache.has(cacheKey)) {
        return configCache.get(cacheKey);
    }

    const filePath = path.join(MAPPINGS_DIR, region.toUpperCase(), `${entityKey}.json`);

    if (!fs.existsSync(filePath)) {
        throw new AppError(
            `No mapping configuration found for ${entityKey} in region ${region}.`,
            404
        );
    }

    const config = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    configCache.set(cacheKey, config);

    return config;

};

const applyValueMap = (value, valueMap) => {
    if (!valueMap) return value;
    if (value === "" || value === undefined || value === null) return value;
    return Object.prototype.hasOwnProperty.call(valueMap, value) ? valueMap[value] : value;
};

const applyTransform = (value, transform) => {

    if (!transform || value === "" || value === undefined || value === null) return value;

    switch (transform) {
        case "uppercase": return String(value).toUpperCase();
        case "lowercase": return String(value).toLowerCase();
        case "trim": return String(value).trim();
        case "date_ddmmyyyy": {
            // QBO dates come back as "YYYY-MM-DD" (sometimes with a time
            // portion attached) - reformat to "DD/MM/YYYY".
            const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
            if (!match) return value;
            const [, year, month, day] = match;
            return `${day}/${month}/${year}`;
        }
        default: return value;
    }

};

// Evaluates a single column definition for one normalized source record.
// A column looks like:
// {
//   "header": "Account Type",
//   "source": "accountType",
//   "required": true,
//   "valueMap": { "Income": "Income Account" },
//   "defaultValue": "",
//   "transform": "trim",
//   "condition": { "field": "isSubAccount", "equals": true, "thenValue": "Sub Account" },
//   "requiredUnless": { "field": "type", "equals": "Category" }
// }
//
// requiredUnless lets a column stay required in general but drop that
// requirement for records where it doesn't genuinely apply - e.g. a QBO
// "Category" type Item never has an Income Account, so it shouldn't be
// flagged invalid for missing one, while a real Service/Inventory item
// still should be.
const evaluateColumn = (record, column) => {

    let value;

    if (column.condition) {

        const conditionValue = getByPath(record, column.condition.field);

        value = conditionValue === column.condition.equals
            ? column.condition.thenValue
            : (column.source ? getByPath(record, column.source) : column.condition.elseValue);

    } else if (column.staticValue !== undefined) {

        value = column.staticValue;

    } else {

        value = getByPath(record, column.source);

    }

    value = applyValueMap(value, column.valueMap);
    value = applyTransform(value, column.transform);

    const isEmpty = value === "" || value === undefined || value === null;

    if (isEmpty && column.defaultValue !== undefined) {
        value = column.defaultValue;
    }

    const requiredWaived = column.requiredUnless &&
        getByPath(record, column.requiredUnless.field) === column.requiredUnless.equals;

    const stillEmpty = value === "" || value === undefined || value === null;

    const issue = (column.required && !requiredWaived && stillEmpty)
        ? { field: column.header, type: "missing_required" }
        : null;

    return { header: column.header, value: value ?? "", issue };

};

// Maps one normalized record to a destination row using the region's
// column config for this entity. Returns the row plus any validation
// issues found on it.
export const mapRecord = (record, config) => {

    const row = {};
    const issues = [];

    for (const column of config.columns) {

        let { header, value, issue } = evaluateColumn(record, column);

        // "lookup": value comes from a client-supplied mapping table keyed on
        // ANOTHER already-mapped column of this row (e.g. Detail type looked
        // up from the final Account type). An exact match is required - when
        // there is none the source value is kept and the row is flagged
        // "needs attention" (never silently replaced with a generic value).
        if (column.lookup) {
            const table = loadLookupTable(config.region, column.lookup.file)[column.lookup.table] || {};
            const keyValue = String(row[column.lookup.fromHeader] ?? "").trim();
            const hit = table[keyValue.toLowerCase()];

            if (hit) {
                value = hit[column.lookup.field];
                issue = null;
            } else {
                issues.push({
                    field: header,
                    type: column.lookup.issueType || "unmapped_lookup",
                    value: keyValue
                });
            }
        }

        row[header] = value;

        if (issue) issues.push(issue);

    }

    // A line whose source tax has no usable saved Tax Mapping is blocked (never silently substituted).
    if (record._taxMappingIssue) {
        issues.push({ field: `Tax mapping: ${record._taxMappingIssue.sourceName}`, type: "unresolved_tax_mapping", message: record._taxMappingIssue.message });
    }

    return { sourceId: record.id, row, issues };

};

// Maps a full collection of normalized records for one entity/region.
export const mapCollection = (entityKey, records, region) => {

    const config = loadMappingConfig(region, entityKey);

    const mapped = records.map((record) => mapRecord(record, config));

    debugJson("mapped", `${region}/${entityKey}`, mapped);

    if (entityKey === "invoiceDetail" && isInvoiceDebugEnabled()) {
        mapped.forEach((m, index) => {
            const source = records[index] || {};
            debugInvoiceJson("mapped", { invoiceId: source.txnId ?? m.sourceId, docNumber: source.docNumber, payload: { sourceId: m.sourceId, row: m.row, issues: m.issues } });
        });
    }

    return { config, mapped };

};
