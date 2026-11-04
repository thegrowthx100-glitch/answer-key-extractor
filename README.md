# answer-key-extractor

A small local web tool for SSC (cbexams) candidate response sheets / answer-key
challenge pages. Paste your `ViewCandResponse.aspx` link and it fetches all four
part pages (A–D), strips the watermark, personal details and site chrome, and
gives you a clean combined PDF named after the exam date and shift — e.g.
`13 Oct 2026 (Shift-2).pdf`.

## Features

- One link → fetches `ViewCandResponse`, `ViewCandResponse2/3/4` (sequential, with
  retries — the exam site throttles bursts)
- Always removed: watermark, roll no., candidate name, centre name, Save/Print
  button, undertaking & note boxes, part-switch buttons, site menu, scripts
- Optional toggles: challenge-question links, "Hindi version" switches, SSC
  header, colour legend
- Live preview tabs (Part A–D) + print-friendly combined view
- One-click combined PDF via locally installed Google Chrome (Puppeteer)
- Simple hard-coded login gate

## Run

```bash
npm install
node server.js
```

Open http://localhost:3010 (set `PORT` to change the port) and log in.

Credentials are hard-coded in `server.js` — edit `ADMIN_USER_ID` and
`ADMIN_PASSWORD` there to change them.

## Tests

```bash
npm test
```

Runs the cleaner against `test/fixture.html` (not committed — save any response
page there yourself to run the checks).

## Disclaimer

For personal use with your own candidate response sheet.
