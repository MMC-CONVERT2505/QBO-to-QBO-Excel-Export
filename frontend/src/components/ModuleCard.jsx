import * as Icons from "lucide-react";
import { MODULE_META } from "../constants/display.js";
import { Checkbox } from "./ui.jsx";

// `moduleKey` is one of the backend's entity keys (account/customer/...).
// `supported` reflects whether the currently selected region has a
// template for it - the same data the old checkbox list used.
const ModuleCard = ({ moduleKey, checked, supported, onToggle }) => {

    const meta = MODULE_META[moduleKey] || { label: moduleKey, icon: "FileQuestion" };
    const Icon = Icons[meta.icon] || Icons.FileQuestion;

    return (
        <label
            title={!supported ? "Not available for the selected region" : undefined}
            className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition-all duration-150 ${
                !supported
                    ? "opacity-40 cursor-not-allowed border-ink-200 bg-ink-50"
                    : checked
                    ? "border-teal-600 bg-teal-50 cursor-pointer"
                    : "border-ink-200 bg-white hover:border-ink-300 hover:shadow-card cursor-pointer"
            }`}
        >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-150 ${checked && supported ? "bg-teal-600 text-white" : "bg-ink-100 text-ink-500"}`}>
                <Icon size={16} />
            </div>
            <span className={`flex-1 leading-snug ${checked && supported ? "font-semibold text-ink-900" : "font-medium text-ink-800"}`}>{meta.label}</span>
            <input
                type="checkbox"
                disabled={!supported}
                checked={checked}
                onChange={() => onToggle(moduleKey)}
                className="sr-only peer"
            />
            <Checkbox checked={checked && supported} disabled={!supported} />
        </label>
    );

};

export default ModuleCard;
