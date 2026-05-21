export type ZvtConfig = {
  terminalIp: string;
  terminalPort: number;
  autoPaymentLink: boolean;
};

export function isValidIpv4(value: string): boolean {
  const raw = value.trim();
  const parts = raw.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) && n >= 0 && n <= 255;
  });
}

export function parsePort(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return null;
  return n;
}

export function readZvtConfig(values: Record<string, string>): ZvtConfig | null {
  const terminalIp = String(values.payment_terminal_ip ?? "").trim();
  const terminalPort = parsePort(String(values.payment_terminal_port ?? ""));
  const autoPaymentLink = String(values.payment_auto_link ?? "0") === "1";
  if (!isValidIpv4(terminalIp) || terminalPort == null) return null;
  return { terminalIp, terminalPort, autoPaymentLink };
}

/**
 * Placeholder for real terminal handshakes (ZVT / OPI bridge).
 * Keeps checkout flow architecture-ready without side effects yet.
 */
export async function zvtConnectivityProbe(_cfg: ZvtConfig): Promise<{ ok: boolean; detail: string }> {
  return { ok: true, detail: "zvt_probe_placeholder_ok" };
}
