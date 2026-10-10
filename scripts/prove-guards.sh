#!/bin/bash
# Deliberately breaks each guarded invariant, asserts its check FAILS, restores.
# A check that has only ever passed is decoration. Add a case for every new guard.
# usage: run from repo root. Each case: file, perl substitution, command that must FAIL.
cd "$(dirname "$0")/.."
pass=0; bad=0
t() { # name file perl-expr cmd
  local name="$1" file="$2" expr="$3" cmd="$4"
  cp "$file" "$file.bak"
  perl -0pi -e "$expr" "$file"
  if cmp -s "$file" "$file.bak"; then echo "XX  $name: mutation did not apply"; bad=$((bad+1)); mv "$file.bak" "$file"; return; fi
  out=$(eval "$cmd" 2>&1); code=$?
  mv "$file.bak" "$file"
  if [ $code -ne 0 ]; then echo "ok  $name -> $(echo "$out" | grep -m1 -E 'FAIL|error|Error' | cut -c1-110)"; pass=$((pass+1)); else echo "XX  $name: guard did NOT fire"; bad=$((bad+1)); fi
}
B="npx vite build >/dev/null 2>&1; node scripts/check-content.mjs"
t "contrast: dim tertiary text" src/styles/tokens.css 's/(violet-light.*?--foreground-3: )[^;]+/${1}262 6% 60%/s' "node scripts/check-contrast.mjs"
t "contrast: theme missing a token" src/styles/tokens.css 's/(blue-light.*?)  --ring: [^;]+;\n/$1/s' "node scripts/check-contrast.mjs"
t "meta description removed" index.html 's/\s*<meta name="description"[^>]+>//' "$B"
t "inline script edited, hash stale" index.html 's/catch\(e\)\{\}/catch(err){}/' "$B"
t "unsafe-inline in script-src" firebase.json "s/script-src 'self'/script-src 'self' 'unsafe-inline'/" "$B"
t "frame-ancestors removed" firebase.json "s/ frame-ancestors 'none';//" "$B"
t "cleanUrls enabled" firebase.json 's/"cleanUrls": false/"cleanUrls": true/' "$B"
t "RE2-incompatible header regex" firebase.json 's/\^\/\$\|/^\/(?!assets)/' "$B"
t "dotfile ignore glob" firebase.json 's|"\*\*/\.DS_Store"|"**/.*"|' "$B"
t "security.txt dropped" public/.well-known/security.txt 's/.*//s' "rm -rf dist/.well-known; npx vite build >/dev/null 2>&1; rm -rf dist/.well-known; node scripts/check-content.mjs"
t "hex colour in component" src/App.tsx 's/text-foreground-3/text-[#ff00ff]/' "$B"
t "hardcoded copy in JSX" src/App.tsx 's|\{site.footer.credit\}|Made by me|' "$B"
t "placeholder copy in content" content/site.json 's/"Lucas Frasca"/"TODO name"/' "$B"
t "message key without copy" content/messages.json 's/"elig.english0"/"elig.english-zero"/' "$B"
t "engine golden numbers drift" src/lib/engine.ts 's/scaled100 \/ 2, rawUnit/scaled100 \/ 2.01, rawUnit/' "npm test"
t "UAC anchors without permission" content/courses.json 's/("id": "chemistry",.*?"anchors": )null/${1}[[66, 49.8], [76, 67.4]]/s' "$B"
t "class collides with a Tailwind utility" src/styles/components.css 's/\.pct-ring \{ flex: none; \}/.ring { flex: none; }/' "$B"
t "theme id drift" content/site.json 's/"id": "contrast"/"id": "hc"/' "$B"
t "budget: lazy module made static" src/App.tsx 's|^|import "./ScalingTable.ts";\n|' "echo 'export const x=1; console.log(x)' > src/ScalingTable.ts; npx vite build >/dev/null 2>&1; node scripts/check-budget.mjs; r=\$?; rm src/ScalingTable.ts; exit \$r"
t "budget: lazy chunk statically imported" src/App.tsx 's|^|import { x } from "./ScalingTable.ts";\nconsole.log(x);\n|' "printf 'export const x = [1,2,3].map(String);\\n' > src/ScalingTable.ts; npx vite build >/dev/null 2>&1; node scripts/check-budget.mjs; r=\$?; rm src/ScalingTable.ts; exit \$r"
t "budget: syllabus tab made static" src/App.tsx 's/const Syllabuses = lazy\(\(\) => import\("\.\/components\/Syllabuses\.tsx"\)\);/import Syllabuses from ".\/components\/Syllabuses.tsx";/' "npx vite build >/dev/null 2>&1; node scripts/check-budget.mjs"
t "contrast: backdrop glow too strong" src/styles/tokens.css 's/--glow-alpha: 0\.36;/--glow-alpha: 0.6;/' "node scripts/check-contrast.mjs"
t "budget: WebGL glass made static" src/components/Backdrop.tsx 's|^|import "../lib/liquidGlass.ts";\n|' "npx vite build >/dev/null 2>&1; node scripts/check-budget.mjs"
t "budget: guide made static" src/App.tsx 's/const Guide = lazy\(\(\) => import\("\.\/components\/Guide\.tsx"\)\);/import Guide from ".\/components\/Guide.tsx";/' "npx vite build >/dev/null 2>&1; node scripts/check-budget.mjs"
t "budget: papers index made static" src/App.tsx 's/const Papers = lazy\(\(\) => import\("\.\/components\/Papers\.tsx"\)\);/import Papers from ".\/components\/Papers.tsx";/' "npx vite build >/dev/null 2>&1; node scripts/check-budget.mjs"
t "budget: over ceiling" scripts/check-budget.mjs 's/js: 110_000/js: 50_000/' "npx vite build >/dev/null 2>&1; node scripts/check-budget.mjs"
t "typecheck: type error" src/App.tsx 's/export function App\(\) \{/export function App() {\n  const n: number = "x"; void n;/' "npx tsc -b"
t "lint: hook in condition" src/App.tsx 's/export function App\(\) \{/import { useState } from "react";\nexport function App() {\n  if (Math.random()) useState(0);/' "npx eslint ."
echo "guards fired: $pass, problems: $bad"
npx vite build >/dev/null 2>&1
