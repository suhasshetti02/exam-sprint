declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}

declare module "pdf-parse/worker" {
  export const CanvasFactory: unknown;
  export function getData(): unknown;
  export function getPath(): string;
}
