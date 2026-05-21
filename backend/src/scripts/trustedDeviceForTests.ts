/**
 * Pair a trusted POS device via HTTP (bootstrap scripts only — same flow as production pairing UI).
 */

export async function fetchTrustedDeviceToken(
  baseUrl: string,
  staffId: number,
  pin: string,
): Promise<string> {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ staffId, pin }),
  });
  if (!loginRes.ok) {
    throw new Error(`trustedDevice bootstrap login failed: ${loginRes.status}`);
  }
  const { token } = (await loginRes.json()) as { token: string };

  const ptRes = await fetch(`${baseUrl}/api/auth/devices/pairing-token`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  if (!ptRes.ok) {
    throw new Error(`pairing-token failed: ${ptRes.status}`);
  }
  const { pairingToken } = (await ptRes.json()) as { pairingToken: string };

  const pairRes = await fetch(`${baseUrl}/api/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingToken,
      deviceName: `stress-${Date.now()}`,
    }),
  });
  if (!pairRes.ok) {
    throw new Error(`pair failed: ${pairRes.status}`);
  }
  const { deviceToken } = (await pairRes.json()) as { deviceToken: string };
  return deviceToken;
}
