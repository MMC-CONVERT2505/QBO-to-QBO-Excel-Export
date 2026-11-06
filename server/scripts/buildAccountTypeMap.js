// Builds src/mappings/ZA/accountTypeDetail.json from the client's
// "Account Type Mapping" sheet (src/mappings/ZA/source/account_mapping.xlsx).
//
// Sheet columns:  A "QBO Type"  ->  B "QBO Detail type"
// Rules applied:
//  - exact text from the sheet is kept (casing/punctuation untouched);
//  - lookups are matched case-insensitively on the Type;
//  - a Type listed more than once with the SAME detail is collapsed and
//    reported as a harmless duplicate;
//  - a Type listed with DIFFERENT details is a conflict: reported, and the
//    first listed detail is NOT silently chosen - the type is left out of the
//    table so it surfaces as "unmapped" in the export report.
// Usage (from server/):  node scripts/buildAccountTypeMap.js
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "mappings", "ZA");
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(path.join(dir, "source", "account_mapping.xlsx"));
const sheet = workbook.worksheets[0];

const seen = new Map();      // lowercased type -> { type, details:Set }
const duplicates = [];
const conflicts = [];

sheet.eachRow((row, n) => {
    if (n === 1) return; // header
    const type = String(row.getCell(1).value ?? "").trim();
    const detail = String(row.getCell(2).value ?? "").trim();
    if (!type && !detail) return;
    if (!type || !detail) { conflicts.push({ row: n, type, detail, problem: "blank type or detail" }); return; }
    const key = type.toLowerCase();
    if (!seen.has(key)) { seen.set(key, { type, details: new Set([detail]), rows: [n] }); return; }
    const entry = seen.get(key);
    entry.rows.push(n);
    entry.details.add(detail);
});

for (const entry of seen.values()) {
    if (entry.rows.length > 1 && entry.details.size === 1) {
        duplicates.push({ type: entry.type, detail: [...entry.details][0], rows: entry.rows });
    }
}

const detailByType = {};
for (const [key, entry] of seen) {
    if (entry.details.size > 1) conflicts.push({ type: entry.type, details: [...entry.details], problem: "conflicting details" });
    else detailByType[key] = { type: entry.type, detail: [...entry.details][0] };
}

const out = { source: "source/account_mapping.xlsx", detailByType, duplicates, conflicts };
fs.writeFileSync(path.join(dir, "accountTypeDetail.json"), JSON.stringify(out, null, 2));
console.log(`Types mapped: ${Object.keys(detailByType).length}`);
console.log(`Harmless duplicate rows: ${duplicates.length}`, duplicates);
console.log(`Conflicts: ${conflicts.length}`, conflicts);
