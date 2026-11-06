import { useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { Menu, Building2 } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";

const PAGE_TITLES = {
    "/dashboard": { title: "Dashboard", subtitle: "Your connected source company and export setup." },
    "/export": { title: "Export", subtitle: "Fetch, map and download your data for a destination region." },
    "/tax-mapping": { title: "Tax Mapping", subtitle: "Map source tax codes to the destination company." },
    "/connect": { title: "Connection", subtitle: "Manage the source QuickBooks company this tool reads from." }
};

const Header = ({ onMenuClick }) => {

    const location = useLocation();
    const { connection, companyInfo, loadCompanyInfo } = useApp();

    // Make the company chip available on every page, not only the dashboard.
    useEffect(() => {
        if (connection.connected && !companyInfo) loadCompanyInfo();
    }, [connection.connected]); // eslint-disable-line react-hooks/exhaustive-deps
    const page = PAGE_TITLES[location.pathname] || { title: "", subtitle: "" };

    const status = connection.loading
        ? { dot: "bg-ink-300", label: "Checking…", chip: "bg-white border-ink-200 text-ink-600" }
        : connection.connected
        ? { dot: "bg-green-600", label: "Connected", chip: "bg-teal-50 border-teal-100 text-teal-700" }
        : { dot: "bg-rose-600", label: "Not connected", chip: "bg-rose-50 border-rose-100 text-rose-700" };

    return (
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-ink-200 px-5 md:px-8 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
                <button onClick={onMenuClick} className="md:hidden text-ink-500 hover:text-ink-900 shrink-0" aria-label="Open menu">
                    <Menu size={20} />
                </button>
                <div className="min-w-0">
                    <p className="text-base font-semibold text-ink-900 leading-tight truncate">{page.title}</p>
                    {page.subtitle && <p className="text-xs text-ink-500 leading-tight hidden sm:block truncate">{page.subtitle}</p>}
                </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
                {connection.connected && companyInfo?.companyName && (
                    <Link to="/connect" className="hidden sm:flex items-center gap-2 rounded-full bg-white border border-ink-200 hover:border-ink-300 transition-colors pl-2.5 pr-3.5 py-1.5">
                        <Building2 size={13} className="text-ink-400" />
                        <span className="text-xs font-medium text-ink-700 max-w-[11rem] truncate">{companyInfo.companyName}</span>
                    </Link>
                )}
                <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${status.chip}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                    <span className="text-xs font-medium">{status.label}</span>
                </div>
            </div>
        </header>
    );

};

export default Header;
