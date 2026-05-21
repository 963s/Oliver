import { tseBannerVisible, useFiscalHealthStore } from "../store/fiscalHealthStore";

/**
 * High-visibility TSE-Notstand strip (ops must fix printer / cloud TSE / network).
 */
export function FiscalHealthBanner() {
  const fromApi = useFiscalHealthStore((s) => s.tseAusfallFromApi);
  const fromSse = useFiscalHealthStore((s) => s.tseAusfallSse);
  if (!tseBannerVisible({ tseAusfallFromApi: fromApi, tseAusfallSse: fromSse })) {
    return null;
  }
  return (
    <div
      className="flex w-full items-center justify-center border-t-2 border-[#7f1d1d] bg-gray-50/95 px-4 py-2.5 text-sm font-light tracking-[0.16em] text-[#f87171]/88  sm:text-[13px]"
      role="alert"
    >
      <span className="text-center uppercase leading-relaxed" lang="de">
        TSE-Ausfall aktiv · Drucker, Internet und Kassensystem prüfen · Support informieren
      </span>
    </div>
  );
}
