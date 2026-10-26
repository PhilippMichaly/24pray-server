---
phase: "01"
slug: "erstellen-mit-freiem-endzeitpunkt"
status: verified
threats_open: 0
asvs_level: 1
created: "2026-10-26"
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser-Formular → POST /projects | Clientseitige Validierung kann durch eine manipulierte Anfrage umgangen werden. | Start-/Endzeitpunkt und Slot-Dauer |
| Fehlertexte/Beispielwerte → DOM | Aus Benutzereingaben abgeleitete Werte werden im Formular angezeigt. | Nicht sensible Datumswerte und lokalisierte Texte |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Tampering | POST /projects payload | medium | accept | Bestehende serverseitige Validierung von Ende-nach-Start und maximal 366 Tagen bleibt unverändert; Slot-Ausrichtung ist bewusst clientseitig. | closed |
| T-01-02 | Tampering / Information Disclosure | Fehlertext und D-13-Beispiel | low | mitigate | React-Escaping, FieldError als Textknoten und Intl-Formatter; kein dangerouslySetInnerHTML im Feature. | closed |
| T-01-SC | Tampering | Paketinstallationen | high | mitigate | Keine Pakete installiert; ausschließlich vorhandener, geprüfter Stack verwendet. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-01-01 | T-01-01 | Ein manipulierter Client kann nicht slot-ausgerichtete Zeiten direkt an die API senden. Die serverseitige Spannenvalidierung bleibt bestehen; serverseitige Slot-Ausrichtung ist laut Plan und RESEARCH-A5 ausdrücklich außerhalb dieses Frontend-Scopes. | Plan T-01-01 / REQUIREMENTS out-of-scope | 2026-10-26 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-26 | 3 | 3 | 0 | gsd-secure-phase (L1 artifact audit) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-26
