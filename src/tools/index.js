import { fetchUrl } from "./fetchUrl.js";
import { extractDesign } from "./extractDesign.js";
import { scrapeWebsite } from "./scrapeWebsite.js";
import { writeFile } from "./writeFile.js";
import { readFile } from "./readFile.js";
import { listFiles } from "./listFiles.js";
import { executeCommand } from "./executeCommand.js";

export const tool_map = {
  fetchUrl,
  extractDesign,
  scrapeWebsite,
  writeFile,
  readFile,
  listFiles,
  executeCommand,
};
