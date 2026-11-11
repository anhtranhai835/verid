# Iterative mode and options — verid:edge-cases

Read this when one pass is not enough: a fixed number of iterations, a run until no new
scenario appears, or a domain, focus or output format other than the default.

## Options

| Option       | Default | Purpose                                                                                   |
| ------------ | ------- | ----------------------------------------------------------------------------------------- |
| Iterations N | —       | Bounded loop: run exactly N iterations, then stop with summary                            |
| Saturation   | off     | Saturation loop: keep iterating until 2 consecutive iterations produce no novel scenarios |
| Domain       | auto    | Domain hint: `software`, `product`, `business`, `security`, `marketing`                   |
| Focus        | auto    | Prioritize dimension: `edge-cases`, `failures`, `security`, `scale`                       |
| Format       | table   | Output format: `table`, `use-cases`, `test-scenarios`, `threat-scenarios`                 |

When neither iterations nor saturation is asked for, use the one pass in `SKILL.md`.

## Workflow

Iterative mode runs the loop described in `saturation-loop.md`. Summary:

1. **Read** target and build understanding (actors, components, preconditions)
2. **Filter dimensions** — same as one pass
3. **Loop** — each iteration:
   a. Pick highest-priority unexplored dimension or combination
   b. Generate **one** concrete situation (specific trigger, flow, expected outcome)
   c. **Classify** against all previously kept situations:
   - **New**: different dimension AND different trigger/precondition → KEEP
   - **Variant**: same dimension but different actor, data, or outcome → KEEP
   - **Duplicate**: same dimension + same trigger + same outcome → DISCARD
   - **Out of scope / Low value** → DISCARD, note the reason
     d. If kept: expand edge cases (what-if, boundary, interruption, ordering, missing data, stale data)
     e. Add a row to the scenario log in your reply (you write no file for it)
     f. Every 5 iterations: print progress summary (format in `saturation-loop.md`)
4. **Halt**:
   - iterations N: stop after N iterations
   - saturation: stop when 2 consecutive iterations produce zero `New` classifications
5. **Output** final summary with coverage matrix and composite score

**Force dimension rotation** after 3 consecutive same-dimension iterations. Rotate through:
Dimension walk → Combination → Negation → Amplification → Persona shift → Temporal shift

## Output

### Scenario log (in the reply)

```
iteration	dimension	classification	severity	title	description	parent
1	happy_path	new	-	Successful checkout	User completes standard checkout	-
2	error_path	new	HIGH	Payment declined	Card rejected during checkout	-
3	edge_case	duplicate	-	Empty cart	Already covered by #1	#1
```

### Final summary

```
## Scenario Report: AC-1 [target]  (iterations: N)

[Full table of kept scenarios, grouped by dimension]

### Coverage Matrix
[dimension × severity grid]

### Composite Score: NNN
  scenarios_generated * 10  = X
  edge_cases_found * 15     = X
  dimensions_covered * 30   = X
  unique_actors * 5         = X
  high_severity * 3         = X

### Saturation
Halted: [after N iterations — bounded] | [saturation — 2 consecutive iterations with no novel cases]
```
