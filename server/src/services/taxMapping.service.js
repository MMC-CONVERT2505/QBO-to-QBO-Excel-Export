import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { queryAll } from "./qboClient.js";
import { loadMappingConfig } from "./mapping.service.js";
import { AppError } from "../utils/AppError.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Dynamic Tax Mapping
//
// Source taxes (QBO TaxCode + TaxRate, incl. components) are read live from the
// connected SOURCE company. This tool has no connection to the TARGET company,
// so a target tax is something the user ENTERS and CONFIRMS exists there (or
// accepts as a "suggestion" = same name and rate as the source). Nothing here
// creates a tax code in any company, and a typed percentage is never treated as
// an existing target tax code.
//
// Saved mappings live per source company (realm) and destination region in a
// JSON file (TAX_MAPPING_FILE, default server/data/tax-mappings.json).
// ---------------------------------------------------------------------------

export const TAX_MAPPING_STATUSES = ["mapped", "suggested", "manual_rate", "unmapped", "error"];

const storeFile = () => process.env.TAX_MAPPING_FILE || path.join(__dirname, "..", "..", "data", "tax-mappings.json");

const readStore = () => {
    try {
        return JSON.parse(fs.readFileSync(storeFile(), "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return {};
        throw new AppError(`Tax mapping file could not be read: ${error.message}`, 500);
    }
};

const writeStore = (store) => {
    const file = storeFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, file);
};

export const loadTaxMapping = (realmId, region) => {
    const slot = readStore()?.[String(realmId)]?.[String(region).toUpperCase()];
    return { enabled: slot?.enabled === true, entries: slot?.entries || {} };
};

const saveTaxMapping = (realmId, region, value) => {
    const store = readStore();
    const key = String(realmId);
    store[key] = store[key] || {};
    store[key][String(region).toUpperCase()] = value;
    writeStore(store);
};

// ---------- source taxes ----------

const round4 = (n) => Math.round(n * 10000) / 10000;

// Effective rate of a list of components, honouring QBO's TaxTypeApplicable
// (TaxOnAmount / TaxOnAmountPlusTax / TaxOnTax) and TaxOrder. Returned as a % of the net amount.
export const effectiveRate = (components) => {
    if (!components.length) return null;
    if (components.some((c) => !Number.isFinite(c.percent))) return null;
    const ordered = [...components].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    let tax = 0;
    for (const c of ordered) {
        const base = c.applicable === "TaxOnTax" ? tax : c.applicable === "TaxOnAmountPlusTax" ? 100 + tax : 100;
        tax += (base * c.percent) / 100;
    }
    return round4(tax);
};

const componentsOf = (list, rateById) => (list?.TaxRateDetail || []).map((d) => {
    const rateId = String(d.TaxRateRef?.value ?? "");
    const rate = rateById.get(rateId);
    return {
        rateId,
        name: d.TaxRateRef?.name || rate?.name || "",
        percent: rate ? rate.percent : NaN,
        agencyId: rate?.agencyId || "",
        applicable: d.TaxTypeApplicable || "TaxOnAmount",
        order: Number(d.TaxOrder) || 0
    };
});

export const fetchSourceTaxes = async (qboSession) => {

    const [codes, inactiveCodes, rates, inactiveRates] = await Promise.all([
        queryAll(qboSession, "select * from TaxCode"),
        queryAll(qboSession, "select * from TaxCode where Active = false").catch(() => []),
        queryAll(qboSession, "select * from TaxRate"),
        queryAll(qboSession, "select * from TaxRate where Active = false").catch(() => [])
    ]);

    const rateById = new Map([...rates, ...inactiveRates].map((r) => [String(r.Id), { name: r.Name, percent: Number(r.RateValue), agencyId: String(r.AgencyRef?.value ?? "") }]));

    return [...codes, ...inactiveCodes].map((t) => {
        const sales = componentsOf(t.SalesTaxRateList, rateById);
        const purchase = componentsOf(t.PurchaseTaxRateList, rateById);
        const salesRate = effectiveRate(sales);
        const purchaseRate = effectiveRate(purchase);
        const main = sales.length ? sales : purchase;
        return {
            id: String(t.Id),
            name: t.Name,
            active: t.Active !== false,
            taxGroup: t.TaxGroup === true,
            type: t.TaxGroup ? "Tax group" : (t.Taxable === false ? "Non-taxable" : "Taxable"),
            salesComponents: sales,
            purchaseComponents: purchase,
            salesRate,
            purchaseRate,
            // the rate shown/compared: sales if the code has a sales side, else purchase
            rate: salesRate ?? purchaseRate,
            multiComponent: main.length > 1,
            // a component whose TaxRate record could not be read -> rate unknown, never guessed
            missingRates: [...sales, ...purchase].filter((c) => !Number.isFinite(c.percent)).map((c) => c.rateId)
        };
    });

};

// ---------- validation of a manually entered target tax ----------

export const validateTargetTax = ({ targetName, targetRate, targetType, calcType } = {}) => {

    const errors = [];
    const name = typeof targetName === "string" ? targetName.trim() : "";

    if (!name) errors.push({ field: "targetName", message: "Tax name is required." });
    else if (name.length > 100) errors.push({ field: "targetName", message: "Tax name must be 100 characters or fewer." });
    else if (/[\u0000-\u001f]/.test(name)) errors.push({ field: "targetName", message: "Tax name contains invalid characters." });

    let rate = null;
    if (targetRate === "" || targetRate === null || targetRate === undefined) {
        errors.push({ field: "targetRate", message: "Tax rate is required." });
    } else if (typeof targetRate === "boolean" || !/^-?\d+(\.\d+)?$/.test(String(targetRate).trim())) {
        errors.push({ field: "targetRate", message: "Tax rate must be a number, e.g. 15 or 7.5." });
    } else {
        rate = Number(String(targetRate).trim());
        if (rate < 0 || rate > 100) errors.push({ field: "targetRate", message: "Tax rate must be between 0 and 100." });
        else if (Math.abs(rate * 10000 - Math.round(rate * 10000)) > 1e-6) errors.push({ field: "targetRate", message: "Tax rate can have at most 4 decimal places." });
    }

    const type = typeof targetType === "string" ? targetType.trim() : "";
    if (type.length > 50) errors.push({ field: "targetType", message: "Tax type must be 50 characters or fewer." });

    const calc = calcType || "";
    if (!["", "inclusive", "exclusive"].includes(calc)) errors.push({ field: "calcType", message: "Calculation type must be Tax Inclusive or Tax Exclusive." });

    return { errors, value: errors.length ? null : { targetName: name, targetRate: rate, targetType: type, calcType: calc } };

};

// ---------- status / table ----------

const sameRate = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;

const suggestionFor = (tax) => {
    // Without a target-company list the only suggestion we can make is "same name, same rate".
    // Never suggested when the rate is unknown or the tax has several components (target components can't be compared).
    if (!Number.isFinite(tax.rate) || tax.missingRates.length || tax.multiComponent) return null;
    return { targetName: tax.name, targetRate: tax.rate, basis: "Same name and rate as the source tax (target company list is not available - confirm it exists in the target company)." };
};

export const statusOf = (tax, entry) => {

    if (!entry) {
        const suggestion = suggestionFor(tax);
        return suggestion
            ? { status: "suggested", suggestion, message: suggestion.basis }
            : { status: "unmapped", suggestion: null, message: tax.multiComponent ? "Tax has several components - enter the target tax manually and make sure its components match." : (tax.missingRates.length ? `Rate unknown (tax rate record(s) ${tax.missingRates.join(", ")} could not be read).` : "No target tax selected.") };
    }

    const { errors } = validateTargetTax(entry);
    if (errors.length) return { status: "error", suggestion: null, message: errors.map((e) => e.message).join(" ") };

    if (entry.confirmed !== true) {
        return { status: "error", suggestion: null, message: "Target tax is not confirmed. Create it in the target company if needed, then confirm it exists." };
    }

    const warnings = [];
    if (Number.isFinite(tax.rate) && !sameRate(entry.targetRate, tax.rate)) warnings.push(`Target rate ${entry.targetRate}% differs from source rate ${tax.rate}%.`);
    if (tax.multiComponent) warnings.push("Source tax has several components - the target tax must have the same components.");

    return { status: entry.origin === "suggested" && !warnings.length ? "mapped" : "manual_rate", suggestion: null, message: warnings.join(" "), warnings };

};

export const buildTaxMappingTable = (taxes, mapping) => {

    const rows = taxes.map((tax) => {
        const entry = mapping.entries[tax.id] || null;
        const s = statusOf(tax, entry);
        return {
            sourceId: tax.id,
            sourceName: tax.name,
            sourceRate: tax.rate,
            sourceType: tax.type,
            sourceActive: tax.active,
            sourceComponents: tax.salesComponents.length ? tax.salesComponents : tax.purchaseComponents,
            multiComponent: tax.multiComponent,
            targetName: entry?.targetName ?? s.suggestion?.targetName ?? null,
            targetRate: entry?.targetRate ?? s.suggestion?.targetRate ?? null,
            targetType: entry?.targetType || "",
            calcType: entry?.calcType || "",
            confirmed: entry?.confirmed === true,
            origin: entry?.origin || null,
            status: s.status,
            message: s.message,
            suggestion: s.suggestion
        };
    });

    // Two source taxes pointing at the SAME target tax name with different rates is a conflict.
    const byTarget = new Map();
    rows.filter((r) => r.origin && r.targetName).forEach((r) => {
        const key = r.targetName.trim().toLowerCase();
        byTarget.set(key, [...(byTarget.get(key) || []), r]);
    });
    for (const group of byTarget.values()) {
        if (new Set(group.map((r) => r.targetRate)).size > 1) {
            group.forEach((r) => { r.status = "error"; r.message = `Target tax "${r.targetName}" is used with different rates (${[...new Set(group.map((g) => g.targetRate))].join("%, ")}%).`; });
        }
    }

    const counts = { all: rows.length };
    TAX_MAPPING_STATUSES.forEach((s) => { counts[s] = rows.filter((r) => r.status === s).length; });
    return { rows, counts };

};

// ---------- saving ----------

// actions: { sourceId, action: "accept-suggestion" | "set" | "clear", targetName, targetRate, targetType, calcType, confirmed }
export const saveTaxMappingChanges = (realmId, region, taxes, { enabled, changes = [] }) => {

    const current = loadTaxMapping(realmId, region);
    const entries = { ...current.entries };
    const taxById = new Map(taxes.map((t) => [t.id, t]));
    const fieldErrors = [];

    for (const change of changes) {

        const tax = taxById.get(String(change.sourceId));
        if (!tax) { fieldErrors.push({ sourceId: change.sourceId, field: "sourceId", message: "Unknown source tax." }); continue; }

        if (change.action === "clear") { delete entries[tax.id]; continue; }

        if (change.action === "accept-suggestion") {
            const suggestion = suggestionFor(tax);
            if (!suggestion) { fieldErrors.push({ sourceId: tax.id, field: "action", message: "No suggestion is available for this tax." }); continue; }
            entries[tax.id] = { sourceId: tax.id, sourceName: tax.name, sourceRate: tax.rate, targetName: suggestion.targetName, targetRate: suggestion.targetRate, targetType: "", calcType: "", origin: "suggested", confirmed: true, updatedAt: new Date().toISOString() };
            continue;
        }

        if (change.action === "set") {
            const { errors, value } = validateTargetTax(change);
            if (errors.length) { errors.forEach((e) => fieldErrors.push({ sourceId: tax.id, ...e })); continue; }
            entries[tax.id] = { sourceId: tax.id, sourceName: tax.name, sourceRate: tax.rate, ...value, origin: "manual", confirmed: change.confirmed === true, updatedAt: new Date().toISOString() };
            continue;
        }

        fieldErrors.push({ sourceId: tax.id, field: "action", message: `Unknown action "${change.action}".` });
    }

    if (fieldErrors.length) throw Object.assign(new AppError("Tax mapping was not saved - please fix the highlighted values.", 400), { fieldErrors });

    saveTaxMapping(realmId, region, { enabled: typeof enabled === "boolean" ? enabled : current.enabled, entries });
    return loadTaxMapping(realmId, region);

};

// ---------- applying the saved mapping to export records ----------

// Tax codes already decided by a hard-coded REGIONAL rule (e.g. South Africa's
// "VAT amount present -> Standard / zero -> Out of Scope") are final: the mapping
// never overrides them. Everything else is mapped from the line's SOURCE tax code.
const FINAL_REGIONAL_RULES = new Set(["vat-present-standard", "vat-zero-out-of-scope", "S-positive-standard", "zero-amount"]);

const taxCodeColumns = (entityKey, region) => {
    try {
        return loadMappingConfig(region, entityKey).columns.filter((c) => /tax code/i.test(c.header) && c.source).map((c) => c.source);
    } catch {
        return [];
    }
};

// Returns new records (inputs untouched). A record whose source tax has no usable
// mapping gets `_taxMappingIssue` so validation marks it invalid and the Excel writer
// skips it - a different tax rate is never silently substituted.
export const applyTaxMapping = (entityKey, records, region, mapping) => {

    if (!mapping?.enabled || !region) return records;

    const columns = taxCodeColumns(entityKey, region);
    if (!columns.length) return records;

    const entries = Object.values(mapping.entries || {});
    const byId = new Map(entries.map((e) => [String(e.sourceId), e]));
    const byName = new Map(entries.map((e) => [String(e.sourceName).trim().toLowerCase(), e]));

    return records.map((record) => {

        const sourceName = typeof record.taxCodeName === "string" ? record.taxCodeName.trim() : "";
        if (!sourceName || FINAL_REGIONAL_RULES.has(record.taxRule)) return record;

        const entry = (record.taxCodeId !== undefined && record.taxCodeId !== "" ? byId.get(String(record.taxCodeId)) : null) || byName.get(sourceName.toLowerCase());
        const usable = entry && entry.confirmed === true && validateTargetTax(entry).errors.length === 0;

        if (!usable) {
            const why = !entry ? "no target tax selected" : (entry.confirmed !== true ? "target tax not confirmed" : "target tax entry is invalid");
            return { ...record, _taxMappingIssue: { sourceName, message: `Tax mapping unresolved for "${sourceName}": ${why}.` } };
        }

        const next = { ...record };
        columns.forEach((c) => { next[c] = entry.targetName; });
        next.mappedTaxName = entry.targetName;
        next.mappedTaxRate = entry.targetRate;
        return next;

    });

};

// Loads the saved mapping for this export (null when none/disabled).
export const getTaxMappingContext = (qboSession, region) => {
    if (!qboSession?.realmId) return null;
    const mapping = loadTaxMapping(qboSession.realmId, region);
    return mapping.enabled ? { taxMapping: mapping } : null;
};
