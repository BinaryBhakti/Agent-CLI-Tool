import fs from "fs/promises";
import path from "path";

export async function writeFile(args) {
  let filePath, content;
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      filePath = parsed.path;
      content = parsed.content;
    } catch {
      throw new Error("writeFile expects { path, content }");
    }
  } else {
    filePath = args.path;
    content = args.content;
  }
  if (!filePath) throw new Error("writeFile: missing path");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content ?? "", "utf8");
  return `wrote ${filePath} (${(content ?? "").length} bytes)`;
}
