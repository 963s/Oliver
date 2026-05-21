import { createConnection } from "node:net";

/** Fast TCP handshake test (printer / EC terminal on LAN). Returns true iff connect succeeds. */
export function tcpReachableProbe(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const sock = createConnection({ host, port: Math.floor(port), family: 0 });
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    const t = setTimeout(() => finish(false), Math.max(200, timeoutMs));
    sock.on("connect", () => finish(true));
    sock.on("error", () => finish(false));
  });
}
