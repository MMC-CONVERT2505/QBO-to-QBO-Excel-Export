// Generates a placeholder .xlsx template per region/entity, with headers
// taken straight from the mapping config so template and mapping engine
// are always in sync. These are STANDARD/DEFAULT templates - once the
// real client-provided destination templates arrive, drop them into
// templates/<REGION>/<Entity>.xlsx (matching the filenames below) and
// update src/mappings/<REGION>/<entity>.json headers to match; nothing
// else in the app needs to change.
//
// Usage: node scripts/generateTemplates.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { REGION_CODES } from "../src/config/regions.js";
import { ENTITY_KEYS } from "../src/config/entities.js";
import { loadMappingConfig } from "../src/services/mapping.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

const ENTITY_FILE_NAME = {
    account: "Account",
    customer: "Customer",
    vendor: "Vendor",
    item: "Item",
    invoice: "Invoice",
    bill: "Bill"
};

const run = async () => {

    for (const region of REGION_CODES) {

        const regionDir = path.join(TEMPLATES_DIR, region);
        fs.mkdirSync(regionDir, { recursive: true });

        for (const entityKey of ENTITY_KEYS) {

            const config = loadMappingConfig(region, entityKey);

            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet(config.templateSheet);

            sheet.columns = config.columns.map((column) => ({
                header: column.header,
                key: column.header,
                width: Math.max(18, column.header.length + 4)
            }));

            sheet.getRow(1).font = { bold: true };
            sheet.getRow(1).fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFE8EEF7" }
            };

            const fileName = `${ENTITY_FILE_NAME[entityKey]}.xlsx`;
            await workbook.xlsx.writeFile(path.join(regionDir, fileName));

        }

    }

    console.log("Templates generated under /templates/<REGION>/<Entity>.xlsx");

};

run().catch((error) => {
    console.error("Template generation failed:", error);
    process.exit(1);
});
