# Gemeinsamer GSD-Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 aus einem gemeinsamen API/Web-Workspace kanonisch verifizieren und anschließend das Deployment vorbereiten, ohne produktiv auszurollen.

**Architecture:** `/home/pmi/24pray/` wird das GSD-Projekt-Root mit lokalem `.planning` und den unabhängigen Git-Repositories `api/` und `web/`. Kompatibilitätslinks erhalten die bisherigen Repository-Pfade. GSD-Prüfungen laufen ab dann mit Working Directory `/home/pmi/24pray`.

**Tech Stack:** GSD Core/gsd-tools, Git, Next.js, Fastify, TypeScript, Vitest, npm, Bash

## Global Constraints

- Kein Produktions-Deployment, Push, VPS-Upload oder Serviceneustart in diesem Plan.
- Keine Datenbank-, API-Vertrags- oder Produktcodeänderung als Teil der Migration.
- Bestehende uncommittete Dateien und die vollständige Git-Historie bleiben erhalten.
- Planungsartefakte bleiben künftig lokal (`commit_docs: false`); kein neues Git-Repository im Workspace-Root.
- Keine leeren oder künstlichen Produktions-Commits zur Umgehung des Fingerprint- oder Evaluation-Scope-Gates.

---

### Task 1: Reproduktion und verlustfreie Workspace-Migration

**Files:**
- Move: `/home/pmi/24pray-api/.planning` → `/home/pmi/24pray/.planning`
- Move: `/home/pmi/24pray-api` → `/home/pmi/24pray/api`
- Move: `/home/pmi/24pray-web` → `/home/pmi/24pray/web`
- Modify: `/home/pmi/24pray/.planning/config.json`
- Create: Kompatibilitätslinks `/home/pmi/24pray-api` und `/home/pmi/24pray-web`

**Interfaces:**
- Consumes: Freigegebene Spezifikation `docs/superpowers/specs/2026-10-26-gsd-workspace-verification-design.md`.
- Produces: GSD-Projekt-Root `/home/pmi/24pray` mit `sub_repos: ["api", "web"]` und `commit_docs: false` für alle folgenden Tasks.

- [ ] **Step 1: Fehlerbild vor der Migration reproduzieren**

Run from `/home/pmi/24pray-api`:

```bash
node /home/pmi/.agents/gsd-core/bin/gsd-tools.cjs query verification.fingerprint \
  /home/pmi/24pray-api/.planning/phases/01-erstellen-mit-freiem-endzeitpunkt \
  ../24pray-web/src/app/projects/new/custom-end.ts
```

Expected: Exit 1 mit `escapes the project root`.

- [ ] **Step 2: Entwicklungsserver stoppen und Zielkonflikte ausschließen**

Stop the two background tasks `bash-k6ss0lfu` und `bash-ors0n9to` with TaskStop.

```bash
test ! -e /home/pmi/24pray
```

Expected: Exit 0; kein bestehendes Ziel wird überschrieben.

- [ ] **Step 3: Verzeichnisse verschieben und Kompatibilitätslinks erzeugen**

```bash
mkdir /home/pmi/24pray
mv /home/pmi/24pray-api /home/pmi/24pray/api
mv /home/pmi/24pray-web /home/pmi/24pray/web
mv /home/pmi/24pray/api/.planning /home/pmi/24pray/.planning
ln -s /home/pmi/24pray/api /home/pmi/24pray-api
ln -s /home/pmi/24pray/web /home/pmi/24pray-web
```

- [ ] **Step 4: Multi-Repo-Konfiguration ergänzen**

In `/home/pmi/24pray/.planning/config.json` auf Top-Level setzen:

```json
"commit_docs": false,
"sub_repos": ["api", "web"]
```

Alle übrigen Schlüssel unverändert lassen. Anschließend prüfen:

```bash
cd /home/pmi/24pray
node /home/pmi/.agents/gsd-core/bin/gsd-tools.cjs query init.execute-phase 1
```

Expected: `project_root` ist `/home/pmi/24pray`, `sub_repos` enthält `api` und `web`, `commit_docs` ist `false`.

- [ ] **Step 5: Git-Historie und Working Trees verifizieren**

```bash
git -C /home/pmi/24pray/api log -1 --format='%H %s'
git -C /home/pmi/24pray/web log -3 --format='%h %s'
git -C /home/pmi/24pray/api status --short
git -C /home/pmi/24pray/web status --short
test "$(readlink /home/pmi/24pray-api)" = /home/pmi/24pray/api
test "$(readlink /home/pmi/24pray-web)" = /home/pmi/24pray/web
```

Expected: API-History enthält den Spezifikationscommit; Web-History enthält `1438009`, `6d23251`, `d0543c1`; Web ist sauber; API zeigt keine neuen Produktionsänderungen; Links zeigen auf die neuen Roots.

---

### Task 2: Echten Cross-Repo-Fingerprint erzeugen

**Files:**
- Modify: `/home/pmi/24pray/.planning/phases/01-erstellen-mit-freiem-endzeitpunkt/01-VERIFICATION.md`

**Interfaces:**
- Consumes: Workspace-Root und Phase-Artefakte aus Task 1.
- Produces: Reproduzierbarer `covered_digest` und kanonische `covered_files` für die Statusprüfung.

- [ ] **Step 1: Fingerprint aus dem gemeinsamen Root berechnen**

Run from `/home/pmi/24pray`:

```bash
node /home/pmi/.agents/gsd-core/bin/gsd-tools.cjs query verification.fingerprint \
  .planning/phases/01-erstellen-mit-freiem-endzeitpunkt \
  web/src/app/projects/new/custom-end.ts \
  web/src/app/projects/new/custom-end.test.ts \
  web/src/app/projects/new/page.tsx \
  web/src/app/projects/new/new-project.test.tsx \
  web/src/lib/time.ts \
  web/src/lib/time.test.ts \
  web/src/lib/i18n.ts \
  .planning/REQUIREMENTS.md \
  --raw
```

Expected: Exit 0, nicht-leerer `covered_digest` im Format `v3:sha256:...`; die zurückgegebenen `covered_files` enthalten zusätzlich PLAN und SUMMARY.

- [ ] **Step 2: Rückgabe unverändert im Bericht übernehmen**

Die CLI-Ausgabe `covered_files` und `covered_digest` exakt in das Frontmatter von `01-VERIFICATION.md` kopieren. `status` zunächst auf `human_needed` belassen, weil die UAT-Übernahme erst in Task 3 erfolgt. Den bisherigen erklärenden Fingerprint-Absatz durch die tatsächliche Kommando- und Digest-Evidenz ersetzen.

- [ ] **Step 3: Reproduzierbarkeit und Status prüfen**

Dasselbe Fingerprint-Kommando erneut ausführen und Digests vergleichen. Danach:

```bash
cd /home/pmi/24pray
node /home/pmi/.agents/gsd-core/bin/gsd-tools.cjs query verification.status \
  .planning/phases/01-erstellen-mit-freiem-endzeitpunkt
```

Expected: identischer Digest; Status ist `human_needed`, nicht `stale` und nicht `unparseable`.

---

### Task 3: UAT kanonisieren und Phase 1 abschließen

**Files:**
- Modify: `/home/pmi/24pray/.planning/phases/01-erstellen-mit-freiem-endzeitpunkt/01-VERIFICATION.md`
- Modify durch GSD: `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md`

**Interfaces:**
- Consumes: Echten Digest aus Task 2 und abgeschlossene `01-UAT.md` mit 7 bestandenen Prüfungen.
- Produces: `verification.status=passed`, bestandenes Abschlussprädikat und abgeschlossene Phase 1.

- [ ] **Step 1: UAT-Zeilen unabhängig prüfen**

```bash
cd /home/pmi/24pray
node /home/pmi/.agents/gsd-core/bin/gsd-tools.cjs phase uat-passed 01 --uat-only
```

Expected: Exit 0 und `"passed": true`; keine pending, blocked oder unresolved Zeilen.

- [ ] **Step 2: Verifikation auf passed setzen und Gesamtprädikat ausführen**

```bash
cd /home/pmi/24pray
node /home/pmi/.agents/gsd-core/bin/gsd-tools.cjs query frontmatter.set \
  .planning/phases/01-erstellen-mit-freiem-endzeitpunkt/01-VERIFICATION.md \
  --field status --value passed
node /home/pmi/.agents/gsd-core/bin/gsd-tools.cjs phase uat-passed 01 --require-verification
```

Expected: Exit 0, `"passed": true`, keine Blocker.

- [ ] **Step 3: Phase mit dem Eigentümer-Verb abschließen**

```bash
cd /home/pmi/24pray
node /home/pmi/.agents/gsd-core/bin/gsd-tools.cjs query phase.complete 01
```

Expected: Phase 1 wird mit Datum abgehakt, STATE rückt auf Phase 2 vor, REQUIREMENTS bleiben traceable. Etwaige `warnings` vollständig ausgeben und prüfen.

- [ ] **Step 4: Lernen und offene Todos nach den GSD-Regeln behandeln**

```bash
cd /home/pmi/24pray
node /home/pmi/.agents/gsd-core/bin/gsd-tools.cjs query config-get features.global_learnings --raw
```

Expected: Wenn `false`, kein weiterer Schritt. Wenn `true`, Phase-Learnings extrahieren und Kopie best effort erstellen. Anschließend nur pending Todos mit `resolves_phase: 01` nach `.planning/todos/completed/` verschieben; bei keinen Treffern nichts ändern.

---

### Task 4: Integrationsprüfung und Deployment-Vorbereitung

**Files:**
- Verify only: `/home/pmi/24pray/web/package.json`, `/home/pmi/24pray/api/package.json`
- Reference: `/home/pmi/24pray/api/deploy/README.md`
- Reference: `/home/pmi/24pray/api/deploy/24pray-api.service`

**Interfaces:**
- Consumes: Abgeschlossene Phase 1 aus Task 3 und migrierte Kompatibilitätslinks aus Task 1.
- Produces: Nachgewiesene lokale Builds sowie ein ausführbarer, noch nicht ausgeführter Deployment-Auftragsumfang.

- [ ] **Step 1: Vollständige Web-Qualitätsgates ausführen**

Run from `/home/pmi/24pray/web`:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected: 234 oder mehr Tests bestehen ohne Failure; TypeScript Exit 0; keine ESLint-Warnungen; Next.js Build Exit 0.

- [ ] **Step 2: API-Regression und Build ausführen**

Run from `/home/pmi/24pray/api`:

```bash
npm test
npm run build
```

Expected: vollständige API-Suite und TypeScript-Build bestehen. Keine Schema- oder Vertragsänderung wird hinzugefügt.

- [ ] **Step 3: Entwicklungsserver neu starten und prüfen**

Start `npm run dev` in `/home/pmi/24pray/api` und `/home/pmi/24pray/web` as background tasks. Then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/projects
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/auth/login
```

Expected: API antwortet HTTP 200, Login HTTP 200.

- [ ] **Step 4: Deployment-Scope ohne Ausführung festhalten**

Ziel-Commit und sauberen Web-Tree prüfen:

```bash
git -C /home/pmi/24pray/web rev-parse HEAD
git -C /home/pmi/24pray/web status --short
test -f /home/pmi/24pray-api/deploy/README.md
test -f /home/pmi/24pray-api/deploy/24pray-api.service
```

Expected: HEAD ist `1438009` oder ein nachweislich darauf aufbauender geprüfter Commit; keine uncommitteten Web-Dateien; Runbook und Service über den Kompatibilitätspfad erreichbar.

Dem Benutzer abschließend die noch nicht ausgeführten Runbook-Schritte nennen: rsync von `~/24pray-api/` und `~/24pray-web/`, serverseitige `npm ci`/Builds, anschließende Dienst- und Selbstchecks. Keine SSH-Verbindung, kein Upload und kein Neustart ausführen.
