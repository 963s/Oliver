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
      }>;
    };
  }
}
export {};
