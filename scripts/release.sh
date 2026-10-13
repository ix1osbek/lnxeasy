#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
    printf 'Usage: scripts/release.sh VERSION   (for example: scripts/release.sh 0.2.0)\n' >&2
    exit 1
fi

VERSION="$1"

case "$VERSION" in
    *[!0-9.]* | "" | .* | *.) printf 'Error: "%s" is not a version like 0.2.0\n' "$VERSION" >&2; exit 1 ;;
esac

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
    printf 'Error: commit or stash your changes first.\n' >&2
    exit 1
fi

sed -i "s/^  \"version\": \".*\",$/  \"version\": \"$VERSION\",/" package.json

TREE_SHA256="$(
    git ls-files -z | grep -zv '^install\.sh$' | sed -z 's#^#./#' | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
)"

sed -i "s/^VERSION=\".*\"$/VERSION=\"$VERSION\"/" install.sh
sed -i "s/^TREE_SHA256=\".*\"$/TREE_SHA256=\"$TREE_SHA256\"/" install.sh

printf 'Version:   %s\n' "$VERSION"
printf 'Checksum:  %s\n' "$TREE_SHA256"
printf '\nNext:\n'
printf '  git add package.json install.sh\n'
printf '  git commit -m "Release v%s"\n' "$VERSION"
printf '  git tag v%s\n' "$VERSION"
printf '  git push origin main v%s\n' "$VERSION"
