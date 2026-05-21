/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    orElectron?: {
      getPaths: () => Promise<{
        projectRoot: string;
        databasePath: string;
        isDev: boolean;
        version: string;
      }>;
      checkForUpdate: () => Promise<{
        status: "no_update" | "update_available" | "error";
        current?: string;
        latest?: string;
        error?: string;
      }>;
      getPendingUpdate: () => Promise<{
        version: string;
        currentVersion: string;
        url: string;
        dmgUrl?: string;
        notes?: string;
      } | null>;
      getUpdateStatus: () => Promise<{
        currentVersion: string;
        pendingUpdate: { version: string; dmgUrl?: string; releaseUrl?: string } | null;
        lastCheckedAt: number | null;
        lastCheckOutcome: "never" | "no_update" | "update_available" | "error";
        lastCheckError: string | null;
      }>;
      openUpdatePage: (url: string) => Promise<void>;
      installUpdate: () => Promise<{ ok: boolean; version?: string; error?: string }>;
      onUpdateAvailable: (
        cb: (info: {
          version: string;
          currentVersion: string;
          url: string;
          dmgUrl?: string;
          canAutoInstall?: boolean;
          platform?: string;
          notes: string;
        }) => void,
      ) => () => void;
      onUpdateCheckComplete: (
        cb: (info: {
          status: "no_update" | "update_available" | "error";
          current?: string;
          latest?: string;
          error?: string;
          checkedAt: number;
        }) => void,
      ) => () => void;
      onUpdateProgress: (
        cb: (info: { received: number; total: number; percent: number }) => void,
      ) => () => void;
    };
  }
}
export {};
