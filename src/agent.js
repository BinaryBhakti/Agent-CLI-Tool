import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_PROMPT } from "./prompt.js";
import { tool_map } from "./tools/index.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const MAX_STEPS = 40;

function colorize(label, color) {
  const codes = { cyan: 36, yellow: 33, magenta: 35, green: 32, gray: 90, red: 31 };
  return `\x1b[${codes[color] || 0}m${label}\x1b[0m`;
}

function safeJsonParse(text) {
  if (!text) return null;
  let t = text.trim();
  // Strip markdown fences if model adds them
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // Try direct parse
  try { return JSON.parse(t); } catch {}
  // Try to grab the first {...} block
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch {}
  }
  return null;
}

export class Agent {
  constructor(apiKey) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing. Add it to .env");
    this.client = new GoogleGenerativeAI(apiKey);
    this.history = []; // [{ role: 'user'|'model', parts: [{text}] }]
  }

  async _ask() {
    const model = this.client.getGenerativeModel({
      model: MODEL,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3,
        maxOutputTokens: 16384,
      },
    });
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await model.generateContent({ contents: this.history });
        return res.response.text();
      } catch (e) {
        const msg = e.message || "";
        const transient = /\b(429|503|500|502|504|UNAVAILABLE|overloaded)\b/i.test(msg);
        if (!transient || attempt === maxAttempts) throw e;
        const delayMs = Math.min(30000, 2000 * Math.pow(2, attempt - 1));
        console.log(colorize(`[retry ${attempt}/${maxAttempts - 1}] ${delayMs}ms — ${msg.slice(0, 120)}`, "yellow"));
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  pushUser(text) {
    this.history.push({ role: "user", parts: [{ text }] });
  }

  pushModel(text) {
    this.history.push({ role: "model", parts: [{ text }] });
  }

  async runTurn(userMessage) {
    this.pushUser(userMessage);

    for (let step = 0; step < MAX_STEPS; step++) {
      let raw;
      try {
        raw = await this._ask();
      } catch (e) {
        console.log(colorize("LLM error:", "red"), e.message);
        return;
      }

      const parsed = safeJsonParse(raw);
      if (!parsed || !parsed.step) {
        console.log(colorize("Bad JSON from model, asking it to retry...", "red"));
        // Don't keep the broken response in history — it confuses the model.
        this.pushUser(
          JSON.stringify({
            step: "OBSERVE",
            content:
              "Your previous response was not valid JSON or was truncated. Reply with exactly ONE JSON object matching the protocol. If writing a large file, keep the content under 12000 characters; split into multiple writeFile calls (e.g. style.css then script.js) instead of one giant payload.",
          })
        );
        continue;
      }

      this.pushModel(JSON.stringify(parsed));

      switch (parsed.step) {
        case "START":
          console.log(colorize("\n[START]", "cyan"), parsed.content || "");
          break;
        case "THINK":
          console.log(colorize("[THINK]", "yellow"), parsed.content || "");
          break;
        case "TOOL": {
          const name = parsed.tool_name;
          const args = parsed.tool_args;
          console.log(colorize(`[TOOL] ${name}`, "magenta"), typeof args === "string" ? args : JSON.stringify(args).slice(0, 120));
          let observation;
          if (!tool_map[name]) {
            observation = { error: `tool '${name}' not available` };
          } else {
            try {
              observation = await tool_map[name](args);
            } catch (e) {
              observation = { error: e.message };
            }
          }
          const obsText =
            typeof observation === "string" ? observation : JSON.stringify(observation);
          console.log(colorize("[OBSERVE]", "gray"), obsText.slice(0, 200) + (obsText.length > 200 ? "..." : ""));
          this.pushUser(JSON.stringify({ step: "OBSERVE", content: observation }));
          break;
        }
        case "OUTPUT":
          console.log(colorize("\n[OUTPUT]", "green"), parsed.content || "");
          return;
        default:
          console.log(colorize(`[${parsed.step}]`, "gray"), parsed.content || "");
      }
    }
    console.log(colorize("Reached max steps without OUTPUT.", "red"));
  }
}
