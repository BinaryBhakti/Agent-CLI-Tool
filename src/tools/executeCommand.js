import { exec } from "child_process";

const BLOCKED = [/\brm\s+-rf\s+\//i, /\bmkfs\b/i, /\bshutdown\b/i, /:\(\)\s*\{/];

export async function executeCommand(cmd) {
  const command = String(cmd);
  for (const re of BLOCKED) {
    if (re.test(command)) throw new Error("blocked dangerous command");
  }
  return new Promise((resolve) => {
    exec(command, { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve(`error: ${err.message}\n${stderr || ""}`);
      } else {
        resolve((stdout || "ok").toString().slice(0, 4000));
      }
    });
  });
}
