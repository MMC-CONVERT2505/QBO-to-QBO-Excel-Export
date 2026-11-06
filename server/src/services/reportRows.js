// Helpers for the Reports API's nested { Header, Columns, Rows } structure.

// Strict: only rows explicitly typed "Data" (used by the Aged AR/AP reports).
export const collectTypedDataRows = (rows) => {
    if (!rows || !Array.isArray(rows.Row)) return [];
    let collected = [];
    for (const row of rows.Row) {
        if (row.type === "Data") collected.push(row);
        if (row.Rows) collected = collected.concat(collectTypedDataRows(row.Rows));
    }
    return collected;
};

// Tolerant: ANY row carrying ColData that is not a Section/total wrapper.
// The Trial Balance report is parsed with this so a response whose leaf rows
// omit `type: "Data"` can never silently produce zero records.
export const collectLeafRows = (rows) => {
    if (!rows || !Array.isArray(rows.Row)) return [];
    let collected = [];
    for (const row of rows.Row) {
        const isWrapper = row.type === "Section" || Boolean(row.group) || Boolean(row.Header) || Boolean(row.Summary);
        if (Array.isArray(row.ColData) && !isWrapper) collected.push(row);
        if (row.Rows) collected = collected.concat(collectLeafRows(row.Rows));
    }
    return collected;
};

// { "Data": 12, "Section": 1, "(none)": 0 } - how the report's rows are typed.
export const rowTypeHistogram = (rows, acc = {}) => {
    for (const row of rows?.Row || []) {
        const key = row.type || "(none)";
        acc[key] = (acc[key] || 0) + 1;
        if (row.Rows) rowTypeHistogram(row.Rows, acc);
    }
    return acc;
};

// Leaf rows (see collectLeafRows) together with the index of the nearest enclosing Section, so the lines of
// one transaction in a Journal-style report (one Section per transaction) can be grouped. `sectionIndex` is
// -1 for rows that sit outside any Section.
export const collectLeafRowsWithSection = (rows) => {
    const out = [];
    let counter = 0;
    const walk = (node, sectionIndex) => {
        if (!node || !Array.isArray(node.Row)) return;
        for (const row of node.Row) {
            const isSection = row.type === "Section" || Boolean(row.group) || Boolean(row.Header) || Boolean(row.Summary);
            const mine = isSection ? counter++ : sectionIndex;
            if (Array.isArray(row.ColData) && !isSection) out.push({ row, sectionIndex });
            if (row.Rows) walk(row.Rows, isSection ? mine : sectionIndex);
        }
    };
    walk(rows, -1);
    return out;
};
