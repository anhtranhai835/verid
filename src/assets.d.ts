// Files embedded in the bundle as text: scripts/build.mjs and Vitest both resolve `?raw`.
declare module "*?raw" {
  const text: string;
  export default text;
}

// Pictures embedded as a data: URL: scripts/build.mjs and Vitest both resolve `?inline`.
declare module "*?inline" {
  const dataUrl: string;
  export default dataUrl;
}
