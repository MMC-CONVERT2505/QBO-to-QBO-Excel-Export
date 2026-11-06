import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Building2, MapPin, ArrowRight, Plug, ChevronRight, ShieldCheck } from "lucide-react";
import * as Icons from "lucide-react";
import api, { getErrorMessage, AUTH_LOGIN_URL } from "../api/client.js";
import { Card, Button, Badge, EmptyState, Skeleton, SectionLabel, PageHeader, IconTile } from "../components/ui.jsx";
import { useApp } from "../context/AppContext.jsx";
import { MODULE_META } from "../constants/display.js";

const Dashboard = () => {

    const navigate = useNavigate();
    const { connection, companyInfo, loadCompanyInfo, pushToast } = useApp();
    const [regions, setRegions] = useState([]);
    const [loadingInfo, setLoadingInfo] = useState(true);

    useEffect(() => {

        if (!connection.connected) {
            setLoadingInfo(false);
            return;
        }

        (async () => {
            setLoadingInfo(true);
            await loadCompanyInfo();
            try {
                const { data } = await api.get("/api/regions");
                setRegions(data.regions);
            } catch (error) {
                pushToast(getErrorMessage(error), "error");
            }
            setLoadingInfo(false);
        })();

    }, [connection.connected]); // eslint-disable-line react-hooks/exhaustive-deps

    if (connection.loading || loadingInfo) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-48" />
                <div className="grid md:grid-cols-3 gap-4">
                    <Skeleton className="h-24 rounded-xl" />
                    <Skeleton className="h-24 rounded-xl" />
                    <Skeleton className="h-24 rounded-xl" />
                </div>
                <Skeleton className="h-24 rounded-xl" />
                <Skeleton className="h-40 rounded-xl" />
            </div>
        );
    }

    if (!connection.connected) {
        return (
            <Card>
                <EmptyState
                    icon={Plug}
                    title="No source QuickBooks company connected"
                    description="Connect a source QBO company to see it here and start an export to any destination region."
                    action={
                        <Button variant="accent" onClick={() => { window.location.href = AUTH_LOGIN_URL; }}>
                            Connect QuickBooks
                        </Button>
                    }
                />
            </Card>
        );
    }

    const detectedRegion = regions.find((r) => r.code === companyInfo?.detectedRegion);
    const fade = (delay = 0) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25, delay, ease: "easeOut" } });

    return (
        <div>

            <PageHeader
                title="Welcome back"
                description="Review your connected company, then choose a destination region to export to."
            />

            <div className="grid md:grid-cols-3 gap-4">

                <motion.div {...fade(0)}>
                    <Card className="p-5 h-full">
                        <div className="flex items-start gap-3">
                            <IconTile icon={Building2} tone="teal" />
                            <div className="min-w-0">
                                <SectionLabel>Source company</SectionLabel>
                                <p className="text-base font-semibold text-ink-900 mt-1 truncate">{companyInfo?.companyName || "—"}</p>
                                <p className="text-sm text-ink-500 mt-0.5 truncate">{companyInfo?.legalName || "QuickBooks Online"}</p>
                            </div>
                        </div>
                    </Card>
                </motion.div>

                <motion.div {...fade(0.04)}>
                    <Card className="p-5 h-full">
                        <div className="flex items-start gap-3">
                            <IconTile icon={MapPin} tone="teal" />
                            <div className="min-w-0">
                                <SectionLabel>Source region</SectionLabel>
                                <p className="text-base font-semibold text-ink-900 mt-1 flex items-center gap-2">
                                    {detectedRegion && <Badge tone="info">{detectedRegion.code}</Badge>}
                                    {detectedRegion?.label || companyInfo?.country || "Not detected"}
                                </p>
                                <p className="text-sm text-ink-500 mt-0.5">
                                    {detectedRegion ? "Detected from company country" : "Country reported by QuickBooks: " + (companyInfo?.country || "unknown")}
                                </p>
                            </div>
                        </div>
                    </Card>
                </motion.div>

                <motion.div {...fade(0.08)}>
                    <Card className="p-5 h-full">
                        <div className="flex items-start gap-3">
                            <IconTile icon={ShieldCheck} tone="teal" />
                            <div className="min-w-0">
                                <SectionLabel>Access mode</SectionLabel>
                                <p className="text-base font-semibold text-ink-900 mt-1">Read-only</p>
                                <p className="text-sm text-ink-500 mt-0.5">Nothing is written back to QuickBooks.</p>
                            </div>
                        </div>
                    </Card>
                </motion.div>

            </div>

            <motion.div {...fade(0.12)}>
                <Card className="mt-4 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 !bg-ink-900 border-none shadow-lift">
                    <div>
                        <p className="text-lg font-semibold text-white">Ready to export</p>
                        <p className="text-sm text-ink-300 mt-1">Pick a destination region and the accounting data to include.</p>
                    </div>
                    <Button variant="accent" className="px-5 shrink-0" onClick={() => navigate("/export")}>
                        Start export <ArrowRight size={16} />
                    </Button>
                </Card>
            </motion.div>

            <motion.div {...fade(0.16)}>
                <div className="mt-8 mb-3 flex items-center justify-between">
                    <p className="text-base font-semibold text-ink-900">Available destination regions</p>
                    <span className="text-xs text-ink-500">{regions.length} region{regions.length === 1 ? "" : "s"}</span>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {regions.map((region) => (
                        <Card
                            key={region.code}
                            hover
                            className="p-4 cursor-pointer group"
                            onClick={() => navigate("/export")}
                        >
                            <div className="flex items-center justify-between">
                                <Badge tone="info">{region.code}</Badge>
                                <span className="text-xs font-medium text-ink-500">{region.currency}</span>
                            </div>
                            <p className="font-semibold text-sm text-ink-900 mt-3">{region.label}</p>
                            <div className="flex items-center justify-between mt-1.5">
                                <p className="text-xs text-ink-500 flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-teal-600" />
                                    {region.availableModules.length} modules ready
                                </p>
                                <ChevronRight size={15} className="text-ink-300 group-hover:text-teal-600 group-hover:translate-x-0.5 transition-all" />
                            </div>
                            <div className="flex gap-1 mt-3">
                                {region.availableModules.slice(0, 6).map((key) => {
                                    const Icon = Icons[MODULE_META[key]?.icon] || Icons.FileQuestion;
                                    return (
                                        <span key={key} className="w-6 h-6 rounded-md bg-ink-100 text-ink-500 flex items-center justify-center">
                                            <Icon size={12} />
                                        </span>
                                    );
                                })}
                            </div>
                        </Card>
                    ))}
                </div>
            </motion.div>

        </div>
    );

};

export default Dashboard;
