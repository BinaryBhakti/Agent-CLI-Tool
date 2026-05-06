import fs from "fs/promises";

export async function readFile(filePath) {
  const data = await fs.readFile(String(filePath), "utf8");
  return data.length > 8000 ? data.slice(0, 8000) + "\n/* truncated */" : data;
}
