import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";

const TONE_STYLES = {
    success: { icon: CheckCircle2, classes: "bg-green-700 text-white" },
    error: { icon: XCircle, classes: "bg-rose-700 text-white" },
    info: { icon: Info, classes: "bg-ink-900 text-white" }
};

const Toasts = () => {

    const { toasts, dismissToast } = useApp();

    return (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
            <AnimatePresence>
                {toasts.map((toast) => {
                    const { icon: Icon, classes } = TONE_STYLES[toast.tone] || TONE_STYLES.info;
                    return (
                        <motion.div
                            key={toast.id}
                            initial={{ opacity: 0, y: -10, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, x: 40, transition: { duration: 0.15 } }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className={`flex items-start gap-2.5 rounded-xl px-4 py-3 shadow-lift ${classes}`}
                        >
                            <Icon size={18} className="mt-0.5 shrink-0" />
                            <p className="text-sm leading-snug flex-1">{toast.message}</p>
                            <button onClick={() => dismissToast(toast.id)} className="opacity-70 hover:opacity-100">
                                <X size={16} />
                            </button>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );

};

export default Toasts;
