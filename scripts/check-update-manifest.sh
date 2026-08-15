#!/usr/bin/env bash
# Does the update manifest actually describe the artifact beside it?
#
# ── Why this check exists at all ──
#
# `electron-updater` does not look at the AppImage. It fetches
# `latest-linux.yml`, reads a version and a sha512 out of it, and only then
# downloads. Every interesting way that can be wrong **fails silently into "no
# update available"**, which is byte-for-byte the same outcome the client
# reports when you are already up to date:
#
#   - the manifest was not uploaded    → 404 → "no update available"
#   - the version in it did not change → no newer version → "no update"
#   - the sha512 disagrees with the file → download rejected, and the app
#     swallows updater errors by design (see `updater.js`, which logs and
#     ignores every failure so that "the network is down" never becomes "the
#     app is broken")
#
# So a broken release is indistinguishable from a healthy one from the outside.
# Nobody reports it, because nobody can tell. The only place it is catchable is
# here, before the release is published.
#
# ── What it does not check ──
#
# That the app can actually apply the update. That needs a real installed
# AppImage of an older version, a published newer one, and a launch — which is
# an end-to-end test on a machine that does not exist in CI. What this proves is
# narrower and worth stating precisely: the manifest and the artifact agree, so
# a client that reads the manifest will ask for a file it can verify.
#
# ── The published side ──
#
# Everything above checks the files on disk BEFORE upload. That is necessary and
# it is not sufficient, because the commonest way a release reaches nobody has
# nothing to do with the files: **electron-builder creates GitHub releases as
# DRAFTS**, and a draft is invisible to `electron-updater`. The client asks for
# `releases/latest`, does not see it, and reports "no update available" — the
# same words it uses when you are up to date.
#
# That is not hypothetical. It happened on BOTH releases published on
# 2026-08-14, and both times it was caught by hand. A check that depends on
# somebody remembering to look is the thing this file exists to replace, so the
# release-side assertions run here too when a repo is given.
#
# Usage:  bash scripts/check-update-manifest.sh [dist-dir]
#         RELEASE_REPO=owner/name bash scripts/check-update-manifest.sh
# Default dist-dir: electron/dist

set -uo pipefail

DIST="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/electron/dist}"
MANIFEST="$DIST/latest-linux.yml"

fail() {
  echo "✗ $*" >&2
  exit 1
}

[[ -f "$MANIFEST" ]] || fail "no $MANIFEST.

electron-builder only writes it when a \`publish\` target is configured. If this
is missing, the release is one the updater can never see — which is exactly the
silent failure this script exists for."

echo "── $MANIFEST"

# The manifest is small, flat YAML. Parsed with grep rather than a YAML
# dependency, because adding one to check three fields is a worse trade than
# being explicit about the shape we expect — and an unexpected shape makes a
# field come back empty, which is checked below.
version="$(grep -m1 '^version:' "$MANIFEST" | awk '{print $2}')"
path="$(grep -m1 '^path:' "$MANIFEST" | cut -d' ' -f2-)"
# `sha512:` appears twice — once per-file under `files:`, once at the top level.
# The top-level one is what the client verifies the download against, and it is
# the LAST occurrence in the file electron-builder writes.
sha_manifest="$(grep '^sha512:' "$MANIFEST" | tail -1 | awk '{print $2}')"

[[ -n "$version"      ]] || fail "no \`version:\` in the manifest"
[[ -n "$path"         ]] || fail "no \`path:\` in the manifest"
[[ -n "$sha_manifest" ]] || fail "no top-level \`sha512:\` in the manifest"

echo "   version: $version"
echo "   path:    $path"

# The version is checked FIRST, because it has its own failure and its own
# remedy. Checking the checksum first made a version mismatch report as "sha512
# mismatch" — true, but it points at the artifact when the problem is that the
# tag moved and `package.json` did not.
pkg_version="$(grep -m1 '"version"' "$(dirname "$DIST")/package.json" | sed -E 's/.*"([0-9][^"]*)".*/\1/')"
if [[ -n "$pkg_version" && "$version" != "$pkg_version" ]]; then
  fail "the manifest says $version and package.json says $pkg_version.

Whichever is right, they disagree, and the client believes the manifest. A
manifest repeating the installed version is a release nobody ever receives."
fi
echo "   version: agrees with package.json ✓"

# The manifest names the file as it will be UPLOADED, which is not what it is
# called on disk: `productName` is "Avoir Money", so electron-builder writes
# `Avoir-Finance-X.Y.Z.AppImage` into the manifest and leaves
# `Avoir Money-X.Y.Z.AppImage` in `dist/`. Same bytes — the sha512 matches
# either way.
#
# The first version of this resolved that by globbing on the VERSION, which is
# how a manifest naming `Avoir-Finance-9.9.9.AppImage` passed: the glob found
# the 0.9.8 file and never consulted `path` at all. So the mapping is applied in
# the direction electron-builder applies it — take each local artifact, make its
# name URL-safe, and require an exact match against `path`. A wrong filename in
# the manifest now has nothing to resolve to.
ARTIFACT=""
if [[ -f "$DIST/$path" ]]; then
  ARTIFACT="$DIST/$path"
else
  for candidate in "$DIST"/*.AppImage; do
    [[ -f "$candidate" ]] || continue
    if [[ "$(basename "$candidate" | tr ' ' '-')" == "$path" ]]; then
      ARTIFACT="$candidate"
      break
    fi
  done
fi
[[ -n "$ARTIFACT" ]] || fail "the manifest names \`$path\`, and no artifact in $DIST maps to it.

The manifest and the artifact are uploaded as separate files, so a release
carrying one and not the other is the common shape of this mistake."

# electron-builder stores the sha512 base64-encoded, not hex.
sha_actual="$(openssl dgst -sha512 -binary "$ARTIFACT" | openssl base64 -A)"

if [[ "$sha_manifest" != "$sha_actual" ]]; then
  fail "sha512 mismatch — the manifest does not describe this artifact.

  manifest: $sha_manifest
  actual:   $sha_actual

A client would download the file, fail verification, and report **no update
available**. This is the failure that is invisible from the outside."
fi
echo "   sha512:  matches the artifact ✓"

echo

# ── Is the release the client will actually fetch in a fetchable state? ──
#
# Skipped without a repo or without `gh`, because the local checks above are
# useful on their own and a missing tool must not turn a good build red. But the
# skip says so rather than passing quietly.
REPO="${RELEASE_REPO:-lancefaul/avoir-money}"
if ! command -v gh > /dev/null 2>&1; then
  echo "── published release: gh not installed. NOT CHECKED."
elif ! gh auth status > /dev/null 2>&1; then
  echo "── published release: gh not authenticated. NOT CHECKED."
else
  echo "── published release v$version in $REPO"
  state="$(gh release view "v$version" --repo "$REPO" --json isDraft,assets 2>/dev/null)"
  if [[ -z "$state" ]]; then
    echo "   no release tagged v$version yet — nothing published to check."
  else
    is_draft="$(sed -n 's/.*"isDraft":\([a-z]*\).*/\1/p' <<< "$state")"
    if [[ "$is_draft" == "true" ]]; then
      fail "release v$version is a DRAFT.

electron-builder creates drafts by default and a draft is invisible to
electron-updater: the client asks for \`releases/latest\`, does not find it, and
reports **no update available** — indistinguishable from being up to date. The
release looks published in the web UI and reaches nobody.

  gh release edit v$version --repo $REPO --draft=false"
    fi
    echo "   published, not a draft ✓"

    # The manifest is a separate upload from the artifact, and the updater reads
    # the manifest FIRST. A release carrying the AppImage but not the yml is the
    # exact shape that fails silently.
    for want in latest-linux.yml "$path"; do
      grep -q "\"name\":\"$want\"" <<< "$state" \
        || fail "release v$version has no asset named \`$want\`.

The updater fetches latest-linux.yml first and the artifact it names second.
Either one missing produces \"no update available\" and no error anywhere."
    done
    echo "   latest-linux.yml and $path both attached ✓"
  fi
fi

echo
echo "✓ the manifest describes the artifact beside it."
