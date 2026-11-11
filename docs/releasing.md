# Releasing verid

verid is released only as a `.tgz` on a GitHub Release of the private repository
`anhtranhai835/verid`. The package bundles copyrighted skill content: it is marked `private`, so
`npm publish` refuses it, and nothing may be published to a registry or a public repository.

## Release a version

1. Set the new version in all three files: `package.json`, `plugin/.claude-plugin/plugin.json`
   and `plugin/antigravity/plugin.json`. `test/unit/repo-rules.test.ts` fails when they differ.
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and add a new empty
   `## [Unreleased]` above it. The text under the version heading becomes the release notes.
3. Check locally: `node scripts/release-notes.mjs vX.Y.Z` prints those notes and exits 0.
4. Open a pull request with the commit `chore(release): verid X.Y.Z`; merge it once CI passes.
5. Tag the merge commit on `main` and push the tag:

   ```sh
   git switch main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

6. Watch the `Release` workflow: `gh run watch --repo anhtranhai835/verid`. It checks that the
   repository is private and that the tag matches `package.json` and has a CHANGELOG entry, runs
   CI, packs the tarball, installs it and runs `verid --help` and a dry-run `verid cook`, then
   creates the Release with the notes and the `.tgz`.
7. Check the Release: `gh release view vX.Y.Z --repo anhtranhai835/verid` lists the `.tgz`.

To test the workflow without releasing, run it on a branch:
`gh workflow run release.yml --repo anhtranhai835/verid --ref <branch>`. Every job but the
Release runs.

## When a step fails

- Wrong tag (does not match `package.json`): delete it with `git push origin :refs/tags/vX.Y.Z`
  and `git tag -d vX.Y.Z`, fix, and tag again.
- CI or packaging fails: fix on `main` through a pull request, delete the tag as above, and tag
  the new commit.

## Withdraw a release

Delete the Release and its tag, then release a patch version with the fix:

```sh
gh release delete vX.Y.Z --repo anhtranhai835/verid --cleanup-tag
```

Users who installed the withdrawn version reinstall with the installer or `VERID_VERSION`.
