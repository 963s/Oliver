import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "./api";

/**
 * PWA: camera barcode via BarcodeDetector when available, else manual entry.
 */
export function ScanDeduct() {
  const [searchParams] = useSearchParams();
  const [barcode, setBarcode] = useState("4004011100001");
  const [ml, setMl] = useState(30);
  const [log, setLog] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const b = searchParams.get("barcode");
    if (b) setBarcode(b);
  }, [searchParams]);

  const onScan = async () => {
    if (!("BarcodeDetector" in window)) {
      setLog("BarcodeDetector API nicht verfügbar — Barcode manuell eingeben.");
      return;
    }
    try {
      if (!stream) {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play();
        }
      }
      const el = videoRef.current;
      if (!el) return;
      // @ts-expect-error BarcodeDetector
      const detector = new BarcodeDetector({ formats: ["ean_13", "upc_a", "code_128"] });
      const bitmap = await createImageBitmap(el);
      const codes = await detector.detect(bitmap);
      if (codes[0]?.rawValue) setBarcode(codes[0].rawValue);
    } catch (e) {
      setLog(String(e));
    }
  };

  const deduct = () => {
    const prompted = window.prompt("How many ml?");
    if (prompted == null) return;
    const promptedMl = Math.floor(Number(prompted));
    if (!Number.isFinite(promptedMl) || promptedMl <= 0) {
      setLog("Please enter a positive ml value.");
      return;
    }
    setLog("…");
    setMl(promptedMl);
    void apiPost("/api/inventory/scan-deduct", { barcode, ml: promptedMl })
      .then((r) => setLog(JSON.stringify(r)))
      .catch((e) => setLog(String(e)));
  };

  const lookup = () => {
    setLog("…");
    void apiGet<unknown>(`/api/inventory/lookup?barcode=${encodeURIComponent(barcode)}`)
      .then((r) => setLog(JSON.stringify(r)))
      .catch((e) => setLog(String(e)));
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: 20 }}>
      <h2>Scan to deduct (ml)</h2>
      <p style={{ color: "#78716c" }}>EAN/UPC → Bestand in ml anpassen</p>
      <video
        ref={videoRef}
        style={{ width: "100%", borderRadius: 8, display: stream ? "block" : "none" }}
        playsInline
        muted
      />
      <input
        value={barcode}
        onChange={(e) => setBarcode(e.target.value)}
        placeholder="EAN/UPC"
        style={{ width: "100%", fontSize: 20, padding: 12, marginTop: 10 }}
      />
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
        <label>
          ml:{" "}
          <input
            type="number"
            value={ml}
            onChange={(e) => setMl(Number(e.target.value))}
            style={{ width: 100, fontSize: 20, padding: 8 }}
          />
        </label>
      </div>
      <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={onScan} style={btn}>
          Kamera
        </button>
        <button type="button" onClick={lookup} style={btn}>
          Suche
        </button>
        <button type="button" onClick={deduct} style={btn}>
          Abziehen
        </button>
      </div>
      <pre style={{ marginTop: 20, background: "#0c0a09", color: "#e7e5e4", padding: 12, borderRadius: 8 }}>
        {log}
      </pre>
    </div>
  );
}

const btn: CSSProperties = {
  fontSize: 18,
  padding: "12px 16px",
  borderRadius: 8,
  border: "none",
  background: "#b45309",
  color: "#fff",
};
