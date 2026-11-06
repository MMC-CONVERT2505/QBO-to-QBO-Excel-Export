import { motion } from "framer-motion";
import { Check } from "lucide-react";

// `region` is the object the backend returns from /api/regions:
// { code, label, currency, availableModules, ... } - nothing here
// invents or overrides that data, it only decorates it.
const RegionCard = ({ region, selected = false, onClick, disabled = false }) => (
    <motion.button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected}
        whileHover={disabled ? undefined : { y: -2 }}
        whileTap={disabled ? undefined : { scale: 0.98 }}
        transition={{ duration: 0.15 }}
        className={`relative text-left rounded-xl border p-4 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
            disabled
                ? "opacity-40 cursor-not-allowed border-ink-200 bg-ink-50"
                : selected
                ? "border-teal-600 bg-teal-50 shadow-glow"
                : "border-ink-200 bg-white hover:border-ink-300 hover:shadow-soft"
        }`}
    >
        {selected && (
            <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.2 }}
                className="absolute top-3 right-3 w-5 h-5 rounded-full bg-teal-600 text-white flex items-center justify-center"
            >
                <Check size={12} strokeWidth={3} />
            </motion.span>
        )}
        <span className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-bold tracking-wide ${selected ? "bg-teal-100 text-teal-700" : "bg-ink-100 text-ink-600"}`}>
            {region.code}
        </span>
        <p className="mt-2.5 font-semibold text-sm text-ink-900">{region.label}</p>
        <p className="text-xs text-ink-500 mt-0.5">{region.currency}</p>
        <p className="text-xs text-ink-500 mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-600" />
            {region.availableModules.length} modules ready
        </p>
    </motion.button>
);

export default RegionCard;
