---
phase: 01-erstellen-mit-freiem-endzeitpunkt
reviewed: 2026-10-26T16:12:01Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/app/projects/new/custom-end.test.ts
  - src/app/projects/new/custom-end.ts
  - src/app/projects/new/new-project.test.tsx
  - src/app/projects/new/page.tsx
  - src/lib/i18n.ts
  - src/lib/time.test.ts
  - src/lib/time.ts
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-10-26T16:12:01Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed the seven-file phase delta in `/home/pmi/24pray-web` (diff `5f7141b..HEAD`, commits d0543c1, 6d23251, 1438009; +481/−7). The implementation is sound in its core contract: the 366-day boundary matches the API operand-for-operand (web `span > 366 * 86_400_000` in `custom-end.ts:26` vs. API `end.getTime() - start.getTime() > MAX_PROJECT_DAYS * 86_400_000`, `24pray-api/src/schemas/projects.ts:8,24` — both strictly-greater, exactly 366 days allowed; API rejection message matches `errEndTooLong` verbatim, confirmed at `24pray-api/src/routes/projects.test.ts:245`). NaN/missing input degrades safely (`!(span > 0)` → `notAfterStart`; empty string is handled before the call in `page.tsx:115-118`). Slot arithmetic is DST-free ms math; 366 days is an integer multiple of both slot sizes, so the `notAligned` example can never exceed the cap. Local-datetime handling is consistent (validation `new Date(customEnd).getTime()` and payload `new Date(customEnd).toISOString()` parse identically). Preset regression surface is untouched per diff and covered by the four pre-existing tests. i18n is complete (25 occurrences = 5 keys × 5 catalogs; `Record<keyof typeof de, string>` gate + `tsc --noEmit` exit 0).

Verification re-run during this review: `npx tsc --noEmit` exit 0 · `npm run lint` "No ESLint warnings or errors" · focused vitest (custom-end, time, new-project) 3 files / 41 tests passed.

No Critical findings (no incorrect-persist behavior, no security holes — React escaping is the only render path, no `dangerouslySetInnerHTML`, payload is JSON via `api.post`). Three Warnings: one documented-RTL-rule violation (bidi isolation), one accessibility gap (focus management), one real stale-state edge in the error lifecycle. Four Info items.

Prior-audit claims (01-UI-REVIEW.md) were treated as claims and re-verified against source: the bidi-isolation and focus findings confirm; the orphan-tile and summary-hiding findings confirm but are cosmetic/documented trade-offs; the "unreachable `disabled`" claim confirms as dead code.

## Warnings

### WR-01: `{example}` datetime fragment not bidi-isolated in RTL error text

**File:** `src/app/projects/new/page.tsx:83-85` (interpolation site); `src/lib/i18n.ts:1344` (he), `src/lib/i18n.ts:1710` (ar)
**Issue:** `customEndMessage` interpolates `formatDateTimeShort(...)` output (e.g. Latin-digit "6.7.2026, 02:00" under `he-IL`) as a plain string into the RTL sentence `errEndNotAligned`. `docs/I18N.md:24-28` explicitly mandates that inherently-LTR time fragments in RTL sentences stay visually LTR-isolated via `<span dir="ltr">…</span>` (reference implementations: `SlotRow.tsx:60`, `SlotSheet.tsx:201,205`, `NextSlotCard.tsx:37`). Because `t()` returns a flat string rendered inside `<p role="alert">`, no isolation point exists in the current data flow, and the Unicode bidi algorithm can visually reorder date/time separators in he. (In `ar`, Intl emits Arabic-Indic digits via the bare `ar` locale — directionally neutral, so the risk is he-specific, but the rule is locale-general.)
**Fix:** Isolate at the render layer instead of interpolating into the sentence — e.g. split `errEndNotAligned` into a prefix key plus a separately rendered `<span dir="ltr">{formatDateTimeShort(...)}</span>`, or wrap the interpolated fragment in Unicode isolates before passing to `t()`:
```ts
const example = `\u2066${formatDateTimeShort(new Date(result.exampleMs!).toISOString(), tz)}\u2069`;
return t('errEndNotAligned', { example });
```

### WR-02: No focus management when submit is blocked

**File:** `src/app/projects/new/page.tsx:114-122`
**Issue:** Both early returns (`!customEnd` → `errEndMissing`, invalid end → field error) render the error under the end field but leave focus on the submit button at the bottom of the form; the field needing correction sits ~one viewport above. `role="alert"` announces the error, but keyboard and screen-reader users must hunt for the control. Grep confirms no `.focus(` call exists anywhere in `page.tsx`. The app's own Sheet patterns move focus on error (per 01-UI-REVIEW.md), so this is inconsistent with house behavior.
**Fix:** Before each `return`, focus and reveal the field:
```ts
if (!customEnd) {
  setCustomEndError(t('errEndMissing'));
  document.getElementById('customEnd')?.focus();
  return;
}
const message = revalidateCustomEnd(startDate, customEnd, slotDurationMinutes);
setCustomEndError(message);
if (message) {
  document.getElementById('customEnd')?.focus();
  return;
}
```

### WR-03: Stale `customEndError` after a preset detour — error shown for outdated start/slot inputs

**File:** `src/app/projects/new/page.tsx:259` (preset click), `src/app/projects/new/page.tsx:273-281` (custom-button re-entry), `src/app/projects/new/page.tsx:102-105` and `src/app/projects/new/page.tsx:209` (revalidation gated on `customMode`)
**Issue:** `customEndError` is only ever recomputed while `customMode` is true. Sequence that breaks it: (1) custom mode, end `2099-01-03T00:30`, blur → `notAligned` error with a 60-minute-based example ("…01:00"); (2) click preset "24 Stunden" — `setCustomMode(false)` (line 259) keeps the stale error; (3) switch unit to "Tage" — `selectUnit` revalidates only `if (customMode)`, so nothing updates, yet `slotDurationMinutes` silently becomes 1440; (4) click "Eigener Endzeitpunkt" — `customEnd` is non-empty, so no prefill and **no revalidation**; the field reappears displaying the old error whose example was computed for 60-minute slots (correct next end for 1440-minute slots would differ, e.g. `00:00` vs the shown `01:00`). The same gap opens when the start date changes while in preset mode. The wrong guidance persists until blur/submit. The submit gate (line 119-121) still re-validates, so no invalid POST escapes — but the displayed error is factually wrong for the current inputs, which is a state-consistency defect, not just polish.
**Fix:** Revalidate (or clear) on re-entry into custom mode:
```ts
onClick={() => {
  setCustomMode(true);
  if (startDate && customEnd) {
    setCustomEndError(revalidateCustomEnd(startDate, customEnd, slotDurationMinutes));
  } else if (startDate && !customEnd) {
    setCustomEnd(toDateTimeLocalValue(new Date(new Date(startDate).getTime() + hours * 3600_000)));
  }
}}
```

## Info

### IN-01: Fifth raster tile orphans onto a second grid row alone

**File:** `src/app/projects/new/page.tsx:252` (`grid grid-cols-2 sm:grid-cols-4`, now 5 buttons)
**Issue:** The custom-mode button wraps alone into row 2 at 25 % width (desktop) or row 3 of the 2-column mobile grid, making the feature look bolted-on rather than part of the option group. Cosmetic; confirmed per markup (no rendered pass).
**Fix:** Give the custom button `col-span-2 sm:col-span-4` (full-width row beneath the presets) or switch to 5 columns ≥ sm.

### IN-02: Custom mode hides the live summary line entirely

**File:** `src/app/projects/new/page.tsx:407` (`!customMode` guard)
**Issue:** Preset mode shows a confirming summary ("48 Stunden ab Montag, 6. Juli"); in custom mode the organizer gets no confirmation of the resulting end before creating. Deliberate per plan (Pitfall 3, smallest non-stale variant; full custom summary deferred to CREATE-04), so not scored against the plan — but it is a UX regression versus the preset flow.
**Fix:** In CREATE-04, derive a custom-mode summary from `endIso` (e.g. `t('summaryLineCustom', { end: formatDateTimeShort(endIso, tz) })`) with no duration number.

### IN-03: Unreachable `disabled={!startDate}` on the custom-end input

**File:** `src/app/projects/new/page.tsx:310` (input) vs. `src/app/projects/new/page.tsx:295` (render gate)
**Issue:** The input only renders inside the `startDate ? …` branch; when `startDate` is empty the hint `customEndStartFirst` replaces it. The `disabled` prop can never be true — dead code.
**Fix:** Drop `disabled={!startDate}` (keep the hint branch), or keep it as belt-and-braces with a comment.

### IN-04: Non-null assertion `result.exampleMs!` would throw on a malformed result

**File:** `src/app/projects/new/page.tsx:84`
**Issue:** `new Date(result.exampleMs!).toISOString()` throws `RangeError` if `exampleMs` is ever absent in a `notAligned` result. Unreachable today (the producer always sets it and the switch guards the key), but the assertion paper-overs the optional field.
**Fix:** Guard explicitly:
```ts
const exampleMs = result.key === 'notAligned' ? result.exampleMs : undefined;
return exampleMs != null
  ? t('errEndNotAligned', { example: formatDateTimeShort(new Date(exampleMs).toISOString(), tz) })
  : t('errEndMissing');
```

---

## Verified-OK checklist (evidence for the record)

- **366-day boundary / API parity:** `custom-end.ts:26` vs. `24pray-api/src/schemas/projects.ts:8,24` — identical operand `366 * 86_400_000` and strictly-greater operator; exactly 366 days passes client and server. Unit tests cover both slot sizes and 366d+1min rejection (`custom-end.test.ts:28-41`).
- **NaN / missing input:** empty `customEnd` handled pre-call (`page.tsx:115-118`, blur handler `page.tsx:302-308`); NaN span (unparseable date) falls into `!(span > 0)` → `notAfterStart`, no crash, no `%` on NaN reaching `notAligned` with a NaN example (tooLong/notAfterStart gate first for the realistic paths; `%` runs only on finite spans in practice).
- **Slot arithmetic:** `span % slotMs !== 0` with `slotMs ∈ {3_600_000, 86_400_000}`; `Math.ceil(span/slotMs)*slotMs` examples verified by tests (90 min → +2 h; 71 h → +3 d); example can never exceed 366 d because 366 d is a multiple of both slot sizes.
- **Local datetime handling:** validation, `endIso` memo, and payload all parse `customEnd` via `new Date(...)` identically; `toDateTimeLocalValue` uses local getters (no `toISOString`), round-trip tested (`time.test.ts:93-103`).
- **Preset regression:** diff shows preset lists, preset payload formula, and step-1 flow untouched; four pre-existing tests still green (41/41 total).
- **Revalidation (D-03/D-04):** covered by tests (`new-project.test.tsx:216-241`) — with the WR-03 gap noted above for the preset-detour path.
- **i18n:** 5 new keys × 5 catalogs (de `i18n.ts:233-237`, en `608-612`, es `974-978`, he `1340-1344`, ar `1706-1710`); `tsc --noEmit` exit 0 proves the `Record` gate.
- **Security:** no injection surface (React escaping only; no `dangerouslySetInnerHTML`; JSON payload via `api.post`); error example is produced by the Intl layer, never raw input concatenation.
- **Gates re-run:** vitest 41/41, tsc exit 0, ESLint clean.

---

_Reviewed: 2026-10-26T16:12:01Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
