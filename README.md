# GenAI CLI — Website Cloner Agent

A conversational CLI agent (Node.js + Google Gemini) that clones any public website
into a local folder of static `index.html` / `style.css` / `script.js` files.

The agent works in a strict **START → THINK → TOOL → OBSERVE → OUTPUT** loop —
similar to how Cursor / Windsurf reason — calling tools one step at a time,
extracting the target site's real design tokens (palette, fonts, copy, nav,
images), and then generating a clean, responsive clone with at minimum a
**Header**, **Hero Section**, and **Footer**.

---

## Features

- **Two CLI modes**
  - **One-shot:** `node src/index.js "clone https://scaler.com into ./scaler_clone"`
  - **Interactive REPL:** `node src/index.js` → chat with the agent turn-by-turn.
- **Real design extraction** via the `extractDesign` tool (cheerio): pulls
  palette, font families, headings, nav links, hero copy, CTA, footer text,
  and images from the live page before generating.
- **Multi-step reasoning** — the agent does multiple `THINK` steps and
  iterates: fetch → extract → plan → write HTML → write CSS → write JS → verify.
- **Safe tool layer** — write/read/list files, run shell commands (with a
  small block-list for destructive commands), fetch URLs.
- **Generic** — works for any public site, not just Scaler.

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure your Gemini API key
cp .env.example .env
# then edit .env and set GEMINI_API_KEY=...
```

Get a free Gemini API key at https://aistudio.google.com/app/apikey

---

## Usage

### Interactive mode (recommended for the demo)

```bash
node src/index.js
```

You'll get a prompt:

```
you > clone https://scaler.com into ./scaler_clone
```

The agent will print each `[START] / [THINK] / [TOOL] / [OBSERVE] / [OUTPUT]`
step as it works. When done, open the generated `index.html` in a browser.

### One-shot mode

```bash
node src/index.js "clone https://scaler.com into ./scaler_clone"
```

### Example prompts

- `clone https://scaler.com into ./scaler_clone`
- `clone https://stripe.com into ./stripe_clone`
- `clone https://vercel.com into ./vercel_clone`
- `make a clone of https://nextjs.org and put it in ./next_clone`

---

## Project Structure

```
.
├── src/
│   ├── index.js          # CLI entry — REPL + one-shot
│   ├── agent.js          # Gemini client + agent loop
│   ├── prompt.js         # System prompt with the protocol
│   └── tools/
│       ├── index.js          # tool registry
│       ├── fetchUrl.js       # GET raw HTML
│       ├── extractDesign.js  # parse design tokens from the page
│       ├── writeFile.js      # write a file (creates dirs)
│       ├── readFile.js       # read a file
│       ├── listFiles.js      # ls a directory
│       └── executeCommand.js # safe shell exec
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## How the agent loop works

The model is forced into a JSON-only protocol:

```json
{ "step": "START | THINK | TOOL | OUTPUT",
  "content": "...",
  "tool_name": "...",
  "tool_args": "..." }
```

1. The CLI sends the user's instruction.
2. Gemini emits one JSON object per turn.
3. On a `TOOL` step the orchestrator runs the matching function and pushes
   back an `OBSERVE` message with the result.
4. The loop continues until the model emits an `OUTPUT` step.

A typical website-clone run looks like:

```
[START]   user wants me to clone scaler.com into ./scaler_clone
[THINK]   I should extract the design first before generating files
[TOOL]    extractDesign  https://scaler.com
[OBSERVE] { palette: [...], fonts: [...], navLinks: [...] ... }
[THINK]   Now I'll create the folder and write index.html
[TOOL]    executeCommand  mkdir -p ./scaler_clone
[TOOL]    writeFile       ./scaler_clone/index.html
[TOOL]    writeFile       ./scaler_clone/style.css
[TOOL]    writeFile       ./scaler_clone/script.js
[TOOL]    listFiles       ./scaler_clone
[OUTPUT]  Done. Open ./scaler_clone/index.html in your browser.
```

---

## Tools

| Tool | Purpose |
|------|---------|
| `fetchUrl(url)`        | Fetches raw HTML (truncated to ~20k chars). |
| `extractDesign(url)`   | Returns `{ title, description, palette, fonts, headings, navLinks, heroText, ctaText, footerText, images }`. |
| `writeFile({path,content})` | Writes a file, creating parent dirs. |
| `readFile(path)`       | Reads a file (truncated to ~8k chars). |
| `listFiles(path)`      | Lists a directory. |
| `executeCommand(cmd)`  | Runs a shell command (blocks `rm -rf /`, `mkfs`, etc.). |

---

## Submission

- **GitHub repo:** https://github.com/BinaryBhakti/Agent-CLI-Tool
- **Demo video (2–3 min):** https://youtube.com/shorts/Ycmp2Y-gJlI?si=WfUsB6IeGOWHkSBa

## License

MIT
