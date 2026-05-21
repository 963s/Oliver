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
      checkForUpdate: () => Promise<{ version: string; url: string } | null>;
      openUpdatePage: (url: string) => Promise<void>;
      onUpdateAvailable: (
        cb: (info: { version: string; currentVersion: string; url: string; notes: string }) => void,
      ) => () => void;
    };
  }
}
export {};
