import { useCallback, useEffect } from "react";
import { useVisibilityWakeSync } from "./useVisibilityWakeSync";
import { pullFiscalHealthIntoStore } from "../lib/fiscalHealthApi";

const POLL_MS = 120_000;

/**
 * Poll + wake refetch: keep TSE-Ausfall banner aligned with the server.
 */
export function useFiscalHealthSync(): { refetchFiscal: () => void } {
  const refetchFiscal = useCallback(() => {
    void pullFiscalHealthIntoStore();
  }, []);

  useEffect(() => {
    refetchFiscal();
  }, [refetchFiscal]);

  useEffect(() => {
    const id = setInterval(refetchFiscal, POLL_MS);
    return () => clearInterval(id);
  }, [refetchFiscal]);

  useVisibilityWakeSync(refetchFiscal);

  return { refetchFiscal };
}
