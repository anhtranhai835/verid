# Releasing verid

verid is a public npm package, `@anhtranhai835/verid`, licensed under [MIT](../LICENSE).
The developer publishes it to npm separately from CI. Bundled skills retain their existing
licenses and attribution, and their public distribution is accepted.

The source repository `anhtranhai835/verid` is public. A pushed `vX.Y.Z` tag builds a public
GitHub Release with a `.tgz` tarball as an alternative to installing from npm. The GitHub
Release installers use the GitHub CLI signed in with `gh auth login`. CI does not publish to npm.

## Release a version

1. Set the version in `package.json`, `plugin/.claude-plugin/plugin.json`, and the plugin entry
   in `.claude-plugin/marketplace.json`. Run `npm install --package-lock-only` to match the lockfile.
   `test/unit/repo-rules.test.ts` checks the manifest versions.
2. Add `## [X.Y.Z] - YYYY-MM-DD` to `CHANGELOG.md` and link it to the `vX.Y.Z` release.
   The text under the version heading becomes the release notes. The initial public release
   is `1.0.0`, dated `2026-11-16`.
3. Check locally: `node scripts/release-notes.mjs vX.Y.Z` prints those notes and exits 0.
4. Open a pull request with the commit `chore(release): verid X.Y.Z`. A pull request runs the
   tests on Windows and Ubuntu, so also run the Release workflow on the branch, which adds the
   macOS and Node 24 tests without releasing:
   `gh workflow run release.yml --repo anhtranhai835/verid --ref <branch>`. Merge once both pass.
5. Tag the merge commit on `main` and push the tag:

   ```sh
   git switch main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

6. Watch the `Release` workflow: `gh run watch --repo anhtranhai835/verid`. It checks that the
   tag matches `package.json` and has a CHANGELOG entry, runs
   CI, packs the tarball, installs it and runs `verid --help` and a dry-run `verid cook`, then
   creates the Release with the notes and the `.tgz`.
7. Check the Release: `gh release view vX.Y.Z --repo anhtranhai835/verid` lists the `.tgz`.
8. Separately, the developer publishes to npm from the verified release checkout:

   ```sh
   npm ci
   npm run build
   npm pack --dry-run
   npm publish --access public
   ```

   Review the packed file list before publishing. It must include the root MIT license and
   bundled skill licenses, and exclude secrets, plans, tests, graph output and local agent state.
   Users install with `npm install -g @anhtranhai835/verid`.

To test the workflow without releasing, run it on a branch:
`gh workflow run release.yml --repo anhtranhai835/verid --ref <branch>`. Every job but the
Release runs.

## When a step fails

- Wrong tag (does not match `package.json`): delete it with `git push origin :refs/tags/vX.Y.Z`
  and `git tag -d vX.Y.Z`, fix, and tag again.
- CI or packaging fails: fix on `main` through a pull request, delete the tag as above, and tag
  the new commit.

## Withdraw a GitHub Release

Delete the Release and its tag, then release a patch version with the fix:

```sh
gh release delete vX.Y.Z --repo anhtranhai835/verid --cleanup-tag
```

Deleting the GitHub Release does not remove the npm version. Publish a fixed patch version to
npm and have users upgrade with `npm install -g @anhtranhai835/verid`. Users of the GitHub
alternative can reinstall with the installer or `VERID_VERSION`.
