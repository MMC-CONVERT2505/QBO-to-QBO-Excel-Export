import { useState } from "react";
import { useLocation, Outlet } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import Sidebar from "./Sidebar.jsx";
import Header from "./Header.jsx";
import Toasts from "./Toasts.jsx";

const AppLayout = () => {

    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const location = useLocation();

    return (
        <div className="min-h-screen flex bg-ink-50">
            <Sidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

            <div className="flex-1 flex flex-col min-w-0">
                <Header onMenuClick={() => setMobileNavOpen(true)} />

                <main className="flex-1 px-5 md:px-8 py-6 md:py-8 overflow-y-auto">
                    <div className="mx-auto w-full max-w-6xl">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={location.pathname}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.25, ease: "easeOut" }}
                        >
                            <Outlet />
                        </motion.div>
                    </AnimatePresence>
                    </div>
                </main>
            </div>

            <Toasts />
        </div>
    );

};

export default AppLayout;
