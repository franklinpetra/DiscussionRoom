// Copies pdf.js's worker into public/ so PDFs can be read in the browser from our own origin.
import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
copyFileSync(require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"), "public/pdf.worker.min.mjs");
