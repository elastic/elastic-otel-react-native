# Releasing

This guide describes how to publish EDOT React Native to npm as
[`@elastic/otel-react-native`](https://www.npmjs.com/package/@elastic/otel-react-native).

## Release steps

A release from `main` takes three steps: dispatch the preparation, merge the
preparation PR, then merge the resulting PR into `main`. The version is
derived from the highest release tag and the release-note content. Merging
the preparation PR is what publishes.

### 1. Prepare the release

Use either path:

- Ask an agent to prepare the release with the
  [`react-native-release-wizard`](skills/react-native-release-wizard/SKILL.md)
  skill. It proposes the notes and resulting version, then dispatches after
  you approve.
- Open the
  [Prepare release workflow](https://github.com/elastic/elastic-otel-react-native/actions/workflows/prepare-release.yml)
  on `main` and provide the release-note JSON.

The workflow verifies that `package.json` holds the next-minor `-SNAPSHOT`
version after the highest release tag, then creates two branches from the
dispatched `main` commit:

- `releasing/x.y.z`, an unchanged copy of `main` that lives until the
  release is finished.
- `prepare/x.y.z`, with one commit: the release version, the release notes,
  and the regenerated `NOTICE.txt`.

It opens the preparation PR from `prepare/x.y.z` into `releasing/x.y.z`, so
the PR diff shows exactly what the release adds. Review it. Push prose or
NOTICE fixes to `prepare/x.y.z` if needed. For a code fix, land it on `main`,
close the PR, delete both branches, and dispatch again. If no pull request
merged since the previous release, the run succeeds, creates nothing, and
says so in a warning on the run page.

#### Release-note JSON

The
[Draft release notes workflow](https://github.com/elastic/elastic-otel-react-native/actions/workflows/draft-release-notes.yml)
builds editable JSON from the pull requests merged since the last release. It
shows the JSON in its run summary and attaches it to the run as the
`release-notes` artifact. Labels only group the draft; none is required:

- `dependencies` → `dependencies`. Several updates of one dependency collapse
  into the last one merged.
- `enhancement` → `featuresEnhancements`
- `bug` → `fixes`
- anything else → `uncategorized`

Move every `uncategorized` item into a category or delete it. Add
`"breaking": true` to a breaking item. Any breaking item makes the release
major; otherwise it is minor. Prepare release rejects JSON that still has
`uncategorized` items, has no items, or has a `message` that starts with
`[Breaking]`; the flag adds that prefix when the notes are rendered.

Each item has a `message`, an optional `prId`, and an optional boolean
`breaking`:

```json
{
  "dependencies": [{ "message": "Update EDOT Android", "prId": "41" }],
  "featuresEnhancements": [
    {
      "message": "Improve automatic interaction instrumentation",
      "prId": "42"
    },
    {
      "message": "Remove a deprecated configuration option",
      "prId": "43",
      "breaking": true
    }
  ],
  "fixes": [
    { "message": "Fix configuration file loading on iOS", "prId": "44" }
  ],
  "uncategorized": []
}
```

### 2. Merge the preparation PR

When the checks are green and the content is right, merge the preparation PR
into `releasing/x.y.z`. The merge starts the
[Publish release workflow](https://github.com/elastic/elastic-otel-react-native/actions/workflows/publish-release.yml),
which:

1. Confirms the merged commit carries release version `x.y.z` and that no
   `vx.y.z` tag exists yet.
2. Publishes `@elastic/otel-react-native` `x.y.z` to npm from the merged
   commit.
3. Creates the `vx.y.z` tag at the merged commit.
4. Creates the GitHub Release.
5. For a release from `main`, commits the next `-SNAPSHOT` version on
   `releasing/x.y.z` and opens its PR into `main`.
6. For a patch, opens a notes-only PR into `main`.
7. Deletes `prepare/x.y.z`. For a patch, it also deletes `patching/x.y.z` and
   `releasing/x.y.z`. The branch of the PR into `main` stays until you merge
   that PR and delete it, because this repository does not delete merged
   branches.

The team's Slack channel receives a start message once the merged commit is
confirmed, with the version, the merged PR, the release commit, and the run.
It then receives the outcome with links to the GitHub Release and the release
PR, or to the failed run.

### 3. Merge the PR into main

For a release from `main`, review and merge the PR from `releasing/x.y.z`.
It brings the release notes, `NOTICE.txt`, and the next development version
to `main`. After merging, delete `releasing/x.y.z` by hand: this repository
does not delete merged branches, and Prepare release stops while any
`releasing/*` branch exists, naming it.

For a patch, review and merge the notes-only PR from
`patch-notes/x.y.z`, then delete `patch-notes/x.y.z` by hand. The publish
workflow has already deleted `patching/x.y.z` and `releasing/x.y.z`.

## Patch release

Use the release wizard or the
[Start patch workflow](https://github.com/elastic/elastic-otel-react-native/actions/workflows/start-patch.yml)
on `main`. Supply the `X.Y` release line and, optionally, merged `main` pull
requests to cherry-pick, as numbers separated by commas, such as `12,34`.
The wizard proposes `bug`-labeled candidates merged after the source tag.

Start patch selects the highest `vX.Y.Z` tag, creates
`patching/X.Y.(Z+1)` from it, and cherry-picks the selected fixes. It pushes
only after every cherry-pick succeeds. Add later fixes by opening pull
requests into the patch branch. A pull request that changes
`.github/workflows/*` cannot be cherry-picked by Start patch: if its push is
rejected, dispatch again without that pull request and add it through a pull
request into the patch branch.

The branch releases with the workflows of its tag.

Draft release notes with the wizard or by dispatching the Draft release notes
workflow on `patching/x.y.z`; the draft then covers only that branch's
changes. Edit the notes, then dispatch Prepare release from that branch.
Review and merge the preparation PR to publish. Finally, merge the notes-only
PR into `main` and delete `patch-notes/x.y.z`. The publish workflow deletes
`patching/x.y.z` and `releasing/x.y.z`.

A patch on an older line than the npm `latest` version, such as `0.1.1`
after `0.2.0`, is published with the `latest-X.Y` dist-tag, here
`latest-0.1`, and `latest` stays on the newer version. Users install it
with `npm install @elastic/otel-react-native@latest-0.1`.

## Failure and recovery

Use **Re-run failed jobs** on the failed publish run. Every publish and
finalization step checks the real system before acting and skips work that is
already done, so the rerun continues from the failed step.

- A version that is already on the npm registry counts as published. The
  rerun skips the publish and continues with the tag and the GitHub Release.
- If the npm registry is down, wait for it to recover, then rerun.
- If the run log says the tag already exists, do not push or move it. Rerun so
  the remaining steps finish.
- If a tag exists at another commit, stop. Do not move it.
- If the preparation PR needs different content before it is merged, close
  it, delete both branches, land the correction on `main`, and prepare again.
- If opening the preparation PR fails, Prepare release deletes
  `releasing/x.y.z` and `prepare/x.y.z` and fails; dispatch again. If its log
  says it could not delete them, delete both by hand first. The next dispatch
  refuses while a `releasing/*` branch exists.
- Token or secret failures require help from whoever owns the repository's
  token policies and secrets.
- Start patch stops when the line has no release or the patch branch already
  exists. For an existing branch, add fixes through pull requests into it.
- If a Start patch cherry-pick conflicts, dispatch again without that pull
  request. Cherry-pick it by hand through a pull request into the named patch
  branch.
