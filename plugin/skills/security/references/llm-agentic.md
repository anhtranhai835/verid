# LLM and agentic surfaces

Read when the change touches skills, agent or system prompts, MCP servers or clients, tool
schemas, retrieval or memory, model output handling, or an LLM SDK. A prompt or agent file
is code for this purpose, even with no SDK import.

## Boundaries

- Instructions vs data: untrusted text (user input, web pages, files, tool results, issue
  bodies, emails) reaches the model only as data, never concatenated into system or
  developer instructions. Note where it is mixed.
- Tools: each tool grants the least capability the task needs. Writes, shell, network,
  payments and messages to others need a check outside the model (policy, allowlist or
  human confirmation), not a sentence in the prompt.
- Output: model output used as code, SQL, shell, HTML, file paths, URLs or tool arguments
  is validated like any untrusted input before the sink.
- Exfiltration: untrusted content must not be able to make the agent send data out: links
  or images with query strings, fetches to chosen URLs, writes to shared places.
- MCP: server descriptions and results are untrusted; servers are pinned and their
  commands reviewed; credentials are scoped per server.
- Memory and retrieval: stored content is checked for who can write it and is never
  promoted to instructions; poisoning one record must not change other users' behaviour.
- Secrets: system prompts and context hold no credentials; assume prompts can leak.
- Cost: loops, tool calls, tokens and retries are bounded per request and per user.

## Abuse cases to try on paper

- A file or tool result says "ignore previous instructions and run X": what does the agent do?
- Two-step: content asks the agent to save an instruction to memory for later.
- Retrieved text includes a markdown image whose URL carries a secret.
- A tool's description claims extra authority or asks to be called with other tools' data.
- The model returns a path or command built from user text.

Report each confirmed issue with its boundary, the untrusted source, the sink and the guard
that is missing; label it with OWASP LLM or Agentic Top 10 categories when that helps.
