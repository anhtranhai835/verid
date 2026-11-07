import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parseArgs } from "node:util";
import { inAgentShell } from "../adapters/agent-environment.js";
import { boardSnapshot, saveBoardDocument, taskPrompt } from "../adapters/kanban.js";
import { boardHtml } from "./board-page.js";
import type { CliResult } from "./test.js";

type Command = (command: "order" | "serve", task: string) => Promise<CliResult>;

/** A loopback-only developer UI. All mutations use the same approval/evidence gates as the CLI. */
export async function startBoard(project: string, command: Command, port = 0) {
  if (inAgentShell()) throw new Error("verid board chỉ chạy từ terminal của người dùng.");
  await boardSnapshot(project);
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
      res.end(boardHtml);
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`)
      return send(res, 401, { error: "Mở board bằng URL được in trong terminal." });
    if (req.method === "GET" && url.pathname === "/api/board")
      return send(res, 200, await boardSnapshot(project));
    if (req.method !== "POST" || url.pathname !== "/api/action")
      return send(res, 404, { error: "Not found" });
    if (req.headers.origin !== origin || req.headers["content-type"] !== "application/json")
      return send(res, 403, { error: "Invalid origin or content type" });
    let body = "";
    req.setEncoding("utf8");
    for await (const chunk of req) {
      body += String(chunk);
      if (Buffer.byteLength(body) > 512_000)
        return send(res, 413, { error: "Tài liệu quá lớn (tối đa 512 KB)." });
    }
    const data: unknown = JSON.parse(body);
    if (!data || typeof data !== "object" || Array.isArray(data))
      return send(res, 400, { error: "Invalid action" });
    const input = data as Record<string, unknown>;
    const snapshot = await boardSnapshot(project);
    if (input.revision !== snapshot.revision)
      return send(res, 409, {
        error: "Bảng đã thay đổi. Đã tải lại dữ liệu; hãy thực hiện lại thao tác.",
      });
    if (input.action === "spec" || input.action === "plan" || input.action === "split") {
      if (input.action !== "split" && typeof input.content !== "string")
        return send(res, 400, { error: "Missing document" });
      saveBoardDocument(
        project,
        input.action,
        typeof input.content === "string" ? input.content : "",
      );
    } else if (input.action === "select" || input.action === "serve") {
      const task = snapshot.tasks.find((item) => item.id === input.task);
      if (!task) return send(res, 400, { error: "Task không tồn tại." });
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
  if (inAgentShell()) throw new Error("verid board chỉ chạy từ terminal của người dùng.");
  const { values } = parseArgs({
    args,
    options: { port: { type: "string" }, "no-open": { type: "boolean" } },
    allowPositionals: false,
  });
  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("--port cần là số từ 0 đến 65535.");
  const board = await startBoard(project, command, port);
  process.stdout.write(
    `Verid Kanban: ${board.url}\nMỗi task một session AI. Giữ terminal này mở; Ctrl+C để dừng board.\n`,
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
    child.on("error", () =>
      process.stderr.write("Không tự mở được trình duyệt. Mở URL ở trên để dùng board.\n"),
    );
    child.unref();
  }
  return { exit: 0, stdout: "", stderr: "" };
}
