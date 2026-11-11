# Independent modules

Propose stations only for modules with disjoint file ownership and already served
dependencies in a prep/recipe monorepo. Keep shared configuration and barrel exports
in an earlier prerequisite. Never infer independence from module names alone.

Before the first AC, write `Boundary: src/identity/**, test/identity/**` and, when
needed, `Depends: foundation`. Paths are relative; `*`, `**`, `?` use the manifest
glob rules. Potential glob intersections are conservatively rejected.

The developer commits planning inputs, orders each module and runs
`verid station <module>` from the primary worktree. Open one fresh provider session
at each printed path. Use existing writer and reviewer roles within that root;
never dispatch writers from the primary session into other worktrees.

Inside a station, keep the usual RAW → COOKING → PLATED → independent review → serve.
Commit the completed work. Only developer `verid station close <module>` squashes
and runs taste on the primary tree. A station's serve is provisional until that
integration passes. Conflict or failed tests retain the station.

No-brain can opt into `stations: 2` or `3` before signing. Default `1` remains serial;
retry counters and conversation ownership stay local to each station. The product
module stays on the primary tree after integrations. The board shows separate
TDD cards and station conversations. Real-provider token/time comparisons are
pending; do not promise savings.
