import { useState } from "react";
import { motion } from "framer-motion";
import { Plug, LogOut, RefreshCcw, ShieldCheck, Lock, EyeOff, Loader2 } from "lucide-react";
import { AUTH_LOGIN_URL } from "../api/client.js";
import { Button, Card, Badge, SectionLabel, PageHeader, IconTile, ConfirmDialog, Skeleton } from "../components/ui.jsx";
import { useApp } from "../context/AppContext.jsx";

const TRUST_POINTS = [
    { icon: Lock, text: "Secure OAuth 2.0 — Intuit handles your credentials, never us." },
    { icon: EyeOff, text: "Read-only access — data is fetched, nothing is written back." },
    { icon: ShieldCheck, text: "No destination connection — the destination is only a template." }
];

const OAUTH_STEPS = [
    "Click Connect QuickBooks (or Reconnect).",
    "Sign in to Intuit and choose the company you want to export from.",
    "Approve read-only access, then you return here automatically."
];

const Connect = () => {

    const { connection, companyInfo, refreshConnection, loadCompanyInfo, disconnect, pushToast } = useApp();
    const [disconnecting, setDisconnecting] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const handleDisconnect = async () => {
        setDisconnecting(true);
        await disconnect();
        setDisconnecting(false);
        setConfirmOpen(false);
        pushToast("Disconnected from QuickBooks.", "info");
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        await loadCompanyInfo();
        setRefreshing(false);
    };

    const goConnect = () => { window.location.href = AUTH_LOGIN_URL; };

    const fade = (delay = 0) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25, delay, ease: "easeOut" } });

    return (
        <div>

            <PageHeader title="Connection" description="Manage the source QuickBooks company this tool reads from." />

            <div className="grid gap-4 lg:grid-cols-[1fr_22rem] items-start">

                <motion.div {...fade(0)}>
                    <Card className="p-6">

                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <IconTile icon={Plug} tone={connection.connected ? "teal" : "ink"} className="!w-12 !h-12" size={20} />
                                <div className="min-w-0">
                                    <p className="text-base font-semibold text-ink-900">QuickBooks Online</p>
                                    <p className="text-sm text-ink-500">
                                        {connection.loading ? "Checking connection…" : connection.connected ? "Source company connected" : "No company connected"}
                                    </p>
                                </div>
                            </div>
                            {connection.loading
                                ? <Loader2 size={18} className="animate-spin text-ink-400" />
                                : <Badge tone={connection.connected ? "success" : "neutral"}>{connection.connected ? "Connected" : "Disconnected"}</Badge>}
                        </div>

                        <div className="mt-5 pt-5 border-t border-ink-200">
                            {connection.loading ? (
                                <div className="space-y-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /></div>
                            ) : connection.connected ? (
                                <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                                    <div>
                                        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Company</dt>
                                        <dd className="font-medium text-ink-900 mt-1">{companyInfo?.companyName || "—"}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Detected country</dt>
                                        <dd className="font-medium text-ink-900 mt-1">{companyInfo?.country || "—"}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Access</dt>
                                        <dd className="font-medium text-ink-900 mt-1">Read-only</dd>
                                    </div>
                                    {connection.realmId && (
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Realm ID</dt>
                                            <dd className="font-medium text-ink-900 mt-1 tabular-nums">{connection.realmId}</dd>
                                        </div>
                                    )}
                                </dl>
                            ) : (
                                <p className="text-sm text-ink-500">Connect a QuickBooks Online company to start exporting. You will be sent to Intuit to sign in and approve read-only access.</p>
                            )}
                        </div>

                        <div className="mt-6 flex flex-wrap gap-3">
                            {connection.connected ? (
                                <>
                                    <Button variant="outline" onClick={goConnect}>
                                        <Plug size={15} /> Reconnect
                                    </Button>
                                    <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
                                        <RefreshCcw size={15} className={refreshing ? "animate-spin" : ""} /> Refresh company info
                                    </Button>
                                    <Button variant="danger" onClick={() => setConfirmOpen(true)} disabled={disconnecting}>
                                        <LogOut size={15} /> Disconnect
                                    </Button>
                                </>
                            ) : (
                                <Button variant="accent" onClick={goConnect} disabled={connection.loading}>
                                    <Plug size={15} /> Connect QuickBooks
                                </Button>
                            )}
                            <Button variant="ghost" onClick={refreshConnection}>
                                Recheck status
                            </Button>
                        </div>

                    </Card>
                </motion.div>

                <motion.div {...fade(0.05)} className="space-y-4">
                    <Card className="p-6">
                        <SectionLabel>How connecting works</SectionLabel>
                        <ol className="mt-4 space-y-3">
                            {OAUTH_STEPS.map((step, i) => (
                                <li key={step} className="flex items-start gap-3">
                                    <span className="w-6 h-6 rounded-full bg-teal-100 text-teal-700 text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                                    <p className="text-sm text-ink-700 pt-0.5">{step}</p>
                                </li>
                            ))}
                        </ol>
                    </Card>
                    <Card className="p-6 bg-teal-50 border-teal-100">
                        <SectionLabel icon={ShieldCheck}>Why this is safe</SectionLabel>
                        <div className="mt-4 space-y-3">
                            {TRUST_POINTS.map((point) => (
                                <div key={point.text} className="flex items-start gap-3">
                                    <point.icon size={16} className="text-teal-700 mt-0.5 shrink-0" />
                                    <p className="text-sm text-ink-700">{point.text}</p>
                                </div>
                            ))}
                        </div>
                    </Card>
                </motion.div>

            </div>

            <ConfirmDialog
                open={confirmOpen}
                title="Disconnect QuickBooks?"
                description="You will need to reconnect before you can export again. Nothing is changed in QuickBooks."
                confirmLabel="Disconnect"
                busy={disconnecting}
                onConfirm={handleDisconnect}
                onCancel={() => setConfirmOpen(false)}
            />

        </div>
    );

};

export default Connect;
