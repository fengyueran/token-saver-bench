#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo 'Usage: run-memos-bulk-archive.sh /absolute/path/to/memos-checkout' >&2
  exit 2
fi
if [[ "$1" != /* || ! -f "$1/web/package.json" ]]; then
  echo 'Usage: run-memos-bulk-archive.sh /absolute/path/to/memos-checkout' >&2
  exit 2
fi

bench_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_root="$1"
test_name="bench-bulk-archive-$$.test.tsx"
test_path="$target_root/web/tests/$test_name"

if [[ -e "$test_path" ]]; then
  echo "Refusing to overwrite $test_path" >&2
  exit 2
fi

cleanup() {
  status=$?
  rm -f "$test_path" || status=1
  exit "$status"
}
trap cleanup EXIT
cp "$bench_root/verifiers/memos-bulk-archive.test.tsx" "$test_path"
(cd "$target_root/web" && ./node_modules/.bin/vitest run "tests/$test_name")
