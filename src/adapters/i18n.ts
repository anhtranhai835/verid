import { readFileSync } from "node:fs";

// Phase 0 shows both languages; manifest.language picks one once the manifest exists (Phase 4).
export type Lang = "vi" | "en";
const catalogs = new Map<Lang, Record<string, string>>();

// Resolved from the bundle in dist/, which is the only way verid runs.
export function t(lang: Lang, key: string, params: Record<string, string>): string {
  if (!catalogs.has(lang)) {
    try {
      const url = new URL(`../i18n/${lang}.json`, import.meta.url);
      catalogs.set(lang, JSON.parse(readFileSync(url, "utf8")) as Record<string, string>);
    } catch {
      catalogs.set(lang, {}); // a missing catalog must not turn a deny into a crash
    }
  }
  const template = catalogs.get(lang)?.[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => params[name] ?? m);
}

export const bilingual = (key: string, params: Record<string, string>) =>
  `vi: ${t("vi", key, params)}\nen: ${t("en", key, params)}`;
