import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Percent, Plus, Pencil, Check, Info, X } from "lucide-react";
import api, { getErrorMessage } from "../api/client.js";
import { Card, Button, Badge, Spinner, EmptyState, PageHeader, StatTile, SearchInput, Modal } from "../components/ui.jsx";
import { useApp } from "../context/AppContext.jsx";

const STATUS_META = {
    mapped: { label: "Mapped", tone: "success" },
    suggested: { label: "Suggested", tone: "accent" },
    manual_rate: { label: "Manual Rate", tone: "warning" },
    unmapped: { label: "Unmapped", tone: "warning" },
    error: { label: "Error", tone: "error" }
};

const FILTERS = [
    { key: "all", label: "All Taxes" },
    { key: "mapped", label: "Mapped" },
    { key: "suggested", label: "Suggested" },
    { key: "manual_rate", label: "Manual Rate" },
    { key: "unmapped", label: "Unmapped" },
    { key: "error", label: "Error" }
];

const fmtRate = (rate) => (rate === null || rate === undefined ? "—" : `${rate}%`);

// Same rules as the server (taxMapping.service.js validateTargetTax); the server re-validates every save.
const validate = (form) => {
    const errors = {};
    const name = form.targetName.trim();
    if (!name) errors.targetName = "Tax name is required.";
    else if (name.length > 100) errors.targetName = "Tax name must be 100 characters or fewer.";
    const rate = String(form.targetRate).trim();
    if (rate === "") errors.targetRate = "Tax rate is required.";
    else if (!/^-?\d+(\.\d+)?$/.test(rate)) errors.targetRate = "Tax rate must be a number, e.g. 15 or 7.5.";
    else if (Number(rate) < 0 || Number(rate) > 100) errors.targetRate = "Tax rate must be between 0 and 100.";
    else if (Math.abs(Number(rate) * 10000 - Math.round(Number(rate) * 10000)) > 1e-6) errors.targetRate = "Tax rate can have at most 4 decimal places.";
    if (form.targetType.trim().length > 50) errors.targetType = "Tax type must be 50 characters or fewer.";
    return errors;
};

const Field = ({ label, error, children }) => (
    <label className="block">
        <span className="text-xs font-semibold text-ink-600">{label}</span>
        <div className="mt-1">{children}</div>
        {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
    </label>
);

const inputClass = "w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500";

const ManualEntryModal = ({ row, serverErrors, saving, onClose, onSave }) => {

    const [form, setForm] = useState({
        targetName: row.origin ? row.targetName || "" : "",
        targetRate: row.origin && row.targetRate !== null ? String(row.targetRate) : "",
        targetType: row.targetType || "",
        calcType: row.calcType || "",
        confirmed: row.confirmed === true
    });
    const [touched, setTouched] = useState(false);
    const errors = { ...validate(form), ...serverErrors };
    const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

    const submit = () => {
        setTouched(true);
        if (Object.keys(validate(form)).length) return;
        onSave(form);
    };

    const showErr = (key) => (touched || serverErrors[key] ? errors[key] : undefined);

    return (
        <Modal open onClose={onClose} className="max-w-md">
            <div className="p-6">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-base font-semibold text-ink-900">Target tax for "{row.sourceName}"</p>
                        <p className="text-xs text-ink-500 mt-0.5">Source rate: {fmtRate(row.sourceRate)} · {row.sourceType}</p>
                    </div>
                    <button onClick={onClose} className="text-ink-400 hover:text-ink-700" aria-label="Close"><X size={16} /></button>
                </div>

                <div className="mt-4 space-y-3">
                    <Field label="Tax Name" error={showErr("targetName")}>
                        <input className={inputClass} value={form.targetName} onChange={set("targetName")} maxLength={120} />
                    </Field>
                    <Field label="Tax Rate (%)" error={showErr("targetRate")}>
                        <input className={inputClass} value={form.targetRate} onChange={set("targetRate")} inputMode="decimal" placeholder="e.g. 15" />
                    </Field>
                    <Field label="Tax Type (optional)" error={showErr("targetType")}>
                        <input className={inputClass} value={form.targetType} onChange={set("targetType")} maxLength={60} placeholder="e.g. VAT, GST" />
                    </Field>
                    <Field label="Tax Calculation Type (where applicable)" error={showErr("calcType")}>
                        <select className={inputClass} value={form.calcType} onChange={set("calcType")}>
                            <option value="">Not specified</option>
                            <option value="exclusive">Tax Exclusive</option>
                            <option value="inclusive">Tax Inclusive</option>
                        </select>
                    </Field>
                    <label className="flex items-start gap-2 text-xs text-ink-700">
                        <input type="checkbox" className="mt-0.5" checked={form.confirmed} onChange={set("confirmed")} />
                        <span>This tax code already exists in the target company (or I will create it there before migration). Unconfirmed entries are not used in exports.</span>
                    </label>
                    {row.multiComponent && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">The source tax has several components; the target tax must have the same components.</p>
                    )}
                </div>

                <div className="mt-5 flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button variant="accent" onClick={submit} disabled={saving}>{saving ? <Spinner className="w-4 h-4" /> : "Save mapping"}</Button>
                </div>
            </div>
        </Modal>
    );
};

const TaxMapping = () => {

    const { connection, pushToast } = useApp();
    const [regions, setRegions] = useState([]);
    const [region, setRegion] = useState("");
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [filter, setFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState(null);
    const [serverErrors, setServerErrors] = useState({});

    useEffect(() => {
        api.get("/api/regions").then(({ data: r }) => setRegions(r.regions)).catch((e) => pushToast(getErrorMessage(e), "error"));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const load = useCallback(async (code) => {
        setLoading(true); setLoadError(""); setData(null);
        try {
            const { data: d } = await api.get("/api/tax-mapping", { params: { region: code } });
            setData(d);
        } catch (e) {
            setLoadError(getErrorMessage(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { if (region && connection.connected) load(region); }, [region, connection.connected, load]);

    const save = async (payload, { closeModal = false } = {}) => {
        setSaving(true); setServerErrors({});
        try {
            const { data: d } = await api.put("/api/tax-mapping", { region, ...payload });
            setData(d);
            if (closeModal) setEditing(null);
            pushToast("Tax mapping saved.", "success");
        } catch (e) {
            const fe = e.response?.data?.fieldErrors;
            if (fe?.length) setServerErrors(Object.fromEntries(fe.map((x) => [x.field, x.message])));
            else pushToast(getErrorMessage(e), "error");
        } finally {
            setSaving(false);
        }
    };

    const visible = useMemo(() => {
        if (!data) return [];
        const q = search.trim().toLowerCase();
        return data.rows.filter((r) => (filter === "all" || r.status === filter) && (!q ||
            r.sourceName.toLowerCase().includes(q) || String(r.sourceRate ?? "").includes(q) || String(r.targetName ?? "").toLowerCase().includes(q) || String(r.targetRate ?? "").includes(q)));
    }, [data, filter, search]);

    if (!connection.connected) {
        return (
            <EmptyState icon={Percent} title="Connect a QuickBooks company first"
                description="Tax mapping reads the tax codes and rates of the connected source company."
                action={<Link to="/connect"><Button variant="accent">Go to Connection</Button></Link>} />
        );
    }

    return (
        <div className="space-y-5">
            <PageHeader
                title="Tax Mapping"
                description="Map each source tax to the tax code that exists in the target company. Used by the export when enabled for the region."
            />

            {data && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <StatTile label="Source taxes" value={(data.counts.all ?? data.rows.length).toLocaleString()} />
                    <StatTile label="Mapped" value={(data.counts.mapped ?? 0).toLocaleString()} tone="success" />
                    <StatTile label="Unmapped" value={(data.counts.unmapped ?? 0).toLocaleString()} tone={data.counts.unmapped ? "warning" : "ink"} />
                    <StatTile label="Need review" value={((data.counts.suggested ?? 0) + (data.counts.manual_rate ?? 0) + (data.counts.error ?? 0)).toLocaleString()} tone="info" hint="Suggested, manual rate or error" />
                </div>
            )}

            <Card className="p-4 flex flex-wrap items-center gap-3">
                <select className={`${inputClass} max-w-[220px]`} value={region} onChange={(e) => setRegion(e.target.value)}>
                    <option value="">Select destination region…</option>
                    {regions.map((r) => <option key={r.code} value={r.code}>{r.label || r.code}</option>)}
                </select>
                {data && (
                    <label className="flex items-center gap-2 text-sm text-ink-700 ml-auto">
                        <input type="checkbox" className="accent-teal-600 w-4 h-4" checked={data.enabled} disabled={saving} onChange={(e) => save({ enabled: e.target.checked, changes: [] })} />
                        Use this tax mapping in {region} exports
                    </label>
                )}
            </Card>

            {data && (
                <div className="flex gap-2 text-xs text-teal-700 bg-teal-50 border border-teal-100 rounded-xl px-4 py-3">
                    <Info size={15} className="shrink-0 mt-0.5" />
                    <p className="text-ink-700">{data.target.message} South Africa's "VAT amount present → Standard / zero → Out of Scope" rule stays in force for the lines it covers; the mapping applies to the remaining tax codes.</p>
                </div>
            )}

            {loading && <div className="flex justify-center py-12"><Spinner className="w-7 h-7 text-teal-600" /></div>}
            {loadError && <Card className="p-4 text-sm text-rose-700">{loadError} <Button variant="outline" className="ml-3" onClick={() => load(region)}>Retry</Button></Card>}

            {data && (
                <Card className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                        {FILTERS.map((f) => (
                            <button key={f.key} onClick={() => setFilter(f.key)}
                                className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors duration-150 ${filter === f.key ? "bg-ink-900 text-white border-ink-900" : "bg-white border-ink-300 text-ink-600 hover:bg-ink-100"}`}>
                                {f.label} ({data.counts[f.key] ?? 0})
                            </button>
                        ))}
                        <SearchInput className="ml-auto w-full sm:w-64" placeholder="Search name or %" value={search} onChange={setSearch} />
                    </div>

                    {data.rows.length === 0 ? (
                        <EmptyState icon={Percent} title="No tax codes found" description="The source company returned no tax codes." />
                    ) : visible.length === 0 ? (
                        <p className="text-sm text-ink-500 py-8 text-center">No taxes match this filter.</p>
                    ) : (
                        <div className="mt-4 overflow-x-auto rounded-lg border border-ink-200">
                            <table className="w-full text-sm">
                                <thead className="bg-ink-100 text-ink-500 sticky top-0">
                                    <tr>
                                        {["Source Tax", "Source Rate", "Target Tax", "Target Rate", "Status", "Action"].map((h) => <th key={h} className="text-left px-3 py-2.5 font-semibold uppercase tracking-wide text-[11px]">{h}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.map((r) => {
                                        const meta = STATUS_META[r.status];
                                        const target = r.status === "unmapped" ? "Not Available" : (r.status === "manual_rate" && !r.targetName ? "Manual Entry" : r.targetName || "—");
                                        return (
                                            <tr key={r.sourceId} className={`border-t border-ink-200 align-top transition-colors hover:bg-ink-50 ${r.status === "unmapped" || r.status === "error" ? "bg-amber-50/70" : ""}`}>
                                                <td className="px-3 py-2 text-ink-800">
                                                    {r.sourceName}
                                                    <div className="text-ink-400">{r.sourceType}{!r.sourceActive ? " · inactive" : ""}{r.sourceComponents.length > 1 ? ` · ${r.sourceComponents.map((c) => `${c.name || c.rateId} ${Number.isFinite(c.percent) ? c.percent + "%" : "?"}`).join(" + ")}` : ""}</div>
                                                </td>
                                                <td className="px-3 py-2">{fmtRate(r.sourceRate)}</td>
                                                <td className="px-3 py-2 text-ink-800">{target}{r.status === "suggested" && <span className="text-ink-400"> (suggested)</span>}</td>
                                                <td className="px-3 py-2">{r.status === "unmapped" ? "—" : fmtRate(r.targetRate)}</td>
                                                <td className="px-3 py-2">
                                                    <Badge tone={meta.tone}>{meta.label}</Badge>
                                                    {r.message && <div className="text-ink-500 mt-1 max-w-xs">{r.message}</div>}
                                                </td>
                                                <td className="px-3 py-2 whitespace-nowrap">
                                                    {r.status === "suggested" && (
                                                        <Button variant="outline" className="!px-2.5 !py-1 !text-xs mr-1" disabled={saving}
                                                            onClick={() => save({ changes: [{ sourceId: r.sourceId, action: "accept-suggestion" }] })}>
                                                            <Check size={12} /> Accept
                                                        </Button>
                                                    )}
                                                    <Button variant="ghost" className="!px-2.5 !py-1 !text-xs" onClick={() => { setServerErrors({}); setEditing(r); }}>
                                                        {r.status === "unmapped" ? <><Plus size={12} /> Enter Tax Rate Manually</> : r.status === "suggested" ? <><Plus size={12} /> Enter Manually</> : <><Pencil size={12} /> Edit</>}
                                                    </Button>
                                                    {r.origin && (
                                                        <Button variant="ghost" className="!px-2.5 !py-1 !text-xs" disabled={saving}
                                                            onClick={() => save({ changes: [{ sourceId: r.sourceId, action: "clear" }] })}>Clear</Button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            )}

            {editing && (
                <ManualEntryModal row={editing} serverErrors={serverErrors} saving={saving} onClose={() => setEditing(null)}
                    onSave={(form) => save({ changes: [{ sourceId: editing.sourceId, action: "set", ...form }] }, { closeModal: true })} />
            )}
        </div>
    );

};

export default TaxMapping;
