#!/usr/bin/env bash
# Does the desktop actually show the icon this build ships?
#
# ── Why this is not in the installer, which is where it was first asked for ──
#
# The installer is already correct. Arch ships
# `/usr/share/libalpm/hooks/gtk-update-icon-cache.hook`, our package owns
# `usr/share/icons/hicolor/`, and the system cache was verified rebuilt at the
# exact second of the 0.9.8 upgrade. Nothing to add there.
#
# What broke was `~/.local/share/icons`, which OUTRANKS `/usr/share/icons` in
# XDG lookup. Six stale PNGs sat there and won, so a correct package install
# displayed the previous icon. The pacman scriptlet is the wrong place to fix
# that for three reasons: it runs as root and would have to guess which user's
# home to reach into; a package manager deleting user-owned files outside its
# own manifest is an anti-pattern; and it would do nothing for AppImage users,
# who run no installer at all.
#
# ── What actually went wrong, which is the thing worth catching ──
#
# The icon was verified INSIDE the package — byte-identical, correct at every
# size — and reported as done. That verification was accurate and answered the
# wrong question. What the desktop displays is not what a package contains; it
# is whatever XDG resolution finds FIRST across a search path with the user
# directory at the front. Verifying an artifact is not verifying what the
# system loads, the same way checking that a binary was built is not checking
# which binary is running.
#
# So this checks resolution order, not package contents.
#
# It is also the second time the same shadowing has cost an evening: an earlier
# session found duplicate `avoir-desktop.desktop` entries with the same cause
# (the app was called Avoir Finance then; the name changed, the failure did not).
# Those were cleared and the icons beside them were not, because nothing looked
# for them — clearing one file type does not reveal the other.
#
# Read-only. It never deletes anything; it prints the command and exits
# non-zero so it can gate a release.

set -uo pipefail

APP="avoir-money"
SIZES=(32x32 48x48 64x64 128x128 256x256 512x512)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT/electron/icons"

# `~/.local/share` first: that is the order XDG searches, and reproducing it
# here rather than assuming it is the entire point of the script.
USER_ICONS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
SYS_ICONS="/usr/share/icons/hicolor"

problems=0
note() { printf '  %s\n' "$*"; }

echo "── what is installed"
if command -v pacman >/dev/null && pacman -Q "$APP" >/dev/null 2>&1; then
  note "$(pacman -Q "$APP")"
else
  note "not installed via pacman (AppImage, or not installed)"
fi

echo
echo "── the icon this build ships"
if [[ ! -d "$SOURCE_DIR" ]]; then
  note "no $SOURCE_DIR — run from the repo to compare against the built icons"
  exit 0
fi
note "$SOURCE_DIR ($(ls "$SOURCE_DIR"/*.png 2>/dev/null | wc -l) sizes)"

echo
echo "── what XDG lookup resolves to, in search order"
for s in "${SIZES[@]}"; do
  src="$SOURCE_DIR/$s.png"
  [[ -f "$src" ]] || continue

  user="$USER_ICONS/$s/apps/$APP.png"
  sys="$SYS_ICONS/$s/apps/$APP.png"

  if [[ -f "$user" ]]; then
    # A user-level copy always wins. Whether that is a problem depends on
    # whether it is CURRENT — an up-to-date shadow is invisible until the next
    # icon change, which is exactly how this went unnoticed through eight
    # builds.
    if cmp -s "$user" "$src"; then
      note "$s  ~/.local (shadows /usr, but matches this build)"
    else
      note "$s  ~/.local  ✗ STALE — this is what you are seeing"
      problems=$((problems + 1))
    fi
  elif [[ -f "$sys" ]]; then
    if cmp -s "$sys" "$src"; then
      note "$s  /usr/share  ✓"
    else
      note "$s  /usr/share  ✗ differs from this build — reinstall the package"
      problems=$((problems + 1))
    fi
  else
    note "$s  (not installed anywhere)"
  fi
done

echo
echo "── desktop entries"
mapfile -t entries < <(
  ls "${XDG_DATA_HOME:-$HOME/.local/share}/applications/$APP.desktop" \
     "/usr/share/applications/$APP.desktop" 2>/dev/null
)
if [[ ${#entries[@]} -gt 1 ]]; then
  note "✗ ${#entries[@]} entries — the ~/.local one wins and may point anywhere:"
  printf '      %s\n' "${entries[@]}"
  problems=$((problems + 1))
elif [[ ${#entries[@]} -eq 1 ]]; then
  note "${entries[0]}"
  # `Icon=` is a NAME, not a path, and a wrong one fails silently by falling
  # back to a stock image rather than by erroring.
  icon_key="$(grep -m1 '^Icon=' "${entries[0]}" | cut -d= -f2-)"
  if [[ "$icon_key" == "$APP" ]]; then
    note "Icon=$icon_key ✓"
  else
    note "✗ Icon=$icon_key — expected '$APP'"
    problems=$((problems + 1))
  fi
else
  note "no desktop entry found"
fi

echo
if [[ $problems -eq 0 ]]; then
  echo "✓ the desktop resolves this build's icon at every size."
  exit 0
fi

cat <<EOF
✗ $problems problem(s). The package is probably fine — check what is shadowing it.

To clear stale user-level copies (this script will not do it for you):

    rm ~/.local/share/icons/hicolor/*/apps/$APP.png
    rm -f ~/.local/share/applications/$APP.desktop
    gtk-update-icon-cache -f ~/.local/share/icons/hicolor
    kbuildsycoca6   # KDE; GNOME picks it up on its own

Nothing in the install path creates those — pacman writes only to /usr, and
Arch's own hook rebuilds the system cache. They come from hand-copying during
debugging, which is how they got there both times.
EOF
exit 1
