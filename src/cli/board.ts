import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parseArgs } from "node:util";
import { inAgentShell } from "../adapters/agent-environment.js";
import { systemLanguage, t } from "../adapters/i18n.js";
import { languageOf } from "../adapters/state-store.js";
import { boardChat, type Spawner } from "../adapters/board-chat.js";
import { boardSnapshot, moveTask, saveBoardDocument, taskPrompt } from "../adapters/kanban.js";
import { boardHtml } from "./board-page.js";
import type { CliResult } from "./test.js";

type Command = (command: "order" | "serve", task: string) => Promise<CliResult>;

/** A board message in the project's language, else the machine's. */
const say = (project: string, key: string, params: Record<string, string> = {}) =>
  t(languageOf(project) ?? systemLanguage(), `board.${key}`, params);

/** A loopback-only developer UI. All mutations use the same approval/evidence gates as the CLI. */
export async function startBoard(project: string, command: Command, port = 0, spawner?: Spawner) {
  if (inAgentShell()) throw new Error(say(project, "err_agent_shell"));
  await boardSnapshot(project);
  const chat = boardChat(project, spawner);
  const token = randomBytes(32).toString("hex");
  let origin = "";
  let queue = Promise.resolve();
  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  const route = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (req.headers.host !== new URL(origin).host) return send(res, 403, { error: "Invalid host" });
    const url = new URL(req.url ?? "/", origin);
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(boardHtml(languageOf(project) ?? systemLanguage()));
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`)
      return send(res, 401, { error: say(project, "err_auth") });
    if (req.method === "GET" && url.pathname === "/api/board")
      return send(res, 200, await boardSnapshot(project));
    if (req.method === "GET" && url.pathname === "/api/chat")
      return send(res, 200, await chat.status());
    if (req.method !== "POST" || url.pathname !== "/api/action")
      return send(res, 404, { error: "Not found" });
    if (req.headers.origin !== origin || req.headers["content-type"] !== "application/json")
      return send(res, 403, { error: "Invalid origin or content type" });
    let body = "";
    req.setEncoding("utf8");
    for await (const chunk of req) {
      body += String(chunk);
      if (Buffer.byteLength(body) > 512_000)
        return send(res, 413, { error: say(project, "err_too_large") });
    }
    const data: unknown = JSON.parse(body);
    if (!data || typeof data !== "object" || Array.isArray(data))
      return send(res, 400, { error: "Invalid action" });
    const input = data as Record<string, unknown>;
    // Chat goes on while its own run changes state, so it is not tied to the board revision.
    if (input.action === "chat-stop") {
      chat.stop();
      return send(res, 200, await chat.status());
    }
    const snapshot = await boardSnapshot(project);
    if (snapshot.notice) return send(res, 409, { error: snapshot.notice });
    if (
      snapshot.drive === "auto" &&
      ["select", "serve", "prompt", "chat"].includes(String(input.action))
    )
      return send(res, 409, { error: say(project, "err_auto_queue") });
    if (input.action === "chat") {
      const task = snapshot.tasks.find((item) => item.id === input.task);
      if (!task?.selected) return send(res, 409, { error: say(project, "err_chat_select") });
      if (task.needsReapproval)
        return send(res, 409, { error: say(project, "err_chat_reapprove") });
      await chat.send({
        task: task.id,
        text: typeof input.text === "string" ? input.text : "",
        provider: typeof input.provider === "string" ? input.provider : "",
      });
      return send(res, 200, await chat.status());
    }
    if (input.revision !== snapshot.revision)
      return send(res, 409, { error: say(project, "err_stale") });
    if (input.action === "spec" || input.action === "plan" || input.action === "split") {
      if (input.action !== "split" && typeof input.content !== "string")
        return send(res, 400, { error: "Missing document" });
      saveBoardDocument(
        project,
        input.action,
        typeof input.content === "string" ? input.content : "",
        snapshot.drive,
      );
    } else if (input.action === "move") {
      if (
        typeof input.task !== "string" ||
        (input.direction !== "up" && input.direction !== "down")
      )
        return send(res, 400, { error: "Invalid task or direction" });
      await moveTask(project, input.task, input.direction, snapshot.revision);
    } else if (input.action === "select" || input.action === "serve") {
      const task = snapshot.tasks.find((item) => item.id === input.task);
      if (!task) return send(res, 400, { error: say(project, "err_no_task") });
      if (input.action === "select" && task.reason) return send(res, 409, { error: task.reason });
      const result = await command(input.action === "select" ? "order" : "serve", task.id);
      if (result.exit !== 0) return send(res, 409, { error: result.stderr });
    } else if (input.action === "prompt" && typeof input.task === "string") {
      return send(res, 200, { prompt: taskPrompt(project, input.task) });
    } else return send(res, 400, { error: "Unknown action" });
    send(res, 200, await boardSnapshot(project));
  };
  const server = createServer((req, res) => {
    // Mutations and reads from this UI have a stable order; hooks still use the state lock.
    queue = queue.then(async () => {
      try {
        await route(req, res);
      } catch (error) {
        if (!res.headersSent)
          send(res, 400, { error: error instanceof Error ? error.message : String(error) });
        else res.end();
      }
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot start board");
  origin = `http://127.0.0.1:${address.port}`;
  return { server, url: `${origin}/#${token}`, origin, token };
}

export async function boardCommand(
  project: string,
  args: string[],
  command: Command,
): Promise<CliResult> {
  if (inAgentShell()) throw new Error(say(project, "err_agent_shell"));
  const { values } = parseArgs({
    args,
    options: { port: { type: "string" }, "no-open": { type: "boolean" } },
    allowPositionals: false,
  });
  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(say(project, "err_port"));
  const board = await startBoard(project, command, port);
  const snapshot = await boardSnapshot(project);
  process.stdout.write(
    `Verid Kanban: ${board.url}\n${snapshot.notice ?? say(project, snapshot.drive === "auto" ? "terminal_auto" : "terminal_human")} ${say(project, "terminal_keep")}\n`,
  );
  if (!values["no-open"]) {
    // No shell interpolation. Windows URL is a generated loopback address with a hex fragment.
    const program =
      process.platform === "win32"
        ? "rundll32.exe"
        : process.platform === "darwin"
          ? "open"
          : "xdg-open";
    const child = spawn(
      program,
      process.platform === "win32" ? ["url.dll,FileProtocolHandler", board.url] : [board.url],
      { windowsHide: true, stdio: "ignore" },
    );
    child.on("error", () => process.stderr.write(`${say(project, "err_open")}\n`));
    child.unref();
  }
  return { exit: 0, stdout: "", stderr: "" };
}
