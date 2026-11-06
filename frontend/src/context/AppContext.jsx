import { createContext, useCallback, useContext, useEffect, useState } from "react";
import api, { getErrorMessage } from "../api/client.js";

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {

    const [connection, setConnection] = useState({ loading: true, connected: false, realmId: null });
    const [companyInfo, setCompanyInfo] = useState(null);
    const [toasts, setToasts] = useState([]);

    const pushToast = useCallback((message, tone = "info") => {
        const id = crypto.randomUUID();
        setToasts((prev) => [...prev, { id, message, tone }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 4500);
    }, []);

    const dismissToast = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const refreshConnection = useCallback(async () => {
        try {
            const { data } = await api.get("/api/auth/status");
            setConnection({ loading: false, connected: data.connected, realmId: data.realmId || null });
            return data.connected;
        } catch (error) {
            setConnection({ loading: false, connected: false, realmId: null });
            return false;
        }
    }, []);

    const loadCompanyInfo = useCallback(async () => {
        try {
            const { data } = await api.get("/api/qbo/company-info");
            setCompanyInfo(data);
            return data;
        } catch (error) {
            pushToast(getErrorMessage(error), "error");
            return null;
        }
    }, [pushToast]);

    const disconnect = useCallback(async () => {
        try {
            await api.post("/api/auth/logout");
        } catch {
            // logout is best-effort locally regardless
        }
        setConnection({ loading: false, connected: false, realmId: null });
        setCompanyInfo(null);
    }, []);

    useEffect(() => {
        refreshConnection();
    }, [refreshConnection]);

    return (
        <AppContext.Provider
            value={{
                connection,
                companyInfo,
                refreshConnection,
                loadCompanyInfo,
                disconnect,
                toasts,
                pushToast,
                dismissToast
            }}
        >
            {children}
        </AppContext.Provider>
    );

};

export const useApp = () => {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error("useApp must be used within AppProvider");
    return ctx;
};
