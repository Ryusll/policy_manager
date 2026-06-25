/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_COMPANY_LEGAL_NAME?: string;
  readonly VITE_PUBLIC_COMPANY_REG_NO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'pdfjs-dist/build/pdf.worker.mjs?url' {
  const workerSrc: string;
  export default workerSrc;
}

