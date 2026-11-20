export const powershellQuote = (char: string): "'" | '"' | undefined => {
  if ("'‘’‚‛".includes(char)) return "'";
  if ('"“”„'.includes(char)) return '"';
  return undefined;
};

interface ShellSpan {
  start: number;
  end: number;
  kind: "quote" | "ansi" | "expansion" | "escape" | "comment" | "incomplete";
}

/** Only complete literal quotes may conceal shell syntax. */
export function shellSpans(command: string, powershell = false): ShellSpan[] {
  const spans: ShellSpan[] = [];
  const quoteOf = (char: string) =>
    powershell ? powershellQuote(char) : char === "'" || char === '"' ? char : undefined;
  const escapeChar = powershell ? "`" : "\\";
  let wordStart = true;
  let backtick = false;
  for (let i = 0; i < command.length; ) {
    const start = i;
    const char = command[i++]!;
    if (char === "#" && wordStart) {
      const end = command.indexOf("\n", i);
      i = end === -1 ? command.length : end;
      spans.push({ start, end: i, kind: "comment" });
    } else if (powershell && wordStart && char === "<" && command[i] === "#") {
      const end = command.indexOf("#>", i + 1);
      i = end === -1 ? command.length : end + 2;
      spans.push({ start, end: i, kind: end === -1 ? "incomplete" : "comment" });
    } else if (char === escapeChar) {
      const next = command[i];
      if (next !== undefined) i++;
      spans.push({ start, end: i, kind: next === undefined ? "incomplete" : "escape" });
      if (next !== "\n") wordStart = false;
    } else if (!powershell && char === "`") {
      backtick = !backtick;
      wordStart = backtick;
    } else {
      const ansi = !powershell && char === "$" && command[i] === "'";
      const quote = ansi ? "'" : quoteOf(char);
      if (quote === undefined) {
        wordStart = /[ \t\r\n;&|<>()]/.test(char) || (powershell && /[{},]/.test(char));
        continue;
      }
      if (ansi) i++;
      let expands = false;
      let closed = false;
      while (i < command.length) {
        const next = command[i++]!;
        const following = command[i];
        if (ansi && next === "\\" && following !== undefined) i++;
        else if (quoteOf(next) === quote) {
          if (powershell && following !== undefined && quoteOf(following) === quote) i++;
          else {
            closed = true;
            break;
          }
        } else if (quote === '"') {
          if (
            next === escapeChar &&
            following !== undefined &&
            (powershell || /["\\$`\n]/.test(following))
          ) i++;
          else if (!powershell && (next === "`" || (next === "$" && following === "("))) {
            // Nested commands can contain their own quotes. Leave their syntax visible.
            i = command.length;
            break;
          } else if (next === "$") expands = true;
        }
      }
      const kind = ansi ? "ansi" : expands ? "expansion" : "quote";
      spans.push({ start, end: i, kind: closed ? kind : "incomplete" });
      wordStart = false;
    }
  }
  return spans;
}

const HEREDOC = /(?<!<)<<-?[ \t]*(['"]?)([\w.-]+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g;

export function stripBashHeredocs(command: string): string {
  let spans: ShellSpan[] | undefined;
  // A heredoc starts only at a shell operator outside quoted words and comments.
  return command.replace(HEREDOC, (match, _quote, delimiter, suffix, start: number) =>
    (spans ??= shellSpans(command)).some((span) => start >= span.start && start < span.end)
      ? match
      : `<<${delimiter}${suffix}`,
  );
}

export function renderShell(
  command: string,
  spans: readonly ShellSpan[],
  render: (text: string, span: ShellSpan) => string,
): string {
  let previous = 0;
  let result = "";
  for (const span of spans) {
    result += command.slice(previous, span.start);
    result += render(command.slice(span.start, span.end), span);
    previous = span.end;
  }
  return result + command.slice(previous);
}
