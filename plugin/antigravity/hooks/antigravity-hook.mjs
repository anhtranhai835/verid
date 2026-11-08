#!/usr/bin/env node
/**
 * Antigravity <-> Verid Hook Bridge (`antigravity-hook.mjs`)
 *
 * Translates Antigravity's camelCase lifecycle payloads (SessionStart, PreInvocation,
 * PreToolUse, PostToolUse, Stop) to verid's compiled `hook.js` without modifying verid's `src/`.
 *
 * Key Token & Safety Features:
 * 1. Instant no-op (<3ms) in workspaces without `.verid/.state/state.json`.
 * 2. Zero-token `/verid peek`, `/verid menu`, `/verid tip`, `/verid confirm` via PreInvocation terminate.
 * 3. Single-writer main thread compatibility even when `.verid/manifest.yaml` maps split tester/coder roles.
 * 4. Automatic `SubagentStart` / `SubagentStop` bridge for `verid-reviewer` and `verid-security` subagents.
 * 5. Protects `.agents/`, `~/.gemini/config/`, and Antigravity conversation transcripts.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVENT = process.argv[2] || "PreToolUse";

async function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;

  let payload;
  try {
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return emitFailClosed(EVENT, "verid [VERID_BURNT_PAYLOAD]\nInvalid JSON on Antigravity hook stdin.");
  }

  const projectRoot = findVeridProject(payload.workspacePaths);
  if (!projectRoot) {
    return emitAllow(EVENT);
  }

  const hookJs = resolveHookJs(projectRoot);
  if (!hookJs) {
    return emitFailClosed(
      EVENT,
      "verid [VERID_BURNT_INTERNAL]\nCannot locate verid runtime hook.js (.verid/hooks/hook.js or plugin runtime/hook.js).",
    );
  }

  const sessionId = String(payload.conversationId || "antigravity-session");

  // Complete any pending reviewer subagent job before running PreInvocation / PreToolUse / Stop
  if (
    EVENT === "PreInvocation" ||
    EVENT === "PreToolUse" ||
    EVENT === "PostToolUse" ||
    EVENT === "Stop"
  ) {
    tryCompletePendingReviews(projectRoot, hookJs, sessionId, payload);
  }

  if (EVENT === "SessionStart") {
    const res = invokeVeridHook(hookJs, projectRoot, {
      hook_event_name: "SessionStart",
      session_id: sessionId,
      cwd: projectRoot,
      source: "startup",
    });
    const text = (res.stdout || "").trim();
    if (!text) return writeJson({});
    return writeJson({
      injectSteps: [
        {
          systemMessage: {
            systemMessage: `${text}\nverid (Antigravity): Single-writer TDD active (RAW -> COOKING -> PLATED). Do not re-read AGENTS.md; use verid peek in loop.`,
          },
        },
      ],
    });
  }

  if (EVENT === "PreInvocation") {
    const prompt = typeof payload.lastUserInput === "string" ? payload.lastUserInput : "";
    const res = invokeVeridHook(
      hookJs,
      projectRoot,
      {
        hook_event_name: "UserPromptSubmit",
        session_id: sessionId,
        cwd: projectRoot,
        prompt,
      },
      { CLAUDE_CODE_SESSION_ATTENDED: "1" },
    );

    if (res.exit !== 0) {
      const msg = (res.stderr || res.stdout || "verid command handled").trim();
      return writeJson({
        injectSteps: [
          {
            errorMessage: {
              userMessage: msg,
            },
          },
        ],
        terminationBehavior: "terminate",
      });
    }

    const out = (res.stdout || "").trim();
    if (!out) return writeJson({});
    let sysText = out;
    try {
      const parsed = JSON.parse(out);
      if (typeof parsed?.systemMessage === "string") sysText = parsed.systemMessage;
    } catch {
      // plain text stdout
    }
    return writeJson({
      injectSteps: [
        {
          systemMessage: {
            systemMessage: sysText,
          },
        },
      ],
    });
  }

  if (EVENT === "PreToolUse") {
    const toolCall = payload.toolCall || {};
    const toolName = String(toolCall.name || "");
    const args = toolCall.args && typeof toolCall.args === "object" ? toolCall.args : {};

    // 1. Protect Antigravity's own customization roots (.agents/, ~/.gemini/config/) and transcripts
    const protection = checkAntigravityProtection(projectRoot, toolName, args, payload);
    if (protection) {
      return writeJson({ decision: "deny", reason: protection });
    }

    // 2. If invoking verid-reviewer or verid-security subagent, trigger SubagentStart snapshot
    if (toolName === "invoke_subagent") {
      const subagentType = String(args.TypeName || args.typeName || "");
      const reviewKind = classifyReviewSubagent(subagentType);
      if (reviewKind) {
        const mappedAgent = resolveMappedRoleAgent(projectRoot, reviewKind);
        invokeVeridHook(hookJs, projectRoot, {
          hook_event_name: "SubagentStart",
          session_id: sessionId,
          cwd: projectRoot,
          agent_id: `agy-${reviewKind}`,
          agent_type: mappedAgent,
        });
      }
    }

    // 3. Map Antigravity tool call to verid's PreToolUse contract
    const mapped = mapAntigravityTool(projectRoot, toolName, args);

    // 4. Fast-path in-process allow (<2ms) for safe project reads (avoids spawning node hook.js)
    if (canBypassSafeRead(projectRoot, mapped)) {
      return writeJson({ decision: "allow" });
    }

    const roleIdentity = resolveSingleWriterIdentity(projectRoot, mapped);

    const res = invokeVeridHook(hookJs, projectRoot, {
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      cwd: projectRoot,
      tool_name: mapped.tool_name,
      tool_input: mapped.tool_input,
      ...(roleIdentity ? roleIdentity : {}),
    });

    if (res.exit !== 0) {
      const reason = (res.stderr || res.stdout || "verid [VERID_BURNT_INTERNAL]").trim();
      return writeJson({ decision: "deny", reason });
    }
    return writeJson({ decision: "allow" });
  }

  if (EVENT === "PostToolUse") {
    return writeJson({});
  }

  if (EVENT === "Stop") {
    const stopActive = isRepeatStopHold(projectRoot, sessionId, payload.executionNum);
    const res = invokeVeridHook(hookJs, projectRoot, {
      hook_event_name: "Stop",
      session_id: sessionId,
      cwd: projectRoot,
      stop_hook_active: stopActive,
    });
    if (res.exit !== 0) {
      markStopHeld(projectRoot, sessionId, payload.executionNum);
      const reason = (res.stderr || res.stdout || "verid hold").trim();
      return writeJson({ decision: "continue", reason });
    }
    return writeJson({ decision: "allow" });
  }

  return emitAllow(EVENT);
}

/** Locate the nearest workspace directory containing `.verid/.state/state.json`. */
function findVeridProject(workspacePaths) {
  const candidates = [
    ...(Array.isArray(workspacePaths) ? workspacePaths : []),
    process.cwd(),
  ].filter((p) => typeof p === "string" && p.length > 0);

  for (const start of candidates) {
    for (let dir = resolve(start); ; dir = dirname(dir)) {
      if (existsSync(join(dir, ".verid", ".state", "state.json"))) return dir;
      if (dirname(dir) === dir) break;
    }
  }
  return null;
}

/** Resolve verid's compiled `hook.js` from repo `.verid/hooks/`, env, plugin runtime, or repo `dist/`. */
function resolveHookJs(projectRoot) {
  const candidates = [
    join(projectRoot, ".verid", "hooks", "hook.js"),
    process.env.VERID_HOOK_PATH,
    join(__dirname, "..", "runtime", "hook.js"),
    join(__dirname, "..", "..", "..", "dist", "hook.js"),
    "C:/Users/Tranh/OneDrive/Desktop/Project/harness/aeriq/dist/hook.js",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Run verid's `hook.js` synchronously with a Claude-compatible JSON payload. */
function invokeVeridHook(hookJs, projectRoot, claudePayload, extraEnv = {}) {
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: projectRoot,
    ...extraEnv,
  };
  // Ensure verid's inAgentShell sees Antigravity tool invocations as agent shells,
  // while the hook process itself only evaluates payloads.
  const child = spawnSync(process.execPath, [hookJs], {
    cwd: projectRoot,
    input: JSON.stringify(claudePayload),
    encoding: "utf8",
    env,
    timeout: 9000,
  });
  if (child.error || child.status === null) {
    return {
      exit: 2,
      stdout: "",
      stderr: `verid [VERID_BURNT_INTERNAL]\nHook execution failed: ${child.error?.message || "timeout"}`,
    };
  }
  return {
    exit: child.status === 0 ? 0 : 2,
    stdout: child.stdout || "",
    stderr: child.stderr || "",
  };
}

/** Map Antigravity tool names & args to verid's expected Claude Code tool schema. */
function mapAntigravityTool(projectRoot, toolName, args) {
  switch (toolName) {
    case "write_file":
      return {
        tool_name: "Write",
        tool_input: { file_path: String(args.Path ?? args.file_path ?? "") },
        targetPath: String(args.Path ?? args.file_path ?? ""),
        access: "write",
      };

    case "edit_file":
    case "replace_file_content":
    case "multi_replace_file_content":
      return {
        tool_name: "Edit",
        tool_input: {
          file_path: String(args.Path ?? args.TargetFile ?? args.file_path ?? ""),
        },
        targetPath: String(args.Path ?? args.TargetFile ?? args.file_path ?? ""),
        access: "write",
      };

    case "read_file":
    case "view_file":
    case "view_file_outline":
    case "view_code_item":
      return {
        tool_name: "Read",
        tool_input: {
          file_path: String(args.Path ?? args.AbsolutePath ?? args.File ?? args.file_path ?? ""),
        },
        targetPath: String(args.Path ?? args.AbsolutePath ?? args.File ?? args.file_path ?? ""),
        access: "read",
      };

    case "grep_search":
      return {
        tool_name: "Grep",
        tool_input: {
          path: String(args.SearchPath ?? args.DirectoryPath ?? projectRoot),
        },
        access: "read",
      };

    case "find_by_name":
    case "list_dir":
      return {
        tool_name: "Glob",
        tool_input: {
          path: String(args.SearchDirectory ?? args.DirectoryPath ?? projectRoot),
        },
        access: "read",
      };

    case "run_command": {
      const rawCmd = String(args.CommandLine ?? args.command ?? "");
      const augmentedCmd = augmentPowerShellCommandForVerid(rawCmd);
      return {
        tool_name: "Bash",
        tool_input: { command: augmentedCmd },
        command: rawCmd,
      };
    }

    case "invoke_subagent": {
      const rawType = String(args.TypeName ?? args.typeName ?? "");
      return {
        tool_name: "Agent",
        tool_input: {
          subagent_type: normalizeSubagentNameForManifest(projectRoot, rawType),
        },
      };
    }

    case "call_mcp_tool": {
      const server = String(args.ServerName ?? "mcp");
      const tool = String(args.ToolName ?? "tool");
      const mcpArgs =
        args.Arguments && typeof args.Arguments === "object" ? args.Arguments : {};
      return {
        tool_name: `mcp__${server}__${tool}`,
        tool_input: mcpArgs,
      };
    }

    default:
      return {
        tool_name: toolName,
        tool_input: args,
      };
  }
}

/**
 * Fast-path in-process check for read-only tools (`Read`, `Grep`, `Glob`).
 * Avoids spawning a child `node hook.js` process (~60ms) when reading normal project files,
 * while falling through to `hook.js` for `.verid/.state`, secrets, instruction files, or kanban mode.
 */
function canBypassSafeRead(projectRoot, mapped) {
  if (mapped.access !== "read") return false;
  const manifestText = readTextSafe(join(projectRoot, ".verid", "manifest.yaml")) || "";
  if (/^\s*workflow:\s*["']?kanban["']?/m.test(manifestText)) return false;

  const rawTarget =
    mapped.targetPath ||
    mapped.tool_input?.file_path ||
    mapped.tool_input?.path ||
    projectRoot;
  if (!rawTarget || typeof rawTarget !== "string") return false;

  const resolved = normalize(resolve(projectRoot, rawTarget));
  const rootNorm = normalize(projectRoot);
  if (!isUnder(resolved, rootNorm)) return false;

  const rel = resolved.slice(rootNorm.length).replace(/^\/+/, "");
  if (rel.startsWith(".verid/.state") || rel === ".verid/.state") return false;

  // Never bypass instruction files (verid's decideInstructions blocks re-reading AGENTS.md/CLAUDE.md)
  if (/(?:^|\/)(?:agents|claude|gemini)\.md$/i.test(rel)) return false;

  // Never bypass potential secret files so hook.js records audit & denial
  if (
    /(?:^|\/)(?:\.env(?:\.[^/]+)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|.*(?:secret|credential|private).*)|\.(?:pem|key|p12|pfx|keystore)$/i.test(
      rel,
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Antigravity on Windows runs PowerShell in `run_command`.
 * Extract obvious PowerShell file write cmdlets (Set-Content, Add-Content, Out-File)
 * at command boundaries only (avoiding false positives on `git rm`, `npm rm`, or `sc.exe`).
 */
function augmentPowerShellCommandForVerid(command) {
  const extraRedirects = [];
  const patterns = [
    /(?:^|[;|&\r\n]\s*)(?:Set-Content|Add-Content|Out-File)\s+(?:-(?:Path|LiteralPath)\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;|>&-]+))/gi,
    /(?:^|[;|&\r\n]\s*)(?:Copy-Item|Move-Item)\s+(?:-(?:Path|LiteralPath)\s+)?(?:"[^"]+"|'[^']+'|[^\s;|>&]+)\s+(?:-(?:Destination)\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;|>&-]+))/gi,
    /(?:^|[;|&\r\n]\s*)(?:Remove-Item|del|erase)\s+(?:-[A-Za-z]+\s+)*(?:"([^"]+)"|'([^']+)'|([^\s;|>&-]+))/gi,
  ];
  for (const regex of patterns) {
    for (const match of command.matchAll(regex)) {
      const target = match[1] || match[2] || match[3];
      if (target && !target.startsWith("-")) {
        extraRedirects.push(`true > "${target.replace(/"/g, '\\"')}"`);
      }
    }
  }
  return extraRedirects.length > 0 ? `${command} ; ${extraRedirects.join(" ; ")}` : command;
}

/**
 * Protect Antigravity's own `.agents/`, `~/.gemini/config/`, and conversation transcripts
 * from modification or unauthorized reads.
 */
function checkAntigravityProtection(projectRoot, toolName, args, payload) {
  const homeConfig = normalize(join(homedir(), ".gemini", "config"));
  const projectAgents = normalize(join(projectRoot, ".agents"));
  const appDataBrain = payload.transcriptPath
    ? normalize(dirname(dirname(dirname(String(payload.transcriptPath)))))
    : normalize(join(homedir(), ".gemini", "antigravity", "brain"));
  const allowedArtifactDir = payload.artifactDirectoryPath
    ? normalize(String(payload.artifactDirectoryPath))
    : null;

  const paths = [];
  if (toolName === "write_file" || toolName === "edit_file") {
    paths.push({ path: String(args.Path ?? ""), access: "write" });
  } else if (toolName === "replace_file_content" || toolName === "multi_replace_file_content") {
    paths.push({ path: String(args.TargetFile ?? ""), access: "write" });
  } else if (
    toolName === "read_file" ||
    toolName === "view_file" ||
    toolName === "view_file_outline" ||
    toolName === "view_code_item"
  ) {
    paths.push({
      path: String(args.Path ?? args.AbsolutePath ?? args.File ?? ""),
      access: "read",
    });
  } else if (toolName === "run_command") {
    const cmd = String(args.CommandLine ?? "");
    if (/(?:^|[\s/\\])\.agents(?:$|[\s/\\"'])|\.gemini[/\\]config/i.test(cmd)) {
      // Allow read-only skill script execution from .agents/skills or .gemini/config/plugins/*/skills
      const isWriteCmd =
        /(?:>|>>|\b(?:rm|mv|cp|tee|Set-Content|Add-Content|Out-File|Remove-Item|Copy-Item|Move-Item|New-Item)\b)/i.test(
          cmd,
        );
      if (isWriteCmd) {
        return "verid [VERID_BURNT_HOOK_PROTECTED]\nModifying Antigravity customization or hook files (.agents/, ~/.gemini/config/) is forbidden.";
      }
    }
    if (/transcript(?:_full)?\.jsonl/i.test(cmd)) {
      return "verid [VERID_BURNT_TRANSCRIPT_PROTECTED]\nReading or modifying conversation transcripts is forbidden.";
    }
  }

  for (const item of paths) {
    if (!item.path) continue;
    const resolved = normalize(resolve(projectRoot, item.path));
    if (item.access === "write" && (isUnder(resolved, homeConfig) || isUnder(resolved, projectAgents))) {
      return `verid [VERID_BURNT_HOOK_PROTECTED]\nProtected Antigravity customization path: ${item.path}`;
    }
    if (
      resolved.endsWith("/transcript.jsonl") ||
      resolved.endsWith("/transcript_full.jsonl") ||
      (isUnder(resolved, appDataBrain) &&
        (!allowedArtifactDir || !isUnder(resolved, allowedArtifactDir)))
    ) {
      return `verid [VERID_BURNT_TRANSCRIPT_PROTECTED]\nProtected Antigravity transcript path: ${item.path}`;
    }
  }
  return null;
}

/**
 * Single-Writer Role Bridge for Antigravity:
 * When `.verid/manifest.yaml` defines split `tester` and `coder` roles (the default for `claude-code`),
 * Antigravity's main agent acts as a single writer (like Codex) to avoid 20x subagent token overhead.
 * We supply the appropriate role identity for file writes so `decideRole` passes while `decideTdd`
 * strictly enforces `RAW -> COOKING -> PLATED` and module approval.
 */
function resolveSingleWriterIdentity(projectRoot, mapped) {
  if (process.env.VERID_ANTIGRAVITY_SPLIT_ROLES === "1") return null;
  if (mapped.access !== "write" && mapped.tool_name !== "Bash") return null;

  const manifestText = readTextSafe(join(projectRoot, ".verid", "manifest.yaml"));
  if (!manifestText) return null;

  const testerRole = extractFirstRoleAgent(manifestText, "tester");
  const coderRole = extractFirstRoleAgent(manifestText, "coder");
  if (!testerRole || !coderRole) return null;

  const target = mapped.targetPath
    ? relative(projectRoot, resolve(projectRoot, mapped.targetPath)).replaceAll("\\", "/")
    : "";

  if (target === ".verid/design.md") {
    const architect = extractFirstRoleAgent(manifestText, "architect");
    return architect ? { agent_id: "agy-main-architect", agent_type: architect } : null;
  }
  if (target === ".verid/plan.md") {
    const planner = extractFirstRoleAgent(manifestText, "planner");
    return planner ? { agent_id: "agy-main-planner", agent_type: planner } : null;
  }

  // Determine whether the write targets a test file or production source file
  if (target && !target.startsWith(".verid/")) {
    const isE2e = /(?:^|\/)e2e\/|\.e2e\.|\.spec\.Playwright/i.test(target);
    const isTest =
      isE2e ||
      /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[A-Za-z0-9]+$/i.test(target);
    if (isTest) {
      const qaRole = isE2e ? extractFirstRoleAgent(manifestText, "qa") : null;
      return {
        agent_id: "agy-main-tester",
        agent_type: qaRole || testerRole,
      };
    }
    return {
      agent_id: "agy-main-coder",
      agent_type: coderRole,
    };
  }
  return null;
}

function classifyReviewSubagent(name) {
  const lower = name.toLowerCase();
  if (lower.includes("security")) return "security";
  if (lower.includes("reviewer") || lower === "review") return "reviewer";
  return null;
}

function resolveMappedRoleAgent(projectRoot, kind) {
  const manifestText = readTextSafe(join(projectRoot, ".verid", "manifest.yaml")) || "";
  return (
    extractFirstRoleAgent(manifestText, kind) ||
    (kind === "security" ? "verid:security" : "verid:reviewer")
  );
}

function normalizeSubagentNameForManifest(projectRoot, rawType) {
  const reviewKind = classifyReviewSubagent(rawType);
  if (reviewKind) return resolveMappedRoleAgent(projectRoot, reviewKind);
  if (rawType.startsWith("verid-")) {
    const manifestText = readTextSafe(join(projectRoot, ".verid", "manifest.yaml")) || "";
    const usesRepoResources = /resources:\s*["']?repo["']?/i.test(manifestText);
    return usesRepoResources ? rawType : rawType.replace(/^verid-/, "verid:");
  }
  return rawType;
}

/**
 * Check if `.verid/.state/state.json` has an active review job in `review_jobs`.
 * If a subagent conversation in `<appDataDir>/brain/` finished with `Verdict: pass` or `Verdict: fail`,
 * forward its report to `hook.js` via `SubagentStop` so verid records the verified review.
 */
function tryCompletePendingReviews(projectRoot, hookJs, sessionId, payload) {
  const stateFile = join(projectRoot, ".verid", ".state", "state.json");
  const stateText = readTextSafe(stateFile);
  if (!stateText) return;

  let state;
  try {
    state = JSON.parse(stateText);
  } catch {
    return;
  }

  const jobs = state?.review_jobs;
  if (!jobs || typeof jobs !== "object" || Object.keys(jobs).length === 0) return;

  const report = findRecentVerdictFromTranscripts(payload);
  if (!report) return;

  for (const [key, job] of Object.entries(jobs)) {
    let parsedKey;
    try {
      parsedKey = JSON.parse(key);
    } catch {
      continue;
    }
    const [, jobSessionId, agentId] = Array.isArray(parsedKey) ? parsedKey : [];
    if (jobSessionId !== sessionId || !agentId) continue;
    const kind = job?.kind === "security" ? "security" : "reviewer";
    const mappedAgent = resolveMappedRoleAgent(projectRoot, kind);
    invokeVeridHook(hookJs, projectRoot, {
      hook_event_name: "SubagentStop",
      session_id: sessionId,
      cwd: projectRoot,
      agent_id: agentId,
      agent_type: mappedAgent,
      last_assistant_message: report,
    });
  }
}

/**
 * Scan recent transcripts in `<appDataDir>/brain/` for a completed subagent response
 * ending with `Verdict: pass` or `Verdict: fail`.
 */
function findRecentVerdictFromTranscripts(payload) {
  const transcriptPath = payload.transcriptPath ? String(payload.transcriptPath) : null;
  const brainDir = transcriptPath
    ? dirname(dirname(dirname(transcriptPath)))
    : join(homedir(), ".gemini", "antigravity", "brain");

  if (!existsSync(brainDir)) return null;

  const now = Date.now();
  const candidates = [];
  try {
    for (const entry of readdirSync(brainDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === payload.conversationId) continue;
      const logFile = join(brainDir, entry.name, ".system_generated", "logs", "transcript.jsonl");
      if (!existsSync(logFile)) continue;
      const st = statSync(logFile);
      if (now - st.mtimeMs <= 15 * 60 * 1000) {
        candidates.push({ logFile, mtimeMs: st.mtimeMs });
      }
    }
  } catch {
    return null;
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { logFile } of candidates.slice(0, 5)) {
    const text = readTextSafe(logFile);
    if (!text) continue;
    const lines = text.trim().split(/\r?\n/).reverse();
    for (const line of lines) {
      try {
        const step = JSON.parse(line);
        if (
          step?.type === "PLANNER_RESPONSE" &&
          typeof step.content === "string" &&
          /(?:^|\n)Verdict:\s*(?:pass|fail)\s*$/i.test(step.content.trim())
        ) {
          return step.content.trim();
        }
      } catch {
        // ignore malformed line
      }
    }
  }
  return null;
}

function extractFirstRoleAgent(manifestText, roleName) {
  const roleBlock = new RegExp(
    `^\\s{2}${roleName}:\\s*(?:\\[([^\\]]+)\\]|\\r?\\n\\s{4}-\\s*([^\\r\\n]+))`,
    "m",
  ).exec(manifestText);
  if (!roleBlock) return null;
  const raw = (roleBlock[1] || roleBlock[2] || "").split(",")[0]?.trim();
  return raw ? raw.replace(/^["']|["']$/g, "") : null;
}

function isRepeatStopHold(projectRoot, sessionId, executionNum) {
  const marker = stopMarkerPath(projectRoot, sessionId);
  const prev = readTextSafe(marker);
  return prev !== null && prev.trim() === String(executionNum ?? 1);
}

function markStopHeld(projectRoot, sessionId, executionNum) {
  try {
    const marker = stopMarkerPath(projectRoot, sessionId);
    writeFileSync(marker, String(executionNum ?? 1), "utf8");
  } catch {
    // non-fatal
  }
}

function stopMarkerPath(projectRoot, sessionId) {
  const safe = `${projectRoot}-${sessionId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-80);
  return join(tmpdir(), `verid-agy-stop-${safe}.txt`);
}

function readTextSafe(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function normalize(p) {
  return p.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function isUnder(child, parent) {
  return child === parent || child.startsWith(`${parent}/`);
}

function emitAllow(event) {
  if (event === "PreToolUse" || event === "Stop") {
    return writeJson({ decision: "allow" });
  }
  return writeJson({});
}

function emitFailClosed(event, reason) {
  if (event === "PreToolUse") {
    return writeJson({ decision: "deny", reason });
  }
  if (event === "Stop") {
    return writeJson({ decision: "allow" });
  }
  return writeJson({});
}

function writeJson(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

await main();
