#!/bin/bash
# Gate for lpdv-gate-main: pull main ff-only, run tests+lint+build, print PASS/FAIL
set -u
cd /home/dario/lpdv-gate-main || exit 1
git fetch origin -q
cur=$(git rev-parse --abbrev-ref HEAD)
[ "$cur" = "main" ] || git checkout main
if ! git pull --ff-only origin main >/tmp/gate_pull.log 2>&1; then
  echo "GATE_PULL_FAIL"; cat /tmp/gate_pull.log; exit 1
fi
echo "HEAD: $(git log --oneline -1)"
node --test "**/*.test.js" >/tmp/gate_test.log 2>&1
T=$?
npx oxlint >/tmp/gate_lint.log 2>&1
L=$?
npx vite build >/tmp/gate_build.log 2>&1
B=$?
echo "tests_exit=$T lint_exit=$L build_exit=$B"
grep -E "^# (tests|pass|fail) " /tmp/gate_test.log | head -3
tail -1 /tmp/gate_lint.log 2>/dev/null | cut -c1-100
tail -2 /tmp/gate_build.log | head -1 | cut -c1-80
if [ $T -eq 0 ] && [ $L -eq 0 ] && [ $B -eq 0 ]; then echo "GATE_PASS"; else echo "GATE_FAIL"; fi
