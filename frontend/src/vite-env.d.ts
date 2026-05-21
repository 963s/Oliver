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
      checkForUpdate: () => Promise<{ version: string; url: string; dmgUrl?: string } | null>;
      openUpdatePage: (url: string) => Promise<void>;
      installUpdate: () => Promise<{ ok: boolean; version?: string; error?: string }>;
      onUpdateAvailable: (
        cb: (info: {
          version: string;
          currentVersion: string;
          url: string;
          dmgUrl?: string;
          canAutoInstall?: boolean;
          notes: string;
        }) => void,
      ) => () => void;
      onUpdateProgress: (
        cb: (info: { received: number; total: number; percent: number }) => void,
      ) => () => void;
    };
  }
}
export {};
