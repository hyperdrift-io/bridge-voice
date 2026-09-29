#!/usr/bin/env bash
# Build the public version of this repo in <out-dir>: the same dated history without the internal working docs
# (they carry account details and infra notes; their private home is docs/bridge-voice/ in the monorepo).
# Nothing here touches origin. Publishing is the founder's step, after the scrub call:
#   scripts/public-export.sh /tmp/bridge-voice-public
#   git -C /tmp/bridge-voice-public push --force git@github.com:hyperdrift-io/bridge-voice.git main
#   gh repo edit hyperdrift-io/bridge-voice --visibility public --accept-visibility-change-consequences
set -euo pipefail
out="${1:?usage: public-export.sh <out-dir>}"
here="$(cd "$(dirname "$0")/.." && pwd)"
internal="docs/RESUME.md docs/ONE-NIGHT-PLAN.md docs/BUILD-PLAN.md docs/slides/index.html"  # the slide scaffold carries the founder's working notes
rm -rf "$out" && git clone -q --no-local "$here" "$out"
FILTER_BRANCH_SQUELCH_WARNING=1 git -C "$out" filter-branch -f --index-filter "git rm -q --cached --ignore-unmatch $internal" --prune-empty -- --all >/dev/null 2>&1
git -C "$out" for-each-ref --format='%(refname)' refs/original | while read -r ref; do git -C "$out" update-ref -d "$ref"; done
git -C "$out" remote remove origin
# The guides still point at the docs that left: one last commit puts that right.
python3 - "$out" <<'PY'
import sys, re, pathlib
out = pathlib.Path(sys.argv[1])
p = out / "AGENTS.md"; s = p.read_text()
s = s.replace("`docs/FIRST-OFFICER.md` (it supersedes `docs/ONE-NIGHT-PLAN.md` and\n`docs/BUILD-PLAN.md`). Where the work stands: `docs/RESUME.md`. Measurements\nand protocol lessons: `docs/VOICE-AGENT-NOTES.md`.", "`docs/FIRST-OFFICER.md`. Measurements and protocol lessons:\n`docs/VOICE-AGENT-NOTES.md`.")
p.write_text(s)
p = out / "docs/FIRST-OFFICER.md"; s = p.read_text()
s = s.replace("**Decided 2026-09-03 with the founder. Supersedes the \"voice remote control\" reading of\n`ONE-NIGHT-PLAN.md`; keeps its plumbing.**", "**Decided 2026-09-03 with the founder. Supersedes the first \"voice remote control\" plan; keeps its plumbing.**")
p.write_text(s)
PY
git -C "$out" -c user.email=yann@hyperdrift.io -c user.name="Yann VR" commit -q -am "docs: the public repo points at its own docs" || true
git -C "$out" reflog expire --expire=now --all && git -C "$out" gc -q --prune=now
echo "commits:        $(git -C "$out" rev-list --count HEAD)  ($(git -C "$out" log --reverse --format=%ad --date=short | head -1) → $(git -C "$out" log -1 --format=%ad --date=short))"
echo "authors:        $(git -C "$out" log --format='%ae' | sort -u | tr '\n' ' ')"
echo "internal docs:  $(git -C "$out" log --all --name-only --format= | grep -cE 'docs/(RESUME|ONE-NIGHT-PLAN|BUILD-PLAN)\.md|docs/slides/index\.html' || true) in history"
echo "personal email: $(git -C "$out" log --all -p | grep -c '@gmail\.com' || true) occurrences"
echo "dangling refs:  $(git -C "$out" grep -cE 'RESUME\.md|ONE-NIGHT-PLAN|BUILD-PLAN' -- . | wc -l | tr -d ' ') files"
echo "→ $out"
