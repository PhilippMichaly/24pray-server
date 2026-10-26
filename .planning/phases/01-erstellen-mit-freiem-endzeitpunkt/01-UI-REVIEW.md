# Phase 01 — UI Review

**Audited:** 2026-10-26
**Baseline:** Abstract 6-pillar standards (no UI-SPEC exists), cross-checked against the project's de-facto design contract: `24pray-web/docs/DESIGN-VISION.md` (§1.1 Farbsystem, §1.2 Typografie, §1.3 Spacing/Radius, §1.4 Ikonografie, §1.5 Motion), `docs/specs/2026-07-06-design-system-and-slot-grid-spec.md` (Token-Tabelle, Create-Form-Zeile 752), `docs/I18N.md` (RTL/Bidi-Regeln)
**Implementation:** `/home/pmi/24pray-web` @ `1438009` (diff `5f7141b..HEAD`, 7 files, +481/−7)
**Screenshots:** not captured — no dev server answered on localhost:3000, 5173 or 8080. **Code-only audit**: all findings are derived from source, class analysis and the string catalogs; no rendered pixels were inspected. Visual conclusions (layout balance, wrapping, perceived hierarchy) are inferred from markup, not seen. Limits: no breakpoint rendering, no font-metric check, no RTL visual verification.
**Interaction captures:** off (workflow.ui_interaction_capture is false)

Audit-method disclosure: per the documented fallback, this review did not perform a visual browser audit. Scores rest on the pillar grep methods (Tailwind-class audit, string audit, state-handling check) against the design docs above.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | All new UI strings localized (de/en/es/he/ar), specific and actionable; no generic labels |
| 2. Visuals | 3/4 | Fifth raster tile orphans onto a second row alone (4-col/2-col grid vs. 5 buttons) |
| 3. Color | 4/4 | Semantic tokens only; ESLint raw-palette rule green; accent reserved for selection states |
| 4. Typography | 3/4 | New hint uses text-xs (12px) below the vision's 14px UI-text floor; datetime fragment in RTL error not bidi-isolated |
| 5. Spacing | 4/4 | All spacing on the 4px scale, no arbitrary values; 12px reveal offset matches form rhythm |
| 6. Experience Design | 3/4 | Strong state coverage, but blocked submit moves no focus, custom mode loses the live summary, {example} not bidi-isolated |

**Overall: 21/24**

---

## Top 3 Priority Fixes

1. **Orphaned 5th tile in the duration grid** — the custom-mode button wraps onto a second grid row alone (desktop: 1×25%-width tile left-aligned under 4 presets; mobile: row 3 of a 2-col grid) — makes the feature look bolted-on rather than "a natural extension of the raster" (CONTEXT/specifics) — give the custom button `col-span-2 sm:col-span-4` (full-width row beneath the presets) or switch the grid to 5 columns ≥sm.
2. **No focus management when submit is blocked** — on an invalid/missing custom end the error renders but focus stays on the submit button at the form bottom; keyboard and screen-reader users must hunt for the field that needs correction — in the `onSubmit` early-returns (`page.tsx:115-122`) focus `#customEnd` (and scroll it into view) before returning.
3. **`{example}` datetime fragment not bidi-isolated in RTL error text** — `errEndNotAligned` interpolates a Latin-digit datetime as a plain text node inside an RTL sentence (he/ar), which `docs/I18N.md` explicitly requires isolating via `dir="ltr"` spans; the bidi algorithm can visually reorder "6.7.2026, 02:00" — wrap the formatted example in Unicode isolates (`\u2066…\u2069`) or render it as a `<span dir="ltr">` part.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)

- All five new keys (`durationCustom`, `customEndStartFirst`, `errEndMissing`, `errEndTooLong`, `errEndNotAligned`) exist in all five catalogs (`i18n.ts:233-237, 608-612, 974-978, 1340-1344, 1706-1710`); the `Record<keyof typeof de, string>` type gate proves completeness (tsc green).
- Error copy is specific and actionable: `errEndTooLong` matches the API message verbatim (deliberate API-parity, SUMMARY key-decisions); `errEndNotAligned` states the problem **and** a concrete next valid end ("Nächstmögliches Ende: {example}") — exactly the guidance pattern UX best practice prescribes; the entered value is never rewritten.
- `customEndStartFirst` ("Zuerst einen Start wählen — danach ist das Endfeld frei.") explains the dependency and the way out instead of a bare disabled field — good empty-state copy.
- Reuses pre-existing keys (`fieldEnd`, `errEndAfterStart`) instead of duplicating strings — consistent terminology.
- Generic-label grep (`Submit|Click Here|OK|Cancel`) across `src/**/*.tsx`: no hits; every visible string goes through `t()`.
- Caveat (no deduction, project-wide): es/he/ar strings are machine-translated with native review still pending per `docs/I18N.md` — applies to the new keys too. A native speaker should glance at `errEndNotAligned` in he/ar once the app renders it (see Pillar 6 finding 3).

### Pillar 2: Visuals (3/4)

- Clear focal point and hierarchy: single Card, h1 `text-2xl font-display font-semibold` (vision §1.2: display font only ≥ xl — compliant), Label/Input/hint size gradient consistent with the rest of the form.
- The custom tile reuses the preset tiles' exact active/inactive classes (`border-accent bg-accent-soft text-accent-strong` vs. `bg-surface text-ink-muted hover:bg-surface-sunken`, `page.tsx:282-287`) — selection semantics identical to presets, one active tile at a time (preset click deactivates custom and vice versa, D-05).
- The revealed end field sits directly under the raster (`mt-3`, `page.tsx:293`) with Label + FieldError — proximity matches D-01.
- **Finding (WARNING):** the raster is `grid grid-cols-2 sm:grid-cols-4` (`page.tsx:252`) but now holds 5 buttons → on desktop the custom tile wraps alone into row 2 at 25% width, left-aligned; on mobile it sits alone on row 3. The layout reads as an accident rather than an option group. Fix as in Top-3 #1.
- Icon-only buttons: none added; existing Check/clock/calendar icons carry `aria-hidden` with adjacent visible text.
- No screenshots — hierarchy/wrap findings are markup-inferred; a rendered pass at 1440px and 390px should confirm the orphan-tile impression.

### Pillar 3: Color (4/4)

- New markup uses only semantic tokens: `border-accent`, `bg-accent-soft`, `text-accent-strong` (active states), `text-ink-muted` (hints), `text-danger` (FieldError, `Label.tsx:20`), `border-danger` (invalid input, `Input.tsx:18`), `bg-surface-sunken` (summary). Zero hardcoded colors in the phase diff.
- Repo-wide raw-palette grep (`bg|text|border|ring…-(blue|gray|slate|…)-[0-9]`): no hits in app code; the only hex/rgb occurrences are pre-existing and untouched by this phase (`GroupLinksBar.tsx:11,17,23` brand icon colors, `Globe.tsx` canvas, `layout.tsx` theme-color meta).
- The ESLint raw-palette ban (`.eslintrc.json`, `no-restricted-syntax`) is intact and passes — the enforcement mechanism behind Fixpunkt 1 held through the phase.
- Accent distribution follows 60/30/10: surface/ink dominate; accent appears only on selection states and links. Danger is reserved for errors; no new color semantics introduced.
- Contrast spot-checks against vision §1.1: `accent-strong` (#864E13) on `accent-soft` (#F7E8D3) for active tiles and `danger` (#AE3E28) on paper — all comfortably AA; `ink-muted` is specified at 4.5:1 on `--bg`.

### Pillar 4: Typography (3/4)

- Size inventory in `page.tsx`: `text-2xl` (h1), `text-sm` (labels, tiles, errors, summary), `text-xs` (hints), `text-base` (inputs) — 4 sizes total, at the audit threshold; weights: `font-medium`, `font-semibold` — 2, within threshold.
- **Finding (WARNING):** the new hint `customEndStartFirst` renders `text-xs` (12px, `page.tsx:316`), but vision §1.2 fixes "UI-Text nie unter 14px" with `--text-xs` reserved for Meta/Badges. Mitigation: this is the established convention of the surrounding form (dayRunsHint, fieldLocationHint, maskNamesHint all `text-xs`), so the phase followed local consistency rather than introducing a mixed style — recommend bumping hint text to `text-sm` repo-wide in a future polish pass, not as a phase-01 patch.
- **Finding (WARNING):** the `errEndNotAligned` example datetime is injected as plain text with no `tnum` and no bidi isolation; time values elsewhere in the app are tabular (`tnum` on summary/previews). Minor for a one-off error string; the bidi half of this finding is scored in Pillar 6.
- Display font usage compliant (≥ xl only); no new font weights; no raw `toLocaleString()` (both new formatters live in the `time.ts` layer per spec §5, `time.ts:67-81`).

### Pillar 5: Spacing (4/4)

- New/changed spacing: `mt-3` (12px, reveal offset), `px-3 py-2` (12/8px, tiles), `gap-2` (8px), `space-y-6` (24px, form), `mb-6` (24px, header) — all on the 4px scale; vision §1.3 steps respected.
- Arbitrary-value grep (`[…px]`, `[…rem]`): no hits in `page.tsx` (the pre-existing `accent-[hsl(var(--accent))]` checkbox tint is token-based and untouched by this phase).
- Radius consistent with spec: `rounded-md` (12px, --radius-md) on tiles; inputs `rounded-sm` (8px) via the Input primitive.
- Field-error rhythm `mt-1.5` (6px) comes from the FieldError primitive — pre-existing, off the declared 4/8/12/… ladder but uniform app-wide; not a phase defect.
- The 12px reveal offset of the custom block matches the form's section rhythm; no crowding or misalignment detectable in markup.

### Pillar 6: Experience Design (3/4)

State coverage (greps + code read):
- **Loading:** submit button swaps to spinner + `creating` label and self-disables while `submitting` (`Button.tsx:58` `disabled={disabled || loading}`) — double-submit protection present. Auth gate renders empty shell while `loading`.
- **Error:** four distinct localized field errors under the field via `FieldError` (`role="alert"`), `aria-invalid` + `border-danger` on the input; validation on blur and submit only, never during typing (D-10); submit is gated (`page.tsx:113-122` — no POST when invalid); API errors stay in the general line only (Pitfall 6, no double display); revalidation on start change (D-04) and hour/day switch (D-03) with the entered value never auto-rewritten (prohibition honored).
- **Empty/disabled:** custom mode without a start replaces the field with an explanatory hint (D-07) instead of a dead input — correct pattern.
- **Confirmation/destructive:** n/a for this form step.

Findings:
1. **(WARNING) No focus management on blocked submit.** Both early returns (`page.tsx:115-118` missing, `page.tsx:119-122` invalid) render the error but leave focus on the submit button; the field needing correction is ~one viewport above. `role="alert"` announces the error, but WCAG-flavored best practice (and the app's own Sheet patterns) move focus to the invalid control. Fix: `document.getElementById('customEnd')?.focus()` before returning.
2. **(WARNING) Custom mode loses the live summary.** Preset mode shows a confirming summary line ("48 Stunden ab Montag, 6. Juli", spec line 752 "Live-Zusammenfassung"); in custom mode the line is hidden entirely (`!customMode` guard, `page.tsx:407`) — the organizer gets no confirmation of the resulting span/end before creating. This was a documented, deliberate trade-off (Pitfall 3, smallest non-stale variant; full custom summary = CREATE-04 v2), so it is not scored as a defect against the plan — but it is a real UX regression versus the preset flow and should be the first thing Phase 02/CREATE-04 reinstates (e.g. "Endet Montag, 6. Juli um 14:00" derived from `endIso`).
3. **(WARNING, needs_human_review) Bidi isolation missing for the `{example}` fragment in RTL.** `errEndNotAligned` interpolates `formatDateTimeShort` output as a plain string into an RTL sentence (`page.tsx:83-85`). `docs/I18N.md` mandates `dir="ltr"` isolation for inherently-LTR time fragments; in `he` the Latin-digit datetime is exposed to bidi reordering (in `ar`, Intl emits Arabic-Indic digits, which behave differently). Code-derived risk — verify visually in he before shipping RTL, then isolate (`\u2066…\u2069` or a split render with `<span dir="ltr">`).
4. Minor: no `min` attribute on the custom end input (native guard could prevent obviously-past ends; validation catches them anyway); `disabled={!startDate}` on the input (`page.tsx:310`) is unreachable dead code since the field only renders when `startDate` is set (the hint branch covers the empty case) — harmless hygiene.
5. Minor: slot-granularity rules (60/1440 alignment) are learnable only by violating them; the D-13 example softens this. An optional xs hint under the field could pre-empt errors (defer judgment to Phase 02 when the field gains an edit flow).

---

## Files Audited

In `/home/pmi/24pray-web` (diff `5f7141b..HEAD`, verified `git log --oneline`: d0543c1, 6d23251, 1438009):

- `src/app/projects/new/page.tsx` — custom mode state, fifth raster tile, end field, submit gate, summary guard
- `src/app/projects/new/custom-end.ts` — pure validation (no UI, reviewed for error semantics feeding copy)
- `src/lib/time.ts` — `toDateTimeLocalValue`, `formatDateTimeShort` (formatting-layer contract per spec §5)
- `src/lib/i18n.ts` — five new keys in de/en/es/he/ar
- `src/components/ui/Input.tsx`, `src/components/ui/Label.tsx`, `src/components/ui/Button.tsx` — primitives the feature relies on (invalid/aria-invalid, FieldError, loading)
- `docs/DESIGN-VISION.md`, `docs/specs/2026-07-06-design-system-and-slot-grid-spec.md`, `docs/I18N.md`, `.eslintrc.json` — de-facto design contract + token enforcement

Verification re-run during this audit (2026-10-26): `npx tsc --noEmit` exit 0 · `npm run lint` "No ESLint warnings or errors" · focused vitest (custom-end, new-project, time) 3 files / 41 tests passed.

---

## Method Limitations (disclosed)

- **No screenshots, no rendered audit**: dev server absent on 3000/5173/8080 and no Chrome-driven capture was attempted (interaction capture is off by config). Pillar 2/4/5 findings about balance, rhythm and RTL are inferred from Tailwind classes and component structure — they must be confirmed with a rendered pass (desktop 1440px, mobile 390px, locales he + ar) before treating visual scores as final.
- Scores grade the **phase delta** (the custom-end feature and its strings/markup) against project standards; pre-existing surrounding form conventions were used as context, not re-audited line by line.
