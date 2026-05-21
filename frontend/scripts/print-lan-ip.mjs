import os from "node:os";
import { execSync } from "node:child_process";

function fromInterfaces() {
  try {
    const ifaces = os.networkInterfaces();
    for (const rows of Object.values(ifaces)) {
      if (!rows) continue;
      for (const row of rows) {
        if (!row || row.family !== "IPv4" || row.internal) continue;
        if (
          row.address.startsWith("192.168.") ||
          row.address.startsWith("10.") ||
          row.address.startsWith("172.")
        ) {
          return row.address;
        }
      }
    }
  } catch {
    // ignore and fallback
  }
  return null;
}

function fromIpconfig() {
  const tryIf = (name) => {
    try {
      const out = execSync(`ipconfig getifaddr ${name}`, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
      return out || null;
    } catch {
      return null;
    }
  };
  return tryIf("en0") ?? tryIf("en1");
}

const ip = fromInterfaces() ?? fromIpconfig();
if (ip) {
  console.log(`[LAN] iPad URL: http://${ip}:5173`);
} else {
  console.log("[LAN] iPad URL: http://<your-mac-lan-ip>:5173");
}
