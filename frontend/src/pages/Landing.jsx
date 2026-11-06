import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
    ArrowRight, ShieldCheck, FileSpreadsheet, Globe2, Lock, Gauge,
    Database, ArrowDown, Landmark, Users, Truck, Package, Receipt, FileText
} from "lucide-react";
import api, { AUTH_LOGIN_URL } from "../api/client.js";
import { Button, Card, IconTile } from "../components/ui.jsx";
import { useApp } from "../context/AppContext.jsx";
import { getRegionFlag } from "../constants/display.js";

const WORKFLOW = [
    { icon: Database, label: "Source QBO", note: "Read-only OAuth connection" },
    { icon: Gauge, label: "Fetch", note: "Pull accounts, customers, invoices…" },
    { icon: Globe2, label: "Map", note: "Applied per destination region" },
    { icon: FileSpreadsheet, label: "Destination Template", note: "Your real regional spreadsheet" },
    { icon: FileSpreadsheet, label: "Excel", note: "Ready to download" }
];

const MODULES = [
    { icon: Landmark, label: "Accounts" },
    { icon: Users, label: "Customers" },
    { icon: Truck, label: "Vendors" },
    { icon: Package, label: "Items" },
    { icon: FileText, label: "AR" },
    { icon: Receipt, label: "AP" }
];

const BENEFITS = [
    { title: "Read-only by design", body: "Only the source company is authenticated. Nothing is ever written back to QuickBooks." },
    { title: "No destination connection", body: "The destination region is just a template — no second OAuth, no second company to manage." },
    { title: "Region-aware templates", body: "Every export fills the actual spreadsheet a region expects — same sheets, same columns." },
    { title: "Accurate field mapping", body: "Field mapping, value transformation and reference handling run through one configurable engine." },
    { title: "Excel-ready output", body: "Download a finished .xlsx per accounting module, packaged together, ready to hand off." },
    { title: "Large dataset support", body: "Built for companies with thousands of records — paginated fetches, streamed generation." }
];

const fadeUp = (delay = 0) => ({
    initial: { opacity: 0, y: 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-60px" },
    transition: { duration: 0.5, delay, ease: "easeOut" }
});

const Landing = () => {

    const navigate = useNavigate();
    const { connection } = useApp();
    const [regions, setRegions] = useState([]);

    useEffect(() => {
        api.get("/api/regions").then(({ data }) => setRegions(data.regions || [])).catch(() => {});
    }, []);

    const goConnect = () => {
        if (connection.connected) navigate("/dashboard");
        else window.location.href = AUTH_LOGIN_URL;
    };

    return (
        <div className="min-h-screen bg-ink-50 overflow-x-hidden">

            {/* ---------------------------------------------------------------- Header */}
            <header className="flex items-center justify-between px-6 md:px-10 py-5 max-w-6xl mx-auto">
                <div className="flex items-center gap-2.5">
                    <img src="/ledger.svg" alt="" className="w-8 h-8" />
                    <span className="font-bold text-ink-900">Ledger Bridge</span>
                </div>
                {connection.connected ? (
                    <Button variant="outline" onClick={() => navigate("/dashboard")}>
                        Go to dashboard <ArrowRight size={15} />
                    </Button>
                ) : (
                    <Button variant="accent" onClick={goConnect}>
                        Connect QuickBooks
                    </Button>
                )}
            </header>

            {/* ---------------------------------------------------------------- Hero */}
            <section className="relative">
                <div className="absolute inset-0 bg-hero-glow pointer-events-none" />
                <div className="relative max-w-3xl mx-auto px-6 md:px-8 pt-16 md:pt-20 pb-20 text-center">

                    <motion.p
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 bg-teal-100 rounded-full px-3 py-1 mb-5"
                    >
                        QuickBooks Online · Regional Export
                    </motion.p>

                    <motion.h1
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.08 }}
                        className="text-4xl sm:text-5xl font-bold text-ink-900 leading-[1.1] tracking-tight"
                    >
                        Export QuickBooks data to
                        <br className="hidden sm:block" />
                        <span className="text-gradient">regional Excel templates</span>
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.16 }}
                        className="mt-5 text-lg text-ink-500 max-w-xl mx-auto"
                    >
                        Connect a source QuickBooks company, pick a destination region, and download
                        an Excel file already shaped for that region's import template. Read-only,
                        nothing is written back to QuickBooks.
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.24 }}
                        className="mt-9 flex items-center justify-center gap-3"
                    >
                        <Button variant="accent" className="px-6 py-3 text-base" onClick={goConnect}>
                            {connection.connected ? "Go to dashboard" : "Connect your QuickBooks company"}
                            <ArrowRight size={17} />
                        </Button>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                        className="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-400"
                    >
                        <Lock size={12} /> Read-only OAuth · No destination QBO connection
                    </motion.div>

                </div>
            </section>

            {/* ---------------------------------------------------------------- Workflow */}
            <section className="max-w-5xl mx-auto px-6 md:px-8 pb-24">
                <motion.p {...fadeUp()} className="text-center text-sm font-semibold text-ink-400 uppercase tracking-wide mb-10">
                    How it works
                </motion.p>

                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 md:gap-0">
                    {WORKFLOW.map((step, i) => (
                        <motion.div key={step.label} className="flex md:flex-1 items-center" {...fadeUp(i * 0.08)}>
                            <div className="flex-1 flex flex-col items-center text-center bg-white border border-ink-200 rounded-2xl px-4 py-6 shadow-card">
                                <IconTile icon={step.icon} tone={i === WORKFLOW.length - 1 ? "teal" : "indigo"} />
                                <p className="mt-3 font-semibold text-sm text-ink-900">{step.label}</p>
                                <p className="text-xs text-ink-500 mt-1">{step.note}</p>
                            </div>
                            {i < WORKFLOW.length - 1 && (
                                <div className="hidden md:flex items-center justify-center w-10 shrink-0">
                                    <svg width="40" height="16" viewBox="0 0 40 16" fill="none">
                                        <line x1="0" y1="8" x2="34" y2="8" stroke="#0F766E" strokeWidth="2" strokeDasharray="4 4" className="animate-flow-dash" />
                                        <path d="M30 3l6 5-6 5" stroke="#0F766E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                                    </svg>
                                </div>
                            )}
                            {i < WORKFLOW.length - 1 && (
                                <div className="flex md:hidden justify-center py-1">
                                    <ArrowDown size={16} className="text-teal-600" />
                                </div>
                            )}
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* ---------------------------------------------------------------- Supported regions */}
            {regions.length > 0 && (
                <section className="max-w-5xl mx-auto px-6 md:px-8 pb-24">
                    <motion.p {...fadeUp()} className="text-center text-sm font-semibold text-ink-400 uppercase tracking-wide mb-3">
                        Supported destination regions
                    </motion.p>
                    <motion.h2 {...fadeUp(0.05)} className="text-center text-2xl font-bold text-ink-900 mb-10">
                        Any source company, any supported region
                    </motion.h2>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                        {regions.map((region, i) => (
                            <motion.div
                                key={region.code}
                                {...fadeUp(i * 0.05)}
                                className="bg-white border border-ink-200 rounded-2xl px-4 py-5 text-center shadow-card hover:shadow-soft hover:-translate-y-0.5 transition-all"
                            >
                                <span className="text-2xl">{getRegionFlag(region.code)}</span>
                                <p className="mt-2 font-semibold text-sm text-ink-900">{region.label}</p>
                                <p className="text-xs text-ink-500 mt-0.5">{region.currency}</p>
                                <p className="text-[11px] text-teal-700 mt-1.5 font-medium">
                                    {region.availableModules.length} modules ready
                                </p>
                            </motion.div>
                        ))}
                    </div>
                </section>
            )}

            {/* ---------------------------------------------------------------- Accounting data */}
            <section className="max-w-5xl mx-auto px-6 md:px-8 pb-24">
                <motion.p {...fadeUp()} className="text-center text-sm font-semibold text-ink-400 uppercase tracking-wide mb-3">
                    Accounting data
                </motion.p>
                <motion.h2 {...fadeUp(0.05)} className="text-center text-2xl font-bold text-ink-900 mb-10">
                    Everything a migration needs, module by module
                </motion.h2>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                    {MODULES.map((mod, i) => (
                        <motion.div
                            key={mod.label}
                            {...fadeUp(i * 0.04)}
                            className="bg-white border border-ink-200 rounded-xl px-3 py-5 text-center"
                        >
                            <IconTile icon={mod.icon} tone="ink" className="mx-auto" />
                            <p className="mt-2.5 text-xs font-semibold text-ink-800">{mod.label}</p>
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* ---------------------------------------------------------------- Benefits */}
            <section className="max-w-5xl mx-auto px-6 md:px-8 pb-24">
                <motion.p {...fadeUp()} className="text-center text-sm font-semibold text-ink-400 uppercase tracking-wide mb-3">
                    Why teams use it
                </motion.p>
                <motion.h2 {...fadeUp(0.05)} className="text-center text-2xl font-bold text-ink-900 mb-10">
                    Built for accurate, repeatable exports
                </motion.h2>

                <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {BENEFITS.map((b, i) => (
                        <motion.div key={b.title} {...fadeUp(i * 0.05)}>
                            <Card className="p-5 h-full" hover>
                                <p className="font-semibold text-sm text-ink-900">{b.title}</p>
                                <p className="text-sm text-ink-500 mt-1.5">{b.body}</p>
                            </Card>
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* ---------------------------------------------------------------- Security */}
            <section className="max-w-3xl mx-auto px-6 md:px-8 pb-24">
                <motion.div {...fadeUp()} className="rounded-2xl bg-navy-fade p-8 text-center shadow-lift">
                    <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4">
                        <ShieldCheck size={22} className="text-teal-400" />
                    </div>
                    <p className="text-lg font-bold text-white">Read-only, by design</p>
                    <p className="text-sm text-ink-200 mt-2 max-w-md mx-auto">
                        Ledger Bridge authenticates only the source QuickBooks company. There is no destination
                        QBO connection, no destination Realm ID, and no data is ever pushed, created, or
                        updated anywhere. The only output is an Excel file.
                    </p>
                </motion.div>
            </section>

            {/* ---------------------------------------------------------------- Final CTA */}
            <section className="max-w-3xl mx-auto px-6 md:px-8 pb-24 text-center">
                <motion.div {...fadeUp()}>
                    <h2 className="text-2xl font-bold text-ink-900">Ready to export your first company?</h2>
                    <p className="text-sm text-ink-500 mt-2">Connecting takes under a minute — your data stays read-only the whole way through.</p>
                    <div className="mt-6">
                        <Button variant="accent" className="px-6 py-3 text-base" onClick={goConnect}>
                            {connection.connected ? "Go to dashboard" : "Connect your QuickBooks company"}
                            <ArrowRight size={17} />
                        </Button>
                    </div>
                </motion.div>
            </section>

            {/* ---------------------------------------------------------------- Footer */}
            <footer className="border-t border-ink-200 py-8">
                <div className="max-w-5xl mx-auto px-6 md:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <img src="/ledger.svg" alt="" className="w-6 h-6" />
                        <span className="text-sm font-semibold text-ink-700">Ledger Bridge</span>
                    </div>
                    <p className="text-xs text-ink-400">QBO Regional Export · Read-only · No data pushed to QuickBooks</p>
                </div>
            </footer>

        </div>
    );

};

export default Landing;
