// Files embedded in the bundle as text: scripts/build.mjs and Vitest both resolve `?raw`.
declare module "*?raw" {
  const text: string;
  export default text;
}
