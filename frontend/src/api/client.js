import axios from "axios";

// When the app is opened through a public address (ngrok), always use same-origin
// URLs so login, cookies and the OAuth callback all share one host.
const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_BASE_URL = isLocalHost
    ? (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:7004")
    : "";

export const api = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true
});

export const getErrorMessage = (error) => {
    if (error.response?.data?.message) return error.response.data.message;
    if (error.request) return "Could not reach the server. Is the backend running?";
    return error.message || "Something went wrong.";
};

export const AUTH_LOGIN_URL = `${API_BASE_URL}/api/auth/login`;

export default api;
