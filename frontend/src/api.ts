import { http } from "./lib/apiClient";

export function headers(): Record<string, string> {
  const token = localStorage.getItem("or:authToken");
  const device = localStorage.getItem("or:deviceToken");
  const h: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (device) h["X-Device-Token"] = device;
  const role = localStorage.getItem("or:staffRole") ?? "stylist";
  if (
    (role === "owner" ||
      role === "super_admin" ||
      role === "admin" ||
      role === "manager") &&
    localStorage.getItem("or:viewAllTargets") === "true"
  ) {
    h["X-Owner-View-Targets"] = "1";
  }
  return h;
}

export async function apiGet<T>(path: string): Promise<T> {
  const r = await http.get<T>(path);
  return r.data;
}

export async function apiPost<T>(path: string, body: unknown, opts?: { signal?: AbortSignal }): Promise<T> {
  const r = await http.post<T>(path, body, { signal: opts?.signal });
  return r.data;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const r = await http.patch<T>(path, body);
  return r.data;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const r = await http.put<T>(path, body);
  return r.data;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const r = await http.delete<T>(path);
  return r.data;
}
