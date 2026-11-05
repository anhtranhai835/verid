# Supply chain and dependency evidence

## When an audit is required

Required when the change adds, removes or upgrades a dependency, edits a lockfile, or
changes install, build, CI or generator scripts. Otherwise write the audit as not
applicable with that reason; do not ask for one.

## What to check without commands

- New or changed packages: exact name and scope, the registry or source, version range,
  whether the lockfile pins it with an integrity hash, and install or postinstall scripts.
- Lockfile agrees with the manifest; no unexplained registry, git or tarball sources.
- CI: least `permissions`, no secrets exposed to forks, `pull_request_target` never runs
  untrusted checkout, third party actions pinned by commit SHA.
- Build and container steps verify downloads (checksum or signature) and do not pipe a
  download into a shell.
- Code written with model help may name packages that do not exist or lookalikes
  (slopsquatting): check each new name against the lockfile and its documented source.

## Reading audit evidence

The dispatcher runs the audit for the stack and gives you the command, cwd, exit status and
saved output. Cite the file. Common commands, to be confirmed against the tool version
installed in the project:

| Stack           | Command                                                     |
| --------------- | ----------------------------------------------------------- |
| npm             | `npm audit --json`; signatures: `npm audit signatures`      |
| pnpm            | `pnpm audit --json`                                         |
| Yarn            | `yarn npm audit --json` (Berry) or `yarn audit --json` (v1) |
| Python          | `pip-audit -f json`                                         |
| Go              | `govulncheck ./...`                                         |
| Rust            | `cargo audit --json`                                        |
| Ruby            | `bundle-audit check --update`                               |
| PHP             | `composer audit --format=json`                              |
| .NET            | `dotnet list package --vulnerable --include-transitive`     |
| Java            | OWASP Dependency-Check (Maven or Gradle plugin)             |
| Many ecosystems | `osv-scanner` on the lockfile                               |

- Many audit tools exit non-zero when they find vulnerabilities; that is a result, not a
  tool failure. A network or registry error, truncated output, or a lockfile other than the
  reviewed one is not clean evidence: mark the audit `blocked`.
- No findings in an audit does not show a package is benign or that the code is safe.
- Severity follows exploitability in this code path; a CVE in an unused function of a dev
  dependency is not automatically High.
