import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Files the developer drops on the board's chat land here, for the AI to read by path. */
const UPLOADS = ".verid/uploads";
export const MAX_UPLOAD = 25 * 1024 * 1024;

/**
 * A safe file name from what the browser sent: no folders, no leading dot, only letters (any
 * script), digits and a few marks, at most 120 characters, the extension kept.
 */
export function uploadName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const clean = base
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (!clean) return "file";
  // Windows device names open the device, not a file, whatever the extension.
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean)) return `_${clean}`.slice(0, 120);
  if (clean.length <= 120) return clean;
  const ext = /\.[\p{L}\p{N}]{1,10}$/u.exec(clean)?.[0] ?? "";
  return clean.slice(0, 120 - ext.length) + ext;
}

/** Writes one upload and returns its project-relative path; a taken name gets -1, -2, … */
export function saveUpload(project: string, raw: string, data: Buffer): string {
  const dir = join(project, UPLOADS);
  mkdirSync(dir, { recursive: true });
  const name = uploadName(raw);
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let i = 0; i < 1000; i++) {
    const file = i === 0 ? name : `${stem}-${i}${ext}`;
    try {
      writeFileSync(join(dir, file), data, { flag: "wx" });
      return `${UPLOADS}/${file}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Too many uploads with the same name");
}
