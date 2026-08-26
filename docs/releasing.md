# Prerelease publication

Agent RP publishes npm prereleases as `@hewzhew/dsh-agent-rp` under the `next` dist-tag. A published version is immutable; a bad release is deprecated and `next` is moved back to a known-good version instead of overwriting or routinely unpublishing it.

## Release policy

- The version in `package.json` and GitHub tag must match exactly as `0.0.0-rc.N` and `v0.0.0-rc.N`.
- The tagged commit must already belong to `main`, and the GitHub Release must be marked as a prerelease.
- The package job runs on a GitHub-hosted Windows runner so the checked-in browser vendor payloads are verified with their canonical generation toolchain; every platform installs the same audited tarball.
- `.github/workflows/publish-prerelease.yml` builds and packs once, audits that exact tarball, and passes the retained artifact to the publish job.
- npm publication uses GitHub OIDC trusted publishing with provenance. The repository does not store an npm automation token.
- User installation documentation changes only after a clean install and an update from an older npm prerelease both succeed.

Run the same package checks locally before preparing the release commit:

```powershell
pnpm install --frozen-lockfile
pnpm pack --out .release-dist/dsh-agent-rp.tgz
$version = node -p "require('./package.json').version"
node scripts/check-prerelease-package.mjs --tag "v$version" --tarball .release-dist/dsh-agent-rp.tgz
```

The pack lifecycle runs the vendored-runtime check, product build, published-import consumers, and prerelease manifest policy before producing the tarball.

## Installer promotion

The Windows, macOS, and Linux installers default to `@hewzhew/dsh-agent-rp@next`. Keep the explicit plugin-source option for local directories and review branches, but do not point ordinary installs at `main`. Before changing user documentation for a new package line, verify the published tarball from a clean DSH home, rerun the installer against the same profile to exercise the update path, and start the resulting web profile once. The installer scripts and pinned Agent Host runner files remain hosted on GitHub; the plugin payload and its transitive dependencies come from the selected npm registry.

## One-time npm bootstrap

The first publication must reserve the previously unused package name before npm can attach a trusted publisher to it. This is the only non-OIDC publication. A maintainer signs in interactively with `npm login --auth-type=web`, publishes the already audited tarball with `--access public --tag next --provenance=false`, and then runs `npm logout`. The explicit override is required because local terminals cannot issue CI provenance. Do not create or paste an npm automation token into GitHub, a terminal transcript, an Issue, or repository settings.

Immediately after the package exists, configure its npm trusted publisher with:

- repository owner: `hewzhew`
- repository: `dsh-agent-rp`
- workflow: `publish-prerelease.yml`
- GitHub environment: `npm`

All later releases are created as GitHub prereleases from an exact `v0.0.0-rc.N` tag. The workflow must be the only publisher after bootstrap.

After one OIDC release succeeds, set npm Publishing access to “Require two-factor authentication and disallow tokens”. The trusted publisher remains authorized because it uses short-lived OIDC credentials rather than a traditional npm token.

## Recovery

If a release is unusable, preserve its GitHub Release and provenance record, mark the npm version deprecated with a concrete reason, and move `next` back to the last verified version. Publish a new incremented rc for the fix. Unpublish only when npm policy, credential exposure, or a legal requirement makes removal necessary.
