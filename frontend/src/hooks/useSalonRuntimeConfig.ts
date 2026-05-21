import { useEffect, useState } from "react";
import { apiGet } from "../api";

export type Client360FeatureFlags = {
  patchTest: boolean;
  privacyToggle: boolean;
  hospitality: boolean;
  loyaltyBadge: boolean;
  anonymizeButton: boolean;
};

const DEFAULT_FLAGS: Client360FeatureFlags = {
  patchTest: true,
  privacyToggle: true,
  hospitality: true,
  loyaltyBadge: true,
  anonymizeButton: true,
};

export function useSalonRuntimeConfig(): {
  sanitizationBufferMs: number;
  client360Features: Client360FeatureFlags;
  loading: boolean;
} {
  const [sanitizationBufferMs, setMs] = useState(15 * 60 * 1000);
  const [client360Features, setFeats] = useState<Client360FeatureFlags>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await apiGet<{
          sanitizationBufferMs?: number;
          client360Features?: Partial<Client360FeatureFlags>;
        }>("/api/system/runtime-config");
        if (cancelled) return;
        if (typeof r.sanitizationBufferMs === "number" && r.sanitizationBufferMs >= 0) {
          setMs(r.sanitizationBufferMs);
        }
        if (r.client360Features && typeof r.client360Features === "object") {
          setFeats({
            patchTest: r.client360Features.patchTest !== false,
            privacyToggle: r.client360Features.privacyToggle !== false,
            hospitality: r.client360Features.hospitality !== false,
            loyaltyBadge: r.client360Features.loyaltyBadge !== false,
            anonymizeButton: r.client360Features.anonymizeButton !== false,
          });
        }
      } catch {
        if (!cancelled) setFeats(DEFAULT_FLAGS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { sanitizationBufferMs, client360Features, loading };
}
