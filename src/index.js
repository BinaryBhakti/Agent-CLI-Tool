import "dotenv/config";
import readline from "readline";
import { Agent } from "./agent.js";

const BANNER = `
\x1b[36m╭───────────────────────────────────────────────╮
│  GenAI CLI — Website Cloner Agent (Gemini)    │
╰───────────────────────────────────────────────╯\x1b[0m
Type a request like:  clone https://scaler.com into ./scaler_clone
Type 'exit' or Ctrl+C to quit.
`;

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Missing GEMINI_API_KEY. Copy .env.example to .env and add your key.");
    process.exit(1);
  }

  const agent = new Agent(apiKey);
  const argPrompt = process.argv.slice(2).join(" ").trim();

  if (argPrompt) {
    // One-shot mode
    await agent.runTurn(argPrompt);
    return;
  }

  // REPL mode
  console.log(BANNER);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = () =>
    rl.question("\n\x1b[1myou >\x1b[0m ", async (line) => {
      const msg = line.trim();
      if (!msg) return ask();
      if (/^(exit|quit)$/i.test(msg)) {
        rl.close();
        return;
      }
      try {
        await agent.runTurn(msg);
      } catch (e) {
        console.error("error:", e.message);
      }
      ask();
    });
  ask();
}

main();
