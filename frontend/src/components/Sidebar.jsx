import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutDashboard, FileSpreadsheet, Percent, Plug, ShieldCheck, X, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";

const NAV = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/export", label: "Export", icon: FileSpreadsheet },
    { to: "/tax-mapping", label: "Tax Mapping", icon: Percent },
    { to: "/connect", label: "Connection", icon: Plug }
];

const NavItems = ({ collapsed }) => (
    <nav className={`flex-1 space-y-1 ${collapsed ? "px-3" : "px-3"}`}>
        {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
                key={to}
                to={to}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                    `relative flex items-center gap-3 rounded-lg h-10 text-sm font-medium transition-colors duration-150 ${
                        collapsed ? "justify-center px-0" : "px-3"
                    } ${isActive ? "text-white" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"}`
                }
            >
                {({ isActive }) => (
                    <>
                        {isActive && (
                            <motion.span
                                layoutId="sidebar-active"
                                className="absolute inset-0 rounded-lg bg-ink-900"
                                transition={{ duration: 0.2, ease: "easeOut" }}
                            />
                        )}
                        <Icon size={18} className="shrink-0 relative" />
                        {!collapsed && <span className="truncate relative">{label}</span>}
                    </>
                )}
            </NavLink>
        ))}
    </nav>
);

const SidebarBody = ({ onNavigate, collapsed = false, onToggle }) => {

    const { connection } = useApp();

    return (
        <>
            <div className={`flex items-center gap-2.5 py-5 ${collapsed ? "justify-center px-3" : "px-5"}`}>
                <img src="/ledger.svg" alt="" className="w-8 h-8 shrink-0" />
                {!collapsed && (
                    <div className="min-w-0">
                        <p className="text-sm font-bold text-ink-900 leading-tight">Ledger Bridge</p>
                        <p className="text-xs text-ink-500 leading-tight">QBO Regional Export</p>
                    </div>
                )}
            </div>

            <div onClick={onNavigate} className="flex-1 flex flex-col">
                <NavItems collapsed={collapsed} />
            </div>

            {!collapsed && (
                <div className="px-3 pb-3">
                    <div className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-3 text-xs text-ink-500 flex items-start gap-2">
                        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-teal-600" />
                        <span>Exports to a destination region's Excel template. Never writes to QuickBooks.</span>
                    </div>
                </div>
            )}

            <div className={`border-t border-ink-200 py-3.5 flex items-center ${collapsed ? "justify-center px-3" : "justify-between px-5"}`}>
                <div className="flex items-center gap-2 min-w-0" title={collapsed ? (connection.connected ? "QBO connected" : "Not connected") : undefined}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${connection.connected ? "bg-green-600" : "bg-ink-300"}`} />
                    {!collapsed && (
                        <span className="text-xs text-ink-500 truncate">
                            {connection.loading ? "Checking connection…" : connection.connected ? "QBO connected" : "Not connected"}
                        </span>
                    )}
                </div>
                {onToggle && !collapsed && (
                    <button onClick={onToggle} className="text-ink-400 hover:text-ink-700 transition-colors" aria-label="Collapse sidebar" title="Collapse sidebar">
                        <PanelLeftClose size={17} />
                    </button>
                )}
            </div>
            {onToggle && collapsed && (
                <button onClick={onToggle} className="mx-auto mb-4 text-ink-400 hover:text-ink-700 transition-colors" aria-label="Expand sidebar" title="Expand sidebar">
                    <PanelLeftOpen size={17} />
                </button>
            )}
        </>
    );

};

const STORAGE_KEY = "lb.sidebar.collapsed";

// Desktop: collapsible column (preference remembered in localStorage).
// Mobile: slide-over drawer controlled by `open`/`onClose`.
const Sidebar = ({ open = false, onClose = () => {} }) => {

    const [collapsed, setCollapsed] = useState(() => {
        try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
    });

    useEffect(() => {
        try { localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0"); } catch { /* storage unavailable */ }
    }, [collapsed]);

    return (
        <>
            <aside className={`hidden md:flex shrink-0 border-r border-ink-200 bg-white flex-col transition-[width] duration-200 ease-out ${collapsed ? "w-[72px]" : "w-60"}`}>
                <SidebarBody collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
            </aside>

            <AnimatePresence>
                {open && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={onClose}
                            className="md:hidden fixed inset-0 bg-ink-900/50 z-40"
                        />
                        <motion.aside
                            initial={{ x: "-100%" }}
                            animate={{ x: 0 }}
                            exit={{ x: "-100%" }}
                            transition={{ duration: 0.25, ease: "easeOut" }}
                            className="md:hidden fixed inset-y-0 left-0 w-72 bg-white z-50 flex flex-col shadow-lift"
                        >
                            <button onClick={onClose} className="absolute top-4 right-4 text-ink-400 hover:text-ink-700" aria-label="Close menu">
                                <X size={18} />
                            </button>
                            <SidebarBody onNavigate={onClose} />
                        </motion.aside>
                    </>
                )}
            </AnimatePresence>
        </>
    );
};

export default Sidebar;
