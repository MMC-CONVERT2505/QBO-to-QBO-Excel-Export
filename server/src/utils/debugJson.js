// Console JSON dump for every module, controlled ONLY by environment
// variables (off by default - the output contains real financial data):
//
//   DEBUG_JSON=all                      -> raw + normalized + mapped
//   DEBUG_JSON=normalized,mapped        -> any comma list of: raw, normalized, mapped
//   DEBUG_JSON_LIMIT=20                 -> max records printed per module (default 50, 0 = all)
//   DEBUG_JSON_MODULES=item,account     -> optional filter (entity keys); default = every module
//
// Stages:
//   raw        exactly what QBO returned for each query (qboClient.queryAll)
//   normalized the shared normalized records per module (fetch.service.js fetchEntity)
//   mapped     final destination rows + issues per module (mapping.service.js mapCollection)
//
// OAuth tokens / secrets are never part of these payloads.

const parseStages = () => {
    const value = String(process.env.DEBUG_JSON || "").toLowerCase().trim();
    if (!value || value === "false" || value === "0" || value === "off") return new Set();
    if (value === "all" || value === "true" || value === "1") return new Set(["raw", "normalized", "mapped"]);
    return new Set(value.split(",").map((s) => s.trim()).filter(Boolean));
};

export const debugJson = (stage, label, records) => {

    const stages = parseStages();
    if (!stages.has(stage)) return;

    const modules = String(process.env.DEBUG_JSON_MODULES || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (modules.length && !modules.some((m) => String(label).toLowerCase().includes(m))) return;

    const limitEnv = Number(process.env.DEBUG_JSON_LIMIT);
    const limit = Number.isFinite(limitEnv) ? limitEnv : 50;
    const list = Array.isArray(records) ? records : [records];
    const shown = limit > 0 ? list.slice(0, limit) : list;

    console.log(
        `\n===== [DEBUG_JSON] stage=${stage} module=${label} total=${list.length} shown=${shown.length} =====\n` +
        JSON.stringify(shown, null, 2) +
        `\n===== [/DEBUG_JSON] ${stage}:${label} =====\n`
    );
};
