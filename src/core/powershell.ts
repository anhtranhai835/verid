export interface PowershellTargets {
  targets: string[];
  unsupported?: string;
}

interface Token {
  text: string;
  literal: boolean;
  quoted: boolean;
  operator: boolean;
}

const ALIASES: Record<string, string> = {
  sc: "set-content",
  ac: "add-content",
  clc: "clear-content",
  tee: "tee-object",
  ni: "new-item",
  mkdir: "new-item",
  md: "new-item",
  copy: "copy-item",
  cp: "copy-item",
  cpi: "copy-item",
  move: "move-item",
  mv: "move-item",
  mi: "move-item",
  ren: "rename-item",
  rni: "rename-item",
  del: "remove-item",
  erase: "remove-item",
  rd: "remove-item",
  rmdir: "remove-item",
  rm: "remove-item",
  ri: "remove-item",
};
const WRITERS = new Set([
  "set-content",
  "add-content",
  "clear-content",
  "out-file",
  "tee-object",
  "new-item",
  "copy-item",
  "move-item",
  "rename-item",
  "remove-item",
]);
const SWITCHES = new Set([
  "force",
  "recurse",
  "append",
  "noclobber",
  "confirm",
  "whatif",
  "passthru",
  "verbose",
  "debug",
  "nonewline",
  "asbytestream",
  "usetransaction",
  "noenumerate",
]);
const PARAMETERS = [
  "path",
  "literalpath",
  "filepath",
  "destination",
  "newname",
  "name",
  "value",
  "encoding",
  "itemtype",
  "type",
  "filter",
  "include",
  "exclude",
  "erroraction",
  "warningaction",
  "informationaction",
  "errorvariable",
  "warningvariable",
  "informationvariable",
  "outvariable",
  "outbuffer",
  "pipelinevariable",
  "stream",
  "width",
  ...SWITCHES,
];
const base = (value: string): string => value.split(/[\\/]/).at(-1) ?? "";
const parent = (value: string): string => value.replace(/[^\\/]+$/, "") || "./";
const encodedArgument = (value: string): boolean => {
  const key = /^-([^:]+)/.exec(value)?.[1]?.toLowerCase();
  return key !== undefined && (key === "ec" || "encodedcommand".startsWith(key));
};

/**
 * A conservative reader of plain PowerShell writes. It does not execute or expand expressions;
 * callers must also retain every existing Bash rule and document the shell heuristic's limits.
 */
export function powershellWriteTargets(command: string): PowershellTargets {
  return inspect(command, 0);
}

function inspect(command: string, depth: number, cmd = false): PowershellTargets {
  if (depth > 4) return { targets: [], unsupported: "nested shell depth" };
  const lexed = tokenize(command);
  if (typeof lexed === "string") return { targets: [], unsupported: lexed };
  const targets: string[] = [];
  let unsupported: string | undefined;
  const fail = (reason: string) => {
    unsupported ??= reason;
  };
  const add = (tokens: readonly Token[] | undefined): string[] => {
    if (
      !tokens?.length ||
      tokens.some((t) => !t.literal || t.operator || t.text === "" || /^@\w/.test(t.text))
    ) {
      fail("computed write target");
      return [];
    }
    return tokens.map((t) => t.text);
  };
  const nested = (text: string, isCmd = false) => {
    const result = inspect(text, depth + 1, isCmd);
    targets.push(...result.targets);
    if (result.unsupported) fail(result.unsupported);
  };
  const analyse = (tokens: Token[]) => {
    if (tokens.length === 0) return;
    if (tokens[0]?.text === "&") tokens = tokens.slice(1);
    const first = tokens[0];
    if (!first) return;
    if (!first.literal) {
      fail("computed command");
      return;
    }
    const rawName = base(first.text)
      .toLowerCase()
      .replace(/\.exe$/, "");
    const name = ALIASES[rawName] ?? rawName;
    if (name === "invoke-expression" || name === "iex") {
      fail("Invoke-Expression");
      return;
    }
    if (/^\[(?:system\.)?scriptblock\]::create$/i.test(first.text)) {
      fail("ScriptBlock.Create");
      return;
    }
    if (/^\[(?:system\.)?io\.file\]::(?:write\w*|append\w*)$/i.test(first.text)) {
      if (tokens[1]?.text !== "(" || tokens[3]?.text !== ",") fail("computed file method target");
      else targets.push(...add(tokens[2] ? [tokens[2]] : undefined));
      return;
    }
    if (["start-process", "saps", "start"].includes(name)) {
      // ArgumentList is serialized again for the started program. Quoted arguments therefore
      // remain executable text here, rather than the data they are for an ordinary command.
      if (
        tokens
          .slice(1)
          .some(
            (token) =>
              !token.literal ||
              /^@\w/.test(token.text) ||
              /(?:^|[:\s])(?:powershell|pwsh|cmd)(?:\.exe)?(?:$|\s)/i.test(base(token.text)),
          )
      )
        fail("unreadable nested process");
      return;
    }
    if (name === "powershell" || name === "pwsh") {
      if (tokens.slice(1).some((t) => encodedArgument(t.text))) {
        fail("EncodedCommand");
        return;
      }
      const at = tokens.findIndex((t) => /^-(?:c|command)$/i.test(t.text));
      const text = tokens[at + 1];
      if (at < 0 || !text?.quoted || !text.literal || at + 2 !== tokens.length)
        fail("dynamic nested PowerShell command");
      else nested(text.text);
      return;
    }
    if (name === "cmd") {
      const at = tokens.findIndex((t) => /^\/(?:c|k)$/i.test(t.text));
      const text = tokens[at + 1];
      if (at < 0 || !text?.literal || tokens.slice(at + 1).some((t) => /[%!$]/.test(t.text)))
        fail("dynamic cmd command");
      else if (at + 2 === tokens.length && text.quoted) nested(text.text, true);
      else
        nested(
          tokens
            .slice(at + 1)
            .map((t) => (t.quoted ? `'${t.text.replace(/'/g, "''")}'` : t.text))
            .join(" "),
          true,
        );
      return;
    }
    if (!WRITERS.has(name)) return;
    const bound = bind(tokens.slice(1).filter((t) => !(cmd && /^\/[a-z]+$/i.test(t.text))));
    if (typeof bound === "string") {
      fail(bound);
      return;
    }
    const { named, positional } = bound;
    const paths = add(
      named.get("literalpath") ??
        named.get("path") ??
        named.get("filepath") ??
        (cmd && (rawName === "mkdir" || rawName === "md") ? positional.flat() : positional[0]),
    );
    if (
      [
        "set-content",
        "add-content",
        "clear-content",
        "out-file",
        "tee-object",
        "remove-item",
      ].includes(name)
    ) {
      targets.push(...paths);
      return;
    }
    if (name === "new-item") {
      targets.push(...paths);
      const names = named.get("name");
      if (names)
        for (const path of paths) for (const child of add(names)) targets.push(`${path}/${child}`);
      return;
    }
    if (name === "rename-item") {
      targets.push(...paths);
      const destinations = add(named.get("newname") ?? positional[1]);
      for (const path of paths)
        for (const dest of destinations)
          targets.push(/^(?:[a-z]:|[\\/])/i.test(dest) ? dest : `${parent(path)}${dest}`);
      return;
    }
    const destinations = add(named.get("destination") ?? positional[1]);
    if (name === "move-item") targets.push(...paths);
    for (const dest of destinations)
      targets.push(dest, ...paths.map((source) => `${dest}/${base(source)}`));
  };

  let statement: Token[] = [];
  let parens = 0;
  const invocation = (start: number): Token[] => {
    let end = start;
    let nesting = 0;
    while (end < lexed.length) {
      const token = lexed[end]!;
      if (token.operator) {
        if (nesting === 0 && /^[;|&\n{})]$/.test(token.text)) break;
        if (token.text === "(") nesting++;
        if (token.text === ")") nesting--;
      }
      end++;
    }
    return lexed.slice(start, end);
  };
  for (let i = 0; i < lexed.length; i++) {
    const token = lexed[i]!;
    if (token.quoted && !token.literal && token.text.includes("$("))
      fail("interpolated command expression");
    if (!token.quoted && /^\[(?:system\.)?io\.file\]::(?:write\w*|append\w*)$/i.test(token.text))
      analyse(lexed.slice(i));
    // Parenthesized command expressions also execute, including as another command's argument.
    if (token.operator && token.text === "(" && lexed[i + 1]?.literal) {
      let end = i + 1;
      let nesting = 1;
      while (end < lexed.length && nesting > 0) {
        if (lexed[end]?.operator && lexed[end]?.text === "(") nesting++;
        if (lexed[end]?.operator && lexed[end]?.text === ")") nesting--;
        if (nesting > 0) end++;
      }
      analyse(lexed.slice(i + 1, end));
    }
    if (
      !token.quoted &&
      /^(?:powershell|pwsh)(?:\.exe)?$/i.test(base(token.text)) &&
      invocation(i)
        .slice(1)
        .some((t) => /^-(?:c|command)$/i.test(t.text) || encodedArgument(t.text))
    )
      analyse(invocation(i));
    if (!token.quoted && /^\[(?:system\.)?scriptblock\]::create$/i.test(token.text))
      fail("ScriptBlock.Create");
    if (token.text === "&" && token.operator && statement.length === 0) {
      const next = lexed[i + 1];
      if (!next?.literal || next.operator) fail("computed command");
      statement.push(token);
      continue;
    }
    if (token.operator && /^\d*>>?$|^\*>>?$/.test(token.text)) {
      const next = lexed[++i];
      if (next?.text !== "&1" && next?.text !== "&2")
        targets.push(...add(next ? [next] : undefined));
      continue;
    }
    if (token.operator && token.text === "(") parens++;
    if (token.operator && token.text === ")") parens--;
    if (token.operator && /^[;|&\n{}]$/.test(token.text) && parens === 0) {
      analyse(statement);
      statement = [];
    } else statement.push(token);
  }
  analyse(statement);
  return unsupported
    ? { targets: [...new Set(targets)], unsupported }
    : { targets: [...new Set(targets)] };
}

function bind(tokens: Token[]): { named: Map<string, Token[]>; positional: Token[][] } | string {
  const named = new Map<string, Token[]>();
  const positional: Token[][] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    let parameter: string | undefined;
    let inline: string | undefined;
    if (token.text.startsWith("-")) {
      const [key = "", ...rest] = token.text.slice(1).split(":");
      const matches = PARAMETERS.filter((p) => p.startsWith(key.toLowerCase()));
      parameter = PARAMETERS.includes(key.toLowerCase())
        ? key.toLowerCase()
        : matches.length === 1
          ? matches[0]
          : undefined;
      if (!parameter) return "unknown write parameter";
      if (SWITCHES.has(parameter)) continue;
      if (rest.length) inline = rest.join(":");
      else i++;
    }
    const values: Token[] = [];
    if (inline !== undefined)
      values.push({
        text: inline,
        literal: !/[$(){}]/.test(inline),
        quoted: false,
        operator: false,
      });
    else {
      let current = tokens[i];
      if (current?.text === "@" && tokens[i + 1]?.text === "(") {
        let depth = 1;
        i += 2;
        while (i < tokens.length && depth > 0) {
          current = tokens[i]!;
          if (current.text === "(") depth++;
          else if (current.text === ")") depth--;
          else if (current.text !== ",") values.push(current);
          if (depth > 0) i++;
        }
        if (depth !== 0) return "malformed array argument";
      } else if (current) {
        values.push(current);
        while (tokens[i + 1]?.text === "," && tokens[i + 2]) values.push(tokens[(i += 2)]!);
      }
    }
    if (parameter) named.set(parameter, values);
    else positional.push(values);
  }
  return { named, positional };
}

/** Quoting is PowerShell quoting: backslash remains a path separator, backtick escapes. */
function tokenize(command: string): Token[] | string {
  const tokens: Token[] = [];
  let text = "";
  let literal = true;
  let quoted = false;
  let started = false;
  const flush = () => {
    if (started) tokens.push({ text, literal, quoted, operator: /^(?:\d|\*)?>>?$/.test(text) });
    text = "";
    literal = true;
    quoted = false;
    started = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (c === "`" && i + 1 < command.length) {
      const next = command[++i]!;
      if (next !== "\n" && next !== "\r") {
        text += next;
        started = true;
      }
    } else if (c === "'" || c === '"') {
      quoted = true;
      started = true;
      const quote = c;
      let closed = false;
      while (++i < command.length) {
        const next = command[i]!;
        if (next === quote) {
          if (command[i + 1] === quote) {
            text += quote;
            i++;
          } else {
            closed = true;
            break;
          }
        } else if (next === "`" && quote === '"' && i + 1 < command.length) text += command[++i];
        else {
          text += next;
          if (quote === '"' && next === "$") literal = false;
        }
      }
      if (!closed) return "unterminated PowerShell quote";
    } else if (c === "#" && !started) {
      while (i + 1 < command.length && command[i + 1] !== "\n") i++;
    } else if (/[ \t\r]/.test(c)) flush();
    else if (/[;|&>\n(),{}]/.test(c)) {
      if (c === ">" && /^(?:\d|\*)$/.test(text)) {
        text += c;
      } else if (c === ">" && text.endsWith(">")) {
        text += c;
      } else {
        flush();
        if (c === ">") {
          let operator = ">";
          if (command[i + 1] === ">") {
            operator += ">";
            i++;
          }
          tokens.push({ text: operator, literal: true, quoted: false, operator: true });
        } else if (c === "&" && /[12]/.test(command[i + 1] ?? "")) {
          tokens.push({ text: `&${command[++i]}`, literal: true, quoted: false, operator: false });
        } else tokens.push({ text: c, literal: true, quoted: false, operator: true });
      }
    } else {
      if (text.endsWith(">")) {
        tokens.push({ text, literal: true, quoted: false, operator: true });
        text = "";
        started = false;
      }
      text += c;
      started = true;
      if (c === "$") literal = false;
    }
  }
  if (text.endsWith(">")) tokens.push({ text, literal: true, quoted: false, operator: true });
  else flush();
  return tokens;
}
