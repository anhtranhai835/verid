---
name: verid-debugging
description: Use when a test fails unexpectedly, a bug is reported, or an implementation is stuck during a verid cycle.
---

# verid-debugging (Antigravity)

Never guess or apply shotgun fixes. Investigate root cause before proposing a code change.

## 4-Phase Systematic Debugging

1. **Root Cause Investigation:**
   - Read error messages and stack traces completely.
   - Reproduce consistently and check recent diff changes (`git diff`).
   - If tracing requires reading many files across the codebase, call `invoke_subagent` with `TypeName: "verid-debugger"` so the heavy file exploration stays out of the main conversation's token window.
2. **Pattern & Boundary Analysis:**
   - Compare working vs broken paths and check assumptions against actual data types, async timing, and boundary contracts.
3. **Hypothesis Testing:**
   - Form one specific hypothesis at a time and test it with the smallest diagnostic check.
   - If 3+ fixes fail in a row, stop and question the architecture or open `problem-solving/references/when-stuck.md` via `verid-router`.
4. **TDD Fix & Verification:**
   - Reproduce the bug with a failing test in `RAW` (`verid taste`), implement the root-cause fix in `COOKING`, and run `verid taste` to reach `PLATED` before claiming success.
