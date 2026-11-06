// Small shared UI primitives kept in one file to avoid a sprawl of
// near-identical single-component files for things this simple.

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Check } from "lucide-react";

export const Card = ({ children, className = "", hover = false, ...props }) => (
    <div
        className={`bg-white border border-ink-200 rounded-xl shadow-card ${
            hover ? "transition-all duration-200 hover:shadow-soft hover:-translate-y-0.5" : ""
        } ${className}`}
        {...props}
    >
        {children}
    </div>
);

export const Button = ({ children, variant = "primary", className = "", ...props }) => {

    const variants = {
        primary: "bg-ink-900 text-white hover:bg-ink-800 disabled:bg-ink-200 disabled:text-ink-400",
        accent: "bg-teal-600 text-white hover:bg-teal-700 disabled:bg-ink-200 disabled:text-ink-400",
        danger: "border border-rose-100 bg-white text-rose-600 hover:bg-rose-50 disabled:text-ink-300",
        outline: "border border-ink-300 bg-white text-ink-800 hover:bg-ink-100 disabled:text-ink-300 disabled:border-ink-200",
        ghost: "text-ink-600 hover:bg-ink-100 disabled:text-ink-300"
    };

    return (
        <motion.button
            whileTap={props.disabled ? undefined : { scale: 0.98 }}
            transition={{ duration: 0.1 }}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 ${variants[variant]} ${className}`}
            {...props}
        >
            {children}
        </motion.button>
    );

};

export const Badge = ({ tone = "neutral", children }) => {

    const tones = {
        neutral: "bg-ink-100 text-ink-600",
        success: "bg-green-100 text-green-700",
        warning: "bg-amber-100 text-amber-700",
        error: "bg-rose-100 text-rose-700",
        info: "bg-teal-100 text-teal-700",
        accent: "bg-indigo-100 text-indigo-700"
    };

    return (
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
            {children}
        </span>
    );

};

export const Spinner = ({ className = "" }) => (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
        <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
);

export const EmptyState = ({ icon: Icon, title, description, action }) => (
    <div className="flex flex-col items-center text-center py-14 px-6">
        {Icon && (
            <div className="w-12 h-12 rounded-full bg-ink-100 flex items-center justify-center mb-4">
                <Icon size={22} className="text-ink-500" />
            </div>
        )}
        <p className="text-base font-semibold text-ink-900">{title}</p>
        {description && <p className="text-sm text-ink-500 mt-1.5 max-w-sm">{description}</p>}
        {action && <div className="mt-5">{action}</div>}
    </div>
);

// Small uppercase eyebrow label used above section/card headings.
export const SectionLabel = ({ icon: Icon, children }) => (
    <div className="flex items-center gap-2 text-ink-400 text-xs font-semibold tracking-wide uppercase">
        {Icon && <Icon size={13} />}
        {children}
    </div>
);

// Rounded icon swatch used throughout dashboard/module/region cards.
export const IconTile = ({ icon: Icon, tone = "ink", size = 18, className = "" }) => {

    const tones = {
        ink: "bg-ink-100 text-ink-500",
        teal: "bg-teal-100 text-teal-700",
        indigo: "bg-indigo-100 text-indigo-700",
        amber: "bg-amber-100 text-amber-700",
        rose: "bg-rose-100 text-rose-700"
    };

    return (
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tones[tone]} ${className}`}>
            <Icon size={size} />
        </div>
    );

};

// Grey pulsing placeholder block for loading states.
export const Skeleton = ({ className = "" }) => (
    <div className={`shimmer-bg rounded-md ${className}`} />
);

// Page title block used at the top of every page (replaces ad-hoc headings).
export const PageHeader = ({ title, description, actions }) => (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-ink-900 leading-8">{title}</h1>
            {description && <p className="text-sm text-ink-500 mt-1 max-w-2xl">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
);

// Small summary tile: label + big number. tone colours the number.
export const StatTile = ({ label, value, tone = "ink", hint }) => {
    const tones = { ink: "text-ink-900", success: "text-green-600", warning: "text-amber-600", error: "text-rose-600", info: "text-teal-600" };
    return (
        <div className="bg-white border border-ink-200 rounded-xl px-4 py-3 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
            <p className={`text-2xl font-semibold mt-1 tabular-nums ${tones[tone]}`}>{value}</p>
            {hint && <p className="text-xs text-ink-400 mt-0.5">{hint}</p>}
        </div>
    );
};

// Determinate bar when `value` (0-100) is given, shimmering indeterminate bar otherwise.
export const ProgressBar = ({ value, className = "" }) => (
    <div className={`h-2 rounded-full bg-ink-200 overflow-hidden ${className}`} role="progressbar" aria-valuenow={typeof value === "number" ? Math.round(value) : undefined}>
        {typeof value === "number" ? (
            <motion.div className="h-full rounded-full bg-teal-600" initial={false} animate={{ width: `${Math.max(0, Math.min(100, value))}%` }} transition={{ duration: 0.3, ease: "easeOut" }} />
        ) : (
            <div className="h-full w-full shimmer-bg" style={{ backgroundImage: "linear-gradient(90deg, #DDF4F1 25%, #0F8B8D 50%, #DDF4F1 75%)", backgroundSize: "200% 100%" }} />
        )}
    </div>
);

export const SearchInput = ({ value, onChange, placeholder = "Search", className = "" }) => (
    <div className={`relative ${className}`}>
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-lg border border-ink-300 bg-white pl-9 pr-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        />
    </div>
);

// Overlay dialog with fade + scale entrance. Closes on Escape and backdrop click.
export const Modal = ({ open, onClose, children, className = "max-w-md" }) => {
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-50 bg-ink-900/40 flex items-center justify-center p-4"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                    onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
                >
                    <motion.div
                        role="dialog" aria-modal="true"
                        className={`w-full bg-white rounded-2xl border border-ink-200 shadow-lift ${className}`}
                        initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.18, ease: "easeOut" }}
                    >
                        {children}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export const ConfirmDialog = ({ open, title, description, confirmLabel = "Confirm", tone = "danger", busy = false, onConfirm, onCancel }) => (
    <Modal open={open} onClose={onCancel}>
        <div className="p-6">
            <p className="text-base font-semibold text-ink-900">{title}</p>
            {description && <p className="text-sm text-ink-500 mt-1.5">{description}</p>}
            <div className="mt-6 flex justify-end gap-2">
                <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
                <Button variant={tone === "danger" ? "danger" : "accent"} onClick={onConfirm} disabled={busy}>
                    {busy && <Spinner className="w-4 h-4" />}{confirmLabel}
                </Button>
            </div>
        </div>
    </Modal>
);

// Success checkmark that scales in and draws its tick.
export const SuccessMark = ({ size = 64 }) => (
    <motion.div
        initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3, ease: "easeOut" }}
        className="rounded-full bg-green-100 flex items-center justify-center mx-auto"
        style={{ width: size, height: size }}
    >
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path className="animate-draw-check" d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
    </motion.div>
);

export const Checkbox = ({ checked, disabled }) => (
    <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border transition-colors duration-150 ${
        checked ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-ink-300"
    } ${disabled ? "opacity-50" : ""}`}>
        {checked && <Check size={13} strokeWidth={3} />}
    </span>
);
