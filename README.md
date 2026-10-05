# pi-clock

Pi extension: shows the current date/time right-aligned on the footer's
extension-status line, reusing the footer-rewrite groundwork already in
`clock-status.ts`. Not a public API, so it mirrors pi's default footer
(pwd/git/session line + stats/model line) and drops two edge-case
decorations: the "(sub)" subscription-cost marker and the "→ routed-model"
virtual-model arrow.

## Install

```bash
pi install ~/pi-clock
```

## Configure

Create `~/.pi/agent/clock-status.json` (plain JSON, no comments):

```json
{
  "format": "EEE DD.MM.YYYY HH:mm:ss",
  "timeZone": null
}
```

- `format` tokens: `YYYY` `MM` `DD` `HH` (24h) `hh` (12h) `mm` `ss`
  `EEE` (short weekday) `a` (am/pm). Other characters pass through as-is.
  Example: `"MM/DD/YYYY hh:mm:ss a"` → `10/04/2026 03:41:22 pm`
- `timeZone`: IANA name (e.g. `"Europe/Berlin"`, `"UTC"`). `null`, omitted,
  or invalid falls back to the system's local time zone.

Missing file or malformed JSON uses the defaults above. Changes take effect
within 1 second, no restart needed.
