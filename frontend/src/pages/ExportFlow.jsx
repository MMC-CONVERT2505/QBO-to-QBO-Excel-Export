import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertTriangle, XCircle, Download, RotateCcw, ChevronDown, ChevronUp, ChevronRight, ArrowLeft, Loader2 } from "lucide-react";
import api, { getErrorMessage } from "../api/client.js";
import { Card, Button, Badge, Spinner, EmptyState, StatTile, ProgressBar, SearchInput, SuccessMark } from "../components/ui.jsx";
import Stepper from "../components/Stepper.jsx";
import WizardSteps from "../components/WizardSteps.jsx";
import RegionCard from "../components/RegionCard.jsx";
import ModuleCard from "../components/ModuleCard.jsx";
import { MODULE_META } from "../constants/display.js";
import { useApp } from "../context/AppContext.jsx";

const MODULES = [
    { key: "account", label: "Accounts" },
    { key: "customer", label: "Customers" },
    { key: "vendor", label: "Vendors" },
    { key: "item", label: "Items" },
    { key: "ar", label: "AR (Invoices & Credit Notes)" },
    { key: "ap", label: "AP (Bills & Vendor Credits)" },
    { key: "openBalance", label: "Open Balance (Opening Journal)" },
    { key: "billDetail", label: "Bill (Detailed Transactions)" },
    { key: "invoiceDetail", label: "Invoice (Detailed Transactions)" },
    { key: "creditMemoDetail", label: "Invoice Credit Note (Detailed Transactions)" },
    { key: "invoicePayment", label: "Invoice Payment" },
    { key: "deposit", label: "Deposit" },
    { key: "transfer", label: "Transfer" },
    { key: "expense", label: "Expense (Cash)" },
    { key: "creditCard", label: "Credit Card" },
    { key: "cheque", label: "Cheque" },
    { key: "overpayment", label: "Overpayment" },
    { key: "billOverpayment", label: "Bill Overpayment" },
    { key: "otherJournal", label: "Other Journal Types" },
    { key: "invoiceCreditAllocation", label: "Invoice Credit Note Allocation" },
    { key: "billCreditAllocation", label: "Bill Credit Note Allocation" },
    { key: "billPayment", label: "Bill Payment" },
    { key: "billCredit", label: "Bill Credit (Supplier Credit)" },
    { key: "estimate", label: "Estimates" },
    { key: "purchaseOrder", label: "Purchase Order" },
    { key: "journal", label: "Journal Entry" }
];

// Presentation-only grouping of the module keys above (the backend still receives the same flat key list).
const MODULE_GROUPS = [
    { key: "master", label: "Master data", modules: ["account", "customer", "vendor", "item"] },
    { key: "opening", label: "Opening balances", modules: ["openBalance", "ar", "ap"] },
    { key: "sales", label: "Sales", modules: ["invoiceDetail", "creditMemoDetail", "invoicePayment", "overpayment", "invoiceCreditAllocation", "estimate"] },
    { key: "purchases", label: "Purchases", modules: ["billDetail", "billCredit", "billPayment", "billOverpayment", "billCreditAllocation", "purchaseOrder"] },
    { key: "banking", label: "Banking & journals", modules: ["deposit", "transfer", "expense", "creditCard", "cheque", "journal", "otherJournal"] }
];

const STATUS_META = {
    mapped: { icon: CheckCircle2, tone: "success", label: "Mapped" },
    needs_attention: { icon: AlertTriangle, tone: "warning", label: "Needs attention" },
    invalid: { icon: XCircle, tone: "error", label: "Invalid" }
};

const pageFade = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: 0.25, ease: "easeOut" }
};

const EntityReportCard = ({ entityKey, report }) => {

    const [expanded, setExpanded] = useState(false);
    const attentionRows = report.rows.filter((r) => r.status !== "mapped").slice(0, 25);
    const clean = report.needsAttentionCount === 0 && report.invalidCount === 0;
    const mappedPct = report.total > 0 ? (report.mappedCount / report.total) * 100 : 100;

    return (
        <Card className="p-5" hover>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="font-semibold text-ink-900">{report.templateSheet}</p>
                    <p className="text-xs text-ink-500 mt-0.5">{report.total.toLocaleString()} record{report.total === 1 ? "" : "s"}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone="success">✓ {report.mappedCount.toLocaleString()} mapped</Badge>
                    {report.needsAttentionCount > 0 && <Badge tone="warning">⚠ {report.needsAttentionCount.toLocaleString()} need attention</Badge>}
                    {report.invalidCount > 0 && <Badge tone="error">✕ {report.invalidCount.toLocaleString()} invalid</Badge>}
                </div>
            </div>

            <ProgressBar value={mappedPct} className="mt-3" />

            {report.balanceCheck && (
                <div className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${
                    report.balanceCheck.balanced
                        ? "bg-green-50 text-green-700"
                        : "bg-rose-50 text-rose-700"
                }`}>
                    {report.balanceCheck.balanced
                        ? "✓ Journal balances to zero"
                        : `⚠ Journal does not balance — net ${report.balanceCheck.totalAmount.toFixed(2)} left over. Check the source company's Trial Balance as of this date.`}
                </div>
            )}

            {report.unmappedValues && (
                <div className="mt-3 rounded-lg px-3 py-2 text-xs bg-amber-50 text-amber-700">
                    <p className="font-semibold mb-1">⚠ Values with no entry in the mapping sheet (exported with the source value):</p>
                    <ul className="list-disc pl-4">
                        {Object.entries(report.unmappedValues).map(([label, count]) => (
                            <li key={label}>{label} — {count} row(s)</li>
                        ))}
                    </ul>
                </div>
            )}

            {attentionRows.length > 0 && (
                <div className="mt-3">
                    <button
                        onClick={() => setExpanded((v) => !v)}
                        className="text-xs font-semibold text-teal-700 flex items-center gap-1 hover:text-teal-600 transition-colors"
                        aria-expanded={expanded}
                    >
                        {expanded ? "Hide" : "Show"} rows that need attention
                        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>

                    <AnimatePresence>
                        {expanded && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                className="mt-3 border border-ink-200 rounded-lg overflow-hidden overflow-x-auto"
                            >
                                <table className="w-full text-xs">
                                    <thead className="bg-ink-100 text-ink-500">
                                        <tr>
                                            <th className="text-left px-3 py-2 font-semibold">Status</th>
                                            <th className="text-left px-3 py-2 font-semibold">Row (key fields)</th>
                                            <th className="text-left px-3 py-2 font-semibold">Issue</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {attentionRows.map((row, i) => {
                                            const meta = STATUS_META[row.status];
                                            const Icon = meta.icon;
                                            const preview = Object.values(row.row).filter(Boolean).slice(0, 2).join(" — ");
                                            return (
                                                <tr key={i} className="border-t border-ink-200 hover:bg-ink-50 transition-colors">
                                                    <td className="px-3 py-2 whitespace-nowrap">
                                                        <Badge tone={meta.tone}><Icon size={11} className="inline -mt-0.5 mr-1" />{meta.label}</Badge>
                                                    </td>
                                                    <td className="px-3 py-2 text-ink-800">{preview || "—"}</td>
                                                    <td className="px-3 py-2 text-ink-500">
                                                        {row.issues.map((iss) => iss.field).join(", ") || "—"}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                {report.rows.filter((r) => r.status !== "mapped").length > attentionRows.length && (
                                    <p className="px-3 py-2 text-xs text-ink-500 border-t border-ink-200 bg-ink-50">Showing the first {attentionRows.length} rows.</p>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}

            {clean && report.total > 0 && !report.balanceCheck && !report.unmappedValues && (
                <p className="mt-3 text-xs text-green-700 flex items-center gap-1"><CheckCircle2 size={13} /> All rows mapped cleanly.</p>
            )}
        </Card>
    );

};

const ExportFlow = () => {

    const { connection, pushToast } = useApp();
    const [phase, setPhase] = useState("setup"); // setup | reviewing | exporting | done | error
    const [region, setRegion] = useState("");
    const [regions, setRegions] = useState([]);
    const [selectedModules, setSelectedModules] = useState(["account", "customer", "vendor", "item"]);
    const [asOfDate, setAsOfDate] = useState("");
    // ONE Start/End transaction date range shared by every transaction module (the Open Balance cutoff
    // date above is separate). Sent to the API once per selected module.
    const [txnRange, setTxnRange] = useState({ startDate: "", endDate: "" });
    const [busy, setBusy] = useState(false);
    const [report, setReport] = useState(null);
    const [job, setJob] = useState(null);
    const [errorMessage, setErrorMessage] = useState("");
    const [moduleSearch, setModuleSearch] = useState("");
    const [collapsedGroups, setCollapsedGroups] = useState([]);

    useEffect(() => {
        if (!connection.connected) return;
        api.get("/api/regions").then(({ data }) => {
            setRegions(data.regions);
            if (data.regions.length > 0) setRegion(data.regions[0].code);
        }).catch((error) => pushToast(getErrorMessage(error), "error"));
    }, [connection.connected]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggleModule = (key) => {
        setSelectedModules((prev) => prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]);
    };

    const availableForRegion = useMemo(() => {
        const r = regions.find((x) => x.code === region);
        return r?.availableModules || [];
    }, [regions, region]);

    const includesDateFilterable = useMemo(
        () => selectedModules.includes("ar") || selectedModules.includes("ap") || selectedModules.includes("openBalance"),
        [selectedModules]
    );

    // AR/AP treat the date as an optional "as of" filter, but Open
    // Balance has no sane default - it's always a balance as of a
    // specific conversion cutoff date, so it's mandatory the moment
    // that module is selected.
    const dateRequired = selectedModules.includes("openBalance");
    const dateMissing = dateRequired && !asOfDate;

    const asOfDateValue = asOfDate || undefined;

    // The single range is applied to every selected transaction module; a Start Date after the End Date
    // blocks the preview.
    const activeRangeKeys = ["invoiceDetail", "creditMemoDetail", "invoicePayment", "deposit", "transfer", "expense", "creditCard", "cheque", "overpayment", "billOverpayment", "otherJournal", "invoiceCreditAllocation", "billCreditAllocation", "billPayment", "billCredit", "estimate", "purchaseOrder", "journal", "billDetail"].filter((key) => selectedModules.includes(key));
    const anyRangeInvalid = Boolean(txnRange.startDate && txnRange.endDate && txnRange.startDate > txnRange.endDate);
    const dateRangesPayload = activeRangeKeys.reduce((acc, key) => {
        if (txnRange.startDate || txnRange.endDate) acc[key] = { startDate: txnRange.startDate || undefined, endDate: txnRange.endDate || undefined };
        return acc;
    }, {});

    const runPreview = async () => {

        setBusy(true);
        setErrorMessage("");

        try {
            const { data } = await api.post("/api/mapping/preview", { region, modules: selectedModules, asOfDate: asOfDateValue, dateRanges: dateRangesPayload });
            setReport(data.report);
            setPhase("reviewing");
        } catch (error) {
            pushToast(getErrorMessage(error), "error");
        }

        setBusy(false);

    };

    const startExport = async () => {

        setBusy(true);
        setErrorMessage("");

        try {
            const { data } = await api.post("/api/export", { region, modules: selectedModules, asOfDate: asOfDateValue, dateRanges: dateRangesPayload });
            setJob({ id: data.jobId, status: data.status, steps: {} });
            setPhase("exporting");
        } catch (error) {
            pushToast(getErrorMessage(error), "error");
        }

        setBusy(false);

    };

    // Poll job status every 1.2s while exporting.
    useEffect(() => {

        if (phase !== "exporting" || !job?.id) return undefined;

        const interval = setInterval(async () => {

            try {
                const { data } = await api.get(`/api/export/${job.id}/status`);
                setJob((prev) => ({ ...prev, ...data }));

                if (data.status === "complete") {
                    setPhase("done");
                    clearInterval(interval);
                } else if (data.status === "failed") {
                    setErrorMessage(data.error || "Export failed.");
                    setPhase("error");
                    clearInterval(interval);
                }
            } catch (error) {
                setErrorMessage(getErrorMessage(error));
                setPhase("error");
                clearInterval(interval);
            }

        }, 1200);

        return () => clearInterval(interval);

    }, [phase, job?.id]);

    const download = async () => {
        try {
            const response = await api.get(`/api/export/${job.id}/download`, { responseType: "blob" });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const a = document.createElement("a");
            a.href = url;
            a.download = `QBO-Export-${region}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            pushToast(getErrorMessage(error), "error");
        }
    };

    const reset = () => {
        setPhase("setup");
        setReport(null);
        setJob(null);
        setErrorMessage("");
    };


    if (!connection.connected) {
        return (
            <Card>
                <EmptyState title="Connect QuickBooks first" description="You need an active source connection before you can export." />
            </Card>
        );
    }

    const stepDefs = [
        { key: "fetch", label: "Fetch source data", description: "Pulling records from QuickBooks" },
        { key: "map", label: "Map to destination", description: "Applying region field mapping" },
        { key: "validate", label: "Validate", description: "Checking required fields" },
        { key: "generate", label: "Generate Excel", description: "Filling the destination template" }
    ].map((s) => ({ ...s, status: job?.steps?.[s.key] || "pending" }));

    const selectedRegionMeta = regions.find((r) => r.code === region);

    // ---- presentation-only helpers (no effect on what is sent to the API) ----
    const selectAllAvailable = () => setSelectedModules((prev) => Array.from(new Set([...prev, ...MODULES.filter((m) => availableForRegion.includes(m.key)).map((m) => m.key)])));
    const deselectAll = () => setSelectedModules([]);
    const selectableCount = MODULES.filter((m) => availableForRegion.includes(m.key)).length;
    const selectedCount = selectedModules.length;
    const q = moduleSearch.trim().toLowerCase();
    const labelOf = (key) => (MODULE_META[key]?.label || key);
    const visibleGroups = MODULE_GROUPS
        .map((g) => ({ ...g, modules: g.modules.filter((key) => MODULES.some((m) => m.key === key) && (!q || labelOf(key).toLowerCase().includes(q))) }))
        .filter((g) => g.modules.length > 0);

    const totals = report
        ? Object.values(report).reduce((acc, r) => ({
            total: acc.total + r.total,
            mapped: acc.mapped + r.mappedCount,
            attention: acc.attention + r.needsAttentionCount,
            invalid: acc.invalid + r.invalidCount
        }), { total: 0, mapped: 0, attention: 0, invalid: 0 })
        : null;

    const doneStages = stepDefs.filter((s) => s.status === "done").length;
    const stagePct = (doneStages / stepDefs.length) * 100;
    const writtenTotal = job?.summary?.reduce((sum, s) => sum + s.writtenRows, 0) || 0;
    const skippedTotal = job?.summary?.reduce((sum, s) => sum + (s.skippedRows || 0), 0) || 0;

    const dateInput = (hasError) => `mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-teal-500 ${hasError ? "border-rose-600" : "border-ink-300"}`;

    return (
        <div>

            <Card className="px-4 sm:px-8 py-5 mb-6">
                <WizardSteps phase={phase} />
            </Card>

            <AnimatePresence mode="wait">

                {phase === "setup" && (
                    <motion.div key="setup" {...pageFade} className="space-y-5">

                        <Card className="p-6">
                            <p className="text-base font-semibold text-ink-900">Destination region</p>
                            <p className="text-sm text-ink-500 mt-0.5 mb-4">Choose the QuickBooks region whose Excel templates you are exporting to.</p>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                {regions.map((r) => (
                                    <RegionCard
                                        key={r.code}
                                        region={r}
                                        selected={region === r.code}
                                        onClick={() => setRegion(r.code)}
                                    />
                                ))}
                            </div>
                        </Card>

                        <Card className="p-6">
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="mr-auto">
                                    <p className="text-base font-semibold text-ink-900">Accounting data to include</p>
                                    <p className="text-sm text-ink-500 mt-0.5">
                                        <span className="font-semibold text-teal-700 tabular-nums">{selectedCount}</span> of {selectableCount} available modules selected
                                    </p>
                                </div>
                                <SearchInput value={moduleSearch} onChange={setModuleSearch} placeholder="Search modules" className="w-full sm:w-56" />
                                <div className="flex items-center gap-1">
                                    <Button variant="ghost" className="!px-3 !py-2 !text-teal-700" onClick={selectAllAvailable} disabled={selectableCount === 0}>Select all</Button>
                                    <Button variant="ghost" className="!px-3 !py-2" onClick={deselectAll} disabled={selectedCount === 0}>Deselect all</Button>
                                </div>
                            </div>

                            <div className="mt-5 space-y-6">
                                {visibleGroups.length === 0 && (
                                    <p className="text-sm text-ink-500 py-6 text-center">No modules match "{moduleSearch}".</p>
                                )}
                                {visibleGroups.map((group) => {
                                    const groupSelected = group.modules.filter((k) => selectedModules.includes(k)).length;
                                    const collapsed = collapsedGroups.includes(group.key) && !q;
                                    return (
                                        <section key={group.key}>
                                            <button
                                                type="button"
                                                onClick={() => setCollapsedGroups((prev) => prev.includes(group.key) ? prev.filter((k) => k !== group.key) : [...prev, group.key])}
                                                className="w-full flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500 hover:text-ink-900 transition-colors"
                                                aria-expanded={!collapsed}
                                            >
                                                {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                                {group.label}
                                                <span className="font-medium normal-case tracking-normal text-ink-400">{groupSelected}/{group.modules.length} selected</span>
                                            </button>
                                            <AnimatePresence initial={false}>
                                                {!collapsed && (
                                                    <motion.div
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: "auto" }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        transition={{ duration: 0.2 }}
                                                        className="overflow-hidden"
                                                    >
                                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 pt-3">
                                                            {group.modules.map((key) => (
                                                                <ModuleCard
                                                                    key={key}
                                                                    moduleKey={key}
                                                                    checked={selectedModules.includes(key)}
                                                                    supported={availableForRegion.includes(key)}
                                                                    onToggle={toggleModule}
                                                                />
                                                            ))}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </section>
                                    );
                                })}
                            </div>
                        </Card>

                        <AnimatePresence>
                            {(includesDateFilterable || activeRangeKeys.length > 0) && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                >
                                    <Card className="p-6 grid gap-8 md:grid-cols-2">

                                        {includesDateFilterable && (
                                            <div>
                                                <p className="text-base font-semibold text-ink-900">
                                                    {dateRequired ? "Conversion cutoff date (required)" : "Open balances as of (optional)"}
                                                </p>
                                                <p className="text-sm text-ink-500 mt-0.5 mb-3">
                                                    {dateRequired
                                                        ? "Open Balance needs a conversion cutoff date — it pulls each account's Trial Balance as of this date and uses it as the Journal Date."
                                                        : "Only includes AR/AP transactions dated on or before this date that are still open today. Leave blank to include every currently open item."}
                                                </p>
                                                <label className="text-xs font-semibold text-ink-500 block max-w-[12rem]">
                                                    As of
                                                    <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className={dateInput(dateMissing)} />
                                                </label>
                                                {dateMissing && <p className="text-xs text-rose-600 mt-1.5">Required to export Open Balance.</p>}
                                            </div>
                                        )}

                                        {activeRangeKeys.length > 0 && (
                                            <div>
                                                <p className="text-base font-semibold text-ink-900">Transaction date range (optional)</p>
                                                <p className="text-sm text-ink-500 mt-0.5 mb-3">
                                                    Applies to all selected transaction modules (invoices, bills, payments, credits, journals and so on) and filters by the transaction date. Leave both blank to export everything; set only one to leave the other end open.
                                                </p>
                                                <div className="flex gap-3">
                                                    {[["startDate", "Start date"], ["endDate", "End date"]].map(([field, label]) => (
                                                        <label key={field} className="text-xs font-semibold text-ink-500 block flex-1 max-w-[12rem]">
                                                            {label}
                                                            <input
                                                                type="date"
                                                                value={txnRange[field]}
                                                                onChange={(e) => setTxnRange((prev) => ({ ...prev, [field]: e.target.value }))}
                                                                className={dateInput(anyRangeInvalid)}
                                                            />
                                                        </label>
                                                    ))}
                                                </div>
                                                {anyRangeInvalid && <p className="text-xs text-rose-600 mt-1.5">Start date cannot be after end date.</p>}
                                            </div>
                                        )}

                                    </Card>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="sticky bottom-0 z-20 -mx-1 px-1 pb-1 pt-2 bg-gradient-to-t from-ink-50 via-ink-50 to-transparent">
                            <Card className="px-5 py-3.5 flex items-center justify-between gap-4 shadow-soft">
                                <p className="text-sm text-ink-500 min-w-0 truncate">
                                    {selectedRegionMeta ? <><span className="font-semibold text-ink-900">{selectedRegionMeta.label}</span> · {selectedRegionMeta.currency} · </> : ""}
                                    {selectedCount} module{selectedCount === 1 ? "" : "s"} selected
                                </p>
                                <Button
                                    variant="accent"
                                    className="shrink-0"
                                    disabled={busy || selectedModules.length === 0 || dateMissing || anyRangeInvalid}
                                    onClick={runPreview}
                                >
                                    {busy && <Spinner className="w-4 h-4" />}
                                    Preview & validate
                                </Button>
                            </Card>
                        </div>

                    </motion.div>
                )}

                {phase === "reviewing" && report && (
                    <motion.div key="reviewing" {...pageFade} className="space-y-4">

                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <StatTile label="Records" value={totals.total.toLocaleString()} hint={`${Object.keys(report).length} module${Object.keys(report).length === 1 ? "" : "s"}`} />
                            <StatTile label="Mapped" value={totals.mapped.toLocaleString()} tone="success" />
                            <StatTile label="Needs attention" value={totals.attention.toLocaleString()} tone={totals.attention ? "warning" : "ink"} />
                            <StatTile label="Invalid" value={totals.invalid.toLocaleString()} tone={totals.invalid ? "error" : "ink"} hint={totals.invalid ? "Skipped from export" : undefined} />
                        </div>

                        {Object.entries(report).map(([key, entityReport]) => (
                            <EntityReportCard key={key} entityKey={key} report={entityReport} />
                        ))}

                        <div className="sticky bottom-0 z-20 pb-1 pt-2 bg-gradient-to-t from-ink-50 via-ink-50 to-transparent">
                            <Card className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-soft">
                                <p className="text-sm text-ink-500">
                                    Rows marked <span className="font-semibold text-rose-700">Invalid</span> will be skipped from the export.
                                    Everything else will be written.
                                </p>
                                <div className="flex gap-2 shrink-0">
                                    <Button variant="outline" onClick={reset} disabled={busy}><ArrowLeft size={15} /> Back</Button>
                                    <Button variant="accent" disabled={busy} onClick={startExport}>
                                        {busy && <Spinner className="w-4 h-4" />}
                                        Generate Excel
                                    </Button>
                                </div>
                            </Card>
                        </div>

                    </motion.div>
                )}

                {phase === "exporting" && (
                    <motion.div key="exporting" {...pageFade} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
                        <Card className="p-6">
                            <p className="text-base font-semibold text-ink-900">Generating your Excel file</p>
                            <p className="text-sm text-ink-500 mt-0.5 mb-6">This can take a while for large companies — feel free to leave this open.</p>
                            <Stepper steps={stepDefs} />
                        </Card>
                        <Card className="p-6 h-fit">
                            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Overall progress</p>
                            <p className="text-4xl font-semibold text-ink-900 mt-2 tabular-nums">{Math.round(stagePct)}%</p>
                            <ProgressBar value={stagePct} className="mt-3" />
                            <p className="text-xs text-ink-500 mt-2">{doneStages} of {stepDefs.length} stages complete</p>
                            <Button variant="outline" className="w-full mt-5" disabled>
                                <Loader2 size={15} className="animate-spin" /> Generating…
                            </Button>
                        </Card>
                    </motion.div>
                )}

                {phase === "done" && job && (
                    <motion.div key="done" {...pageFade}>
                        <Card className="p-8">
                            <div className="text-center">
                                <SuccessMark />
                                <p className="text-xl font-semibold text-ink-900 mt-4">Your export is ready</p>
                                <p className="text-sm text-ink-500 mt-1.5">
                                    {writtenTotal.toLocaleString()} rows written across {job.summary?.length || 0} sheet(s).
                                </p>
                            </div>

                            <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3 max-w-3xl mx-auto">
                                <StatTile label="Destination" value={<span className="text-base">{selectedRegionMeta?.label || region}</span>} />
                                <StatTile label="Sheets" value={job.summary?.length || 0} />
                                <StatTile label="Rows written" value={writtenTotal.toLocaleString()} tone="success" />
                                <StatTile label="Rows skipped" value={skippedTotal.toLocaleString()} tone={skippedTotal ? "warning" : "ink"} />
                            </div>

                            <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-2 max-w-3xl mx-auto">
                                {job.summary?.map((s) => (
                                    <div key={s.sheetName} className="border border-ink-200 rounded-lg px-3 py-2.5 text-xs flex items-start gap-2">
                                        <CheckCircle2 size={15} className="text-green-600 mt-0.5 shrink-0" />
                                        <div className="min-w-0">
                                            <p className="font-semibold text-ink-900 truncate">{s.sheetName}</p>
                                            <p className="text-ink-500 mt-0.5">
                                                {s.writtenRows} written{s.skippedRows > 0 ? `, ${s.skippedRows} skipped` : ""}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                                <Button variant="accent" className="px-6 py-3 text-base" onClick={download}>
                                    <Download size={18} /> Download Excel
                                </Button>
                                <Button variant="outline" onClick={reset}>
                                    <RotateCcw size={15} /> Start new export
                                </Button>
                            </div>
                        </Card>
                    </motion.div>
                )}

                {phase === "error" && (
                    <motion.div key="error" {...pageFade}>
                        <Card className="p-8 text-center">
                            <div className="w-16 h-16 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
                                <XCircle size={28} className="text-rose-600" />
                            </div>
                            <p className="text-xl font-semibold text-ink-900">Export could not be completed</p>
                            <p className="text-sm text-ink-500 mt-1.5 max-w-md mx-auto">{errorMessage}</p>
                            <Button variant="outline" className="mt-6" onClick={reset}>
                                <RotateCcw size={15} /> Try again
                            </Button>
                        </Card>
                    </motion.div>
                )}

            </AnimatePresence>

        </div>
    );

};

export default ExportFlow;
