#!/usr/bin/env bash
# Verify the installed application against the package manager's own record.
#
# ── WHY THIS IS NOT AN APPLICATION FEATURE ──
#
# The v1.0 backlog carried "tamper detection: app checks its own integrity on
# launch, refuses to run if signature verification fails". That cannot be built
# honestly here, for two reasons found by measuring rather than by design
# review (2026-08-12):
#
#   1. There is no signature. Signed binaries need a certificate and a macOS or
#      Windows target; neither exists, and both moved to v2.0.
#
#   2. A check that runs INSIDE the artifact it checks defends against nobody.
#      Whoever can modify `/opt/Avoir Money/resources/app.asar` can modify the
#      code doing the checking — it is in the same asar. That is not an
#      implementation flaw to engineer around, it is the shape of the problem:
#      trust cannot be bootstrapped from inside the thing you do not trust.
#
# The package manager has what the app cannot: an EXTERNAL record, written at
# install time and kept somewhere the application does not control. Every file
# this package ships carries a sha256 in the package database, and `pacman -Qkk`
# already verifies them. Nothing needed building — it needed reading.
#
# ── WHY THE OWNERSHIP WARNINGS ARE FILTERED, AND WHY THAT IS NOT HIDING ──
#
# `pacman -Qkk` reports `UID mismatch` and `GID mismatch` for all 172 files.
# That is not a finding. `fpm` 1.9.3 — the packager electron-builder uses —
# writes no `uid=`/`gid=` fields into the package's `.MTREE` at all, so pacman
# has nothing to compare against and says so per file. The files ARE root-owned
# on disk; the package simply never recorded an expectation.
#
# Verified rather than assumed: the `.MTREE` carries `md5digest` and
# `sha256digest` for every entry and no ownership fields, and an installed
# file's sha256 matches its recorded one exactly.
#
# So the filter removes a property that cannot be checked, and leaves every
# property that can. A CONTENT change still reports — which is the thing worth
# knowing, and the thing currently invisible among 344 lines of noise.

set -uo pipefail

PKG="avoir-money"

echo "── what is installed"
if ! command -v pacman > /dev/null 2>&1; then
  echo "  not a pacman system — this script only knows how to ask pacman."
  echo "  On dpkg: 'debsums -c ${PKG}'. On an AppImage: nothing installed a"
  echo "  record, so there is no external answer to compare against, and the"
  echo "  honest check is the sha512 in the release's latest-linux.yml."
  exit 0
fi

if ! pacman -Q "$PKG" > /dev/null 2>&1; then
  echo "  ${PKG} is not installed (an AppImage run does not register)."
  exit 0
fi
pacman -Q "$PKG" | sed 's/^/  /'

echo
echo "── verifying every shipped file against the package database"

out="$(pacman -Qkk "$PKG" 2>&1)"

# Everything except the ownership lines the package cannot express, and the
# summary line, which counts those as "altered" and is therefore misleading.
real="$(grep -viE 'UID mismatch|GID mismatch|[0-9]+ total files' <<< "$out")"
total="$(pacman -Qlq "$PKG" 2>/dev/null | wc -l)"

if [[ -n "${real//[[:space:]]/}" ]]; then
  echo "  MODIFIED FILES — the installed app no longer matches what was packaged:"
  sed 's/^/    /' <<< "$real"
  echo
  echo "  This means the files on disk differ from the package that installed"
  echo "  them. An interrupted upgrade explains it; so does something editing"
  echo "  the application. Reinstall to restore: sudo pacman -S ${PKG}"
  exit 1
fi

echo "  ${total} files, all matching their recorded checksums ✓"
echo
echo "  Ownership is not checked and cannot be: fpm records no uid/gid in the"
echo "  package, so pacman reports all ${total} files as mismatched on that"
echo "  property alone. Content is what this verifies, and content is intact."
