import { Check, Loader2, X } from "lucide-react";
import { motion } from "framer-motion";

// status per step: "pending" | "in_progress" | "done" | "error"
const Stepper = ({ steps }) => (
    <ol className="flex flex-col gap-0">
        {steps.map((step, index) => {

            const isLast = index === steps.length - 1;

            return (
                <motion.li
                    key={step.key}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05, duration: 0.25 }}
                    className="flex gap-3"
                >
                    <div className="flex flex-col items-center">
                        <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-colors duration-300 ${
                                step.status === "done"
                                    ? "bg-teal-600 text-white"
                                    : step.status === "in_progress"
                                    ? "bg-white border-2 border-teal-600 text-teal-600"
                                    : step.status === "error"
                                    ? "bg-rose-600 text-white"
                                    : "bg-ink-100 text-ink-400"
                            }`}
                        >
                            {step.status === "done" ? (
                                <Check size={15} strokeWidth={3} />
                            ) : step.status === "in_progress" ? (
                                <Loader2 size={15} className="animate-spin" />
                            ) : step.status === "error" ? (
                                <X size={15} strokeWidth={3} />
                            ) : (
                                index + 1
                            )}
                        </div>
                        {!isLast && (
                            <div className={`w-0.5 flex-1 min-h-[1.5rem] transition-colors duration-300 ${step.status === "done" ? "bg-teal-600" : "bg-ink-200"}`} />
                        )}
                    </div>
                    <div className="pb-6 flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-3">
                            <p className={`text-sm font-semibold ${step.status === "pending" ? "text-ink-400" : "text-ink-900"}`}>
                                {step.label}
                            </p>
                            {step.status === "in_progress" && <span className="text-xs font-medium text-teal-600">In progress</span>}
                            {step.status === "done" && <span className="text-xs font-medium text-green-600">Done</span>}
                            {step.status === "error" && <span className="text-xs font-medium text-rose-600">Failed</span>}
                        </div>
                        {step.description && <p className="text-xs text-ink-500 mt-0.5">{step.description}</p>}
                    </div>
                </motion.li>
            );

        })}
    </ol>
);

export default Stepper;
