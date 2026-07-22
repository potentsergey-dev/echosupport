# Demo To Main Release Transfer

Use this runbook when the demo repository has been verified and the changes are ready to move into the main `Echosupport` repository for a public GitHub release.

## Assumptions

- `echosupport-demo` is the working and verification repository.
- `echosupport` is the main public release repository.
- The demo work is committed and the working tree is clean before transfer.
- The main repository has no unrelated local work, or that work has been committed/stashed separately.

## 1. Freeze The Demo Candidate

From `echosupport-demo`:

```bash
git status --short
git log --oneline -10
pnpm --filter @echosupport/backend db:generate
pnpm -r typecheck
pnpm --filter @echosupport/backend test
pnpm build:prod
pnpm check:release
```

Expected result: the working tree is clean and every check passes.

If a VPS candidate is used, deploy the exact demo commit and complete `docs/testing/vps-lite-pro-smoke-test.md` before continuing.

## 2. Create A Transfer Bundle

From `echosupport-demo`, create a patch series from the last main-release commit or from the agreed transfer base:

```bash
git log --oneline
# Replace BASE_COMMIT with the commit that already exists in the main repository.
git format-patch BASE_COMMIT..HEAD -o C:/tmp/echosupport-transfer-patches
```

Alternative for a full source snapshot when histories are hard to align:

```bash
git archive --format=tar -o C:/tmp/echosupport-release-candidate.tar HEAD
```

Prefer patches when possible because they preserve authorship, commit messages, and reviewable history.

## 3. Apply To The Main Repository

From `echosupport`:

```bash
git status --short
git checkout main
git pull --ff-only
```

Apply the patch series:

```bash
git am C:/tmp/echosupport-transfer-patches/*.patch
```

If conflicts occur, resolve them in the main repository, then continue:

```bash
git status
git am --continue
```

If the patch path is not practical, copy the verified source snapshot into a temporary directory and compare with `git diff --no-index` before replacing files. Do not overwrite `.env`, local uploads, database volumes, or deployment-only files.

## 4. Verify Main Repository

From `echosupport`:

```bash
pnpm install --frozen-lockfile
pnpm --filter @echosupport/backend db:generate
pnpm -r typecheck
pnpm --filter @echosupport/backend test
pnpm build:prod
pnpm check:release
```

Then run a Docker smoke test:

```bash
docker compose up -d --build
curl -i http://localhost:8080/api/v1/ready
```

Complete the Lite and PRO checks in `docs/release-checklist.md`.

## 5. Prepare The Public Release

- Move the relevant `CHANGELOG.md` entries from `Unreleased` into a dated version section.
- Bump versions in all workspace `package.json` files together when the release version changes.
- Re-run `pnpm check:release`.
- Commit the release preparation changes.
- Create the release tag only after checks are green:

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

## 6. Post-Release Verification

After GitHub publishes the release artifacts, install from the released source/tag on a clean host and verify:

- `/api/v1/ready` is green.
- Lite setup works with documents and OpenRouter keys.
- PRO handoff, browser notifications, appointments, group bookings, and CSAT work.
- Backup and restore guidance is still accurate.

Do not publish the release as ready for users until the clean-host smoke test passes.
