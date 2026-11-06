import { Check } from "lucide-react";

// `phase` is the ExportFlow page's own state machine value
// (setup | reviewing | exporting | done | error) - this component
// only visualizes it, it never drives the logic.
const PHASE_ORDER = ["setup", "reviewing", "exporting", "done"];

const WIZARD_LABELS = [
    { key: "setup", label: "Destination & data" },
    { key: "reviewing", label: "Mapping & validation" },
    { key: "exporting", label: "Generate Excel" },
    { key: "done", label: "Download" }
];

const WizardSteps = ({ phase }) => {

    const activeIndex = phase === "error"
        ? PHASE_ORDER.indexOf("exporting")
        : PHASE_ORDER.indexOf(phase);

    return (
        <ol className="flex items-start w-full" aria-label="Export progress">
            {WIZARD_LABELS.map((step, i) => {

                const isDone = i < activeIndex || phase === "done";
                const isActive = i === activeIndex && phase !== "done";
                const isError = isActive && phase === "error";
                const isLast = i === WIZARD_LABELS.length - 1;

                return (
                    <li key={step.key} className={`flex items-start ${isLast ? "" : "flex-1"}`} aria-current={isActive ? "step" : undefined}>
                        <div className="flex flex-col items-center gap-2 shrink-0 w-24 sm:w-32">
                            <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors duration-300 ${
                                    isDone
                                        ? "bg-teal-600 text-white"
                                        : isError
                                        ? "bg-rose-600 text-white"
                                        : isActive
                                        ? "bg-ink-900 text-white"
                                        : "bg-ink-100 text-ink-400"
                                }`}
                            >
                                {isDone ? <Check size={15} strokeWidth={3} /> : i + 1}
                            </div>
                            <span className={`text-xs font-medium text-center leading-tight ${isActive || isDone ? "text-ink-900" : "text-ink-400"}`}>
                                {step.label}
                            </span>
                        </div>
                        {!isLast && (
                            <div className="flex-1 h-0.5 mt-[15px] -mx-8 sm:-mx-12 bg-ink-200 relative overflow-hidden rounded-full">
                                <div
                                    className="absolute inset-y-0 left-0 bg-teal-600 transition-[width] duration-300 ease-in-out"
                                    style={{ width: isDone ? "100%" : "0%" }}
                                />
                            </div>
                        )}
                    </li>
                );

            })}
        </ol>
    );

};

export default WizardSteps;
