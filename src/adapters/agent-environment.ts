/** Refuse known agent markers; the live probe checks which Codex supplies in tool shells. */
export function inAgentShell(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.CLAUDECODE === "1" ||
    !!env.CODEX_THREAD_ID ||
    !!env.CODEX_SESSION_ID ||
    !!env.CODEX_TOOL_CALL_ID
  );
}
