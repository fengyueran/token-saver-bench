#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || "$1" != /* || ! -f "$1/web/package.json" ]]; then
  echo 'Usage: run-memos-attachment-filename-search.sh /absolute/path/to/memos-checkout' >&2
  exit 2
fi
bench_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_path="$1/web/tests/bench-attachment-filename-search-$$.test.tsx"
[[ ! -e "$test_path" ]] || exit 2
trap 'rm -f "$test_path"' EXIT
cp "$bench_root/verifiers/memos-attachment-filename-search.test.tsx" "$test_path"
(cd "$1/web" && ./node_modules/.bin/vitest run "tests/$(basename "$test_path")")
