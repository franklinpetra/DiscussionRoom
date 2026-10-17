import type { Attachment } from "@/lib/guest-room";

// Roughly 75k tokens across all files: every seat reads the material in each of its turns.
export const MAX_ATTACHMENT_CHARS = 300_000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_FILES =
  ".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.cs,.swift,.kt,.sql,.sh,.css";

const TEXT_EXTENSIONS = new Set(
  ACCEPTED_FILES.split(",")
    .map((extension) => extension.slice(1))
    .filter((extension) => extension !== "pdf" && extension !== "docx"),
);

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

async function readPdf(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise;
  const pages: string[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join("")
        .trim(),
    );
  }
  await task.destroy();
  return pages.join("\n\n");
}

async function readDocx(file: File) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

/** Reads a file into plain text entirely in the browser; nothing is uploaded. */
export async function extractText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is larger than 25 MB.`);
  }
  const extension = extensionOf(file.name);
  let text: string;
  if (extension === "pdf") text = await readPdf(file);
  else if (extension === "docx") text = await readDocx(file);
  else if (TEXT_EXTENSIONS.has(extension) || file.type.startsWith("text/")) text = await file.text();
  else throw new Error(`${file.name} is not a supported file type.`);
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) {
    throw new Error(
      extension === "pdf"
        ? `${file.name} has no readable text (it may be a scanned image).`
        : `${file.name} is empty.`,
    );
  }
  return clean;
}

/** Adds text to the attachment list, trimming whatever exceeds the shared size budget. */
export function addAttachment(current: Attachment[], name: string, text: string): Attachment[] {
  const used = current.reduce((total, item) => total + item.text.length, 0);
  const room = MAX_ATTACHMENT_CHARS - used;
  if (room <= 0) throw new Error("The room's attachment limit is already full.");
  const truncated = text.length > room;
  return [...current, { name, text: truncated ? text.slice(0, room) : text, truncated }];
}

export function estimateTokens(characters: number) {
  return Math.ceil(characters / 4);
}
