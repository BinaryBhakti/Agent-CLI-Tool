import fs from "fs/promises";

export async function listFiles(dir) {
  const entries = await fs.readdir(String(dir || "."), { withFileTypes: true });
  return entries.map((e) => (e.isDirectory() ? e.name + "/" : e.name));
}
