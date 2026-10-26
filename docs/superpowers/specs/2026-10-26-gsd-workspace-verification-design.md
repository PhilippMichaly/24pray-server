# Gemeinsamer GSD-Workspace und kanonische Phase-1-Verifikation

## Ausgangslage

Phase 1 ist in `24pray-web` implementiert und durch automatisierte Tests sowie sieben UAT-Ergebnisse bestätigt. Die Planung liegt jedoch in `24pray-api`, während der Produktionscode im Sibling-Repository liegt. `verification.fingerprint` begrenzt Dateien auf das Projekt-Root und kann deshalb keinen Digest über beide Repositories erzeugen. Der Bericht bleibt `stale`; Phase 1 kann nicht kanonisch abgeschlossen werden.

## Entscheidung

Ein dediziertes gemeinsames Workspace wird unter `/home/pmi/24pray/` eingerichtet:

```text
/home/pmi/24pray/
├── .planning/
├── api/
└── web/
```

Dies entspricht dem vorhandenen GSD-Multi-Repo-Modell. Die Alternativen — Planung direkt unter `/home/pmi` oder Erweiterung des globalen GSD-Core — werden wegen unerwünschter Erfassung anderer Repositories beziehungsweise unnötiger globaler Komplexität nicht verfolgt.

## Migration

1. API- und Web-Entwicklungsserver kontrolliert stoppen.
2. `/home/pmi/24pray-api` nach `/home/pmi/24pray/api` verschieben.
3. `/home/pmi/24pray-web` nach `/home/pmi/24pray/web` verschieben.
4. `.planning` aus dem API-Repository in das Workspace-Root verschieben.
5. In `.planning/config.json` `sub_repos: ["api", "web"]` setzen. Bestehende Konfiguration und uncommittete Dateien bleiben erhalten.
6. Kompatibilitätslinks `/home/pmi/24pray-api -> /home/pmi/24pray/api` und `/home/pmi/24pray-web -> /home/pmi/24pray/web` einrichten, damit das vorhandene Deployment-Runbook und lokale Verweise weiter funktionieren.

Es werden keine Produktionsdaten, Datenbanken oder Serverkonfigurationen verändert. Git-Historie und Working-Tree-Zustand bleiben durch Verschieben statt Neuinitialisieren erhalten.

## Verifikation und Abschluss

- Den Fingerprint aus dem gemeinsamen Workspace mit den tatsächlich geprüften Web-Dateien und Phase-Artefakten erzeugen.
- `01-VERIFICATION.md` mit echten `covered_files` und `covered_digest` aktualisieren; keinen Digest erfinden und keinen `stale`-Status übergehen.
- Die bereits abgeschlossene UAT mit 7 bestandenen und 0 offenen Punkten erhalten und durch `phase uat-passed --require-verification` gemeinsam mit dem Bericht prüfen.
- Die erforderlichen GSD-Gates ausführen und Phase 1 erst nach kanonisch bestandener Verifikation abschließen.
- Die vollständige Testsuite, TypeScript, ESLint und den Produktions-Build im neuen Workspace erneut ausführen.
- Entwicklungsserver aus dem neuen Workspace starten und deren HTTP-Erreichbarkeit prüfen.

## Deployment-Vorbereitung

Nach erfolgreicher Verifikation wird das vorhandene Runbook gegen den neuen Workspace geprüft. Vorbereitet werden Ziel-Commit, rsync-Ausschlüsse, Build-Schritte und Produktions-Vorbedingungen. Es erfolgen kein Push, kein Upload auf den VPS, kein Serviceneustart und keine Änderung an https://24pray.org innerhalb dieses Arbeitsschritts.

## Erfolgskriterien

- `verification.fingerprint` akzeptiert alle deklarierten Dateien und liefert einen reproduzierbaren Digest.
- `verification.status` ist nicht mehr `stale`.
- UAT und Verifikation bestehen gemeinsam das kanonische Abschlussprädikat.
- Phase 1 ist in ROADMAP und STATE abgeschlossen.
- Alle automatisierten Prüfungen und Builds sind im neuen Workspace erfolgreich.
- Beide bisherigen Repository-Pfade bleiben über die Kompatibilitätslinks nutzbar.
- Eine nachvollziehbare Deployment-Vorbereitung liegt vor, ohne dass produktiv ausgerollt wurde.
