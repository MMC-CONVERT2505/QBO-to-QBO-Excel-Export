import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppProvider } from "./context/AppContext.jsx";
import AppLayout from "./components/AppLayout.jsx";
import Landing from "./pages/Landing.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Connect from "./pages/Connect.jsx";
import ExportFlow from "./pages/ExportFlow.jsx";
import TaxMapping from "./pages/TaxMapping.jsx";

const App = () => (
    <AppProvider>
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Landing />} />
                <Route element={<AppLayout />}>
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/connect" element={<Connect />} />
                    <Route path="/export" element={<ExportFlow />} />
                    <Route path="/tax-mapping" element={<TaxMapping />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    </AppProvider>
);

export default App;
