import axios from "axios";

const base = import.meta.env.VITE_API_BASE ?? "";

/**
 * Central HTTP client: injects `Authorization` and `X-Device-Token` from localStorage
 * (keys `or:authToken` / `or:deviceToken`). No business rules here.
 */
export const http = axios.create({
  baseURL: base,
  headers: { "Content-Type": "application/json" },
  validateStatus: (s) => s >= 200 && s < 300,
});

http.interceptors.request.use((config) => {
  const token = localStorage.getItem("or:authToken");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const device = localStorage.getItem("or:deviceToken");
  if (device) {
    config.headers["X-Device-Token"] = device;
  }
  const role = localStorage.getItem("or:staffRole") ?? "stylist";
  if (
    (role === "owner" || role === "super_admin") &&
    localStorage.getItem("or:viewAllTargets") === "true"
  ) {
    config.headers["X-Owner-View-Targets"] = "1";
  }
  return config;
});

http.interceptors.response.use(
  (r) => r,
  (err) => {
    const data = err.response?.data as { error?: string; message?: string } | undefined;
    const msg =
      (typeof data?.error === "string" && data.error) ||
      (typeof data?.message === "string" && data.message) ||
      err.message;
    return Promise.reject(new Error(msg || "request_failed"));
  },
);
