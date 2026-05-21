/**
 * useFeatureFlags — reads feature flags from /api/settings/feature-flags.
 * Provides a `fiscalActive` boolean and the raw flags object.
 * Cached for the session; re-fetches when `refresh()` is called.
 */
import { useEffect, useState, useCallback } from "react";
import { apiGet } from "../api";

type Flags = Record<string, boolean>;

let cachedFlags: Flags | null = null;

export function useFeatureFlags(): {
  flags: Flags;
  fiscalActive: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [flags, setFlags] = useState<Flags>(cachedFlags ?? {});
  const [loading, setLoading] = useState(cachedFlags == null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<Flags>("/api/settings/feature-flags");
      cachedFlags = data;
      setFlags(data);
    } catch {
      // silently keep previous flags
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cachedFlags == null) {
      void refresh();
    }
  }, [refresh]);

  return {
    flags,
    fiscalActive: flags["fiscal_active"] === true,
    loading,
    refresh,
  };
}
