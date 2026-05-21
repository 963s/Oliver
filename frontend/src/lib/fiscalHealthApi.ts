import { apiGet } from "../api";
import { useFiscalHealthStore } from "../store/fiscalHealthStore";

export type FiscalHealthResponse = {
  lastClosedTseStatus: string | null;
  tseAusfallBanner: boolean;
};

export async function fetchFiscalHealth(): Promise<FiscalHealthResponse> {
  return apiGet<FiscalHealthResponse>("/api/health/fiscal");
}

/**
 * Fetches server fiscal snapshot and updates the store (source of truth vs SSE echo).
 */
export function pullFiscalHealthIntoStore(): Promise<void> {
  return fetchFiscalHealth()
    .then((r) => {
      useFiscalHealthStore.getState().setTseFromApi(r.tseAusfallBanner);
    })
    .catch(() => {
      /* keep previous flags */
    });
}
