import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { URL } from "url";

const UA = "Mozilla/5.0 (compatible; GenAI-CLI-Scraper/1.0; +https://example.com)";
const DEFAULT_TIMEOUT = 25000;
const MAX_BYTES = 15 * 1024 * 1024; // 15MB per asset

function safeUrl(base, ref) {
  try { return new URL(ref, base).toString(); } catch { return null; }
}

function extFromUrl(u, fallback = "") {
  try {
    const p = new URL(u).pathname;
    const ext = path.extname(p);
    return ext || fallback;
  } catch { return fallback; }
}

// Map a remote URL to a local path under outDir, preserving structure when possible.
function localPathFor(remoteUrl, outDir, kindHint = "asset") {
  const u = new URL(remoteUrl);
  let pathname = decodeURIComponent(u.pathname);
  if (!pathname || pathname === "/") pathname = "/index";

  // Bucket by host so cross-origin assets don't collide.
  const hostDir = u.host.replace(/[^a-z0-9.-]/gi, "_");
  let rel = path.posix.join("_assets", hostDir, pathname.replace(/^\/+/, ""));

  // If no extension, add one based on kindHint.
  if (!path.extname(rel)) {
    const guess = { css: ".css", js: ".js", img: ".bin", font: ".bin", asset: ".bin" }[kindHint] || ".bin";
    rel += guess;
  }

  // If query string is significant (e.g. ?v=abc), append a short hash so versions don't overwrite.
  if (u.search) {
    const hash = crypto.createHash("md5").update(u.search).digest("hex").slice(0, 6);
    const ext = path.extname(rel);
    rel = rel.slice(0, -ext.length) + "." + hash + ext;
  }

  // Sanitize each segment.
  rel = rel.split("/").map((seg) => seg.replace(/[<>:"|?*\x00-\x1f]/g, "_")).join("/");
  return { abs: path.join(outDir, rel), rel };
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

class Downloader {
  constructor({ outDir, concurrency = 8, timeout = DEFAULT_TIMEOUT }) {
    this.outDir = outDir;
    this.timeout = timeout;
    this.concurrency = concurrency;
    this.cache = new Map(); // remoteUrl -> { rel, status, bytes, error? }
    this.queue = [];
    this.active = 0;
  }

  // Returns the relative local path (or original URL on failure).
  async fetchAsset(remoteUrl, kindHint) {
    if (!remoteUrl) return null;
    if (remoteUrl.startsWith("data:") || remoteUrl.startsWith("blob:")) return remoteUrl;
    if (this.cache.has(remoteUrl)) return this.cache.get(remoteUrl).rel || remoteUrl;

    const { abs, rel } = localPathFor(remoteUrl, this.outDir, kindHint);
    const entry = { rel, status: "pending" };
    this.cache.set(remoteUrl, entry);

    try {
      const res = await axios.get(remoteUrl, {
        timeout: this.timeout,
        headers: { "User-Agent": UA, "Accept": "*/*" },
        responseType: "arraybuffer",
        maxContentLength: MAX_BYTES,
        maxBodyLength: MAX_BYTES,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      await ensureDir(abs);
      await fs.writeFile(abs, res.data);
      entry.status = "ok";
      entry.bytes = res.data.length;
      return rel;
    } catch (err) {
      entry.status = "error";
      entry.error = err.message;
      return remoteUrl; // keep original URL so the page still loads it
    }
  }

  // Run an array of {url, kind} jobs with concurrency, return Map(url -> localOrUrl).
  async batch(jobs) {
    const result = new Map();
    let i = 0;
    const workers = Array.from({ length: this.concurrency }, async () => {
      while (i < jobs.length) {
        const idx = i++;
        const { url, kind } = jobs[idx];
        const local = await this.fetchAsset(url, kind);
        result.set(url, local);
      }
    });
    await Promise.all(workers);
    return result;
  }

  summary() {
    let ok = 0, fail = 0, bytes = 0;
    for (const v of this.cache.values()) {
      if (v.status === "ok") { ok++; bytes += v.bytes || 0; }
      else if (v.status === "error") fail++;
    }
    return { downloaded: ok, failed: fail, bytes };
  }
}

// Parse a srcset attribute into [{url, descriptor}, ...].
function parseSrcset(value) {
  if (!value) return [];
  return value.split(",").map((part) => {
    const trimmed = part.trim();
    if (!trimmed) return null;
    const [url, ...rest] = trimmed.split(/\s+/);
    return { url, descriptor: rest.join(" ") };
  }).filter(Boolean);
}

function buildSrcset(items) {
  return items.map(({ url, descriptor }) => descriptor ? `${url} ${descriptor}` : url).join(", ");
}

// Rewrite url(...) and @import inside a CSS string. Recursively fetches referenced assets.
async function rewriteCss(cssText, baseUrl, downloader, cssLocalAbsPath) {
  const jobs = [];
  const seen = new Set();

  // Collect url(...) targets.
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  for (const m of cssText.matchAll(urlRe)) {
    const ref = m[2].trim();
    if (!ref || ref.startsWith("data:") || ref.startsWith("#")) continue;
    const abs = safeUrl(baseUrl, ref);
    if (abs && !seen.has(abs)) { seen.add(abs); jobs.push({ url: abs, kind: guessKind(abs) }); }
  }
  // @import "..." / @import url(...).
  const importRe = /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]\s*\)?\s*;?/gi;
  for (const m of cssText.matchAll(importRe)) {
    const abs = safeUrl(baseUrl, m[1]);
    if (abs && !seen.has(abs)) { seen.add(abs); jobs.push({ url: abs, kind: "css" }); }
  }

  const map = await downloader.batch(jobs);

  // For nested CSS (@import), fetch and recursively rewrite, then overwrite local file.
  for (const job of jobs) {
    if (job.kind !== "css") continue;
    const local = map.get(job.url);
    if (!local || local === job.url) continue;
    const localAbs = path.join(downloader.outDir, local);
    try {
      const buf = await fs.readFile(localAbs);
      const childCss = buf.toString("utf8");
      const rewritten = await rewriteCss(childCss, job.url, downloader, localAbs);
      await fs.writeFile(localAbs, rewritten);
    } catch { /* ignore */ }
  }

  // Build relative paths from this CSS file's location.
  const cssDir = path.dirname(cssLocalAbsPath);
  const toRel = (localRel) => {
    const target = path.join(downloader.outDir, localRel);
    let rel = path.relative(cssDir, target).split(path.sep).join("/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    return rel;
  };

  // Rewrite the text.
  let out = cssText.replace(urlRe, (full, q, ref) => {
    if (!ref || ref.startsWith("data:") || ref.startsWith("#")) return full;
    const abs = safeUrl(baseUrl, ref);
    const local = abs && map.get(abs);
    if (!local || local === abs) return full;
    return `url(${q}${toRel(local)}${q})`;
  });
  out = out.replace(importRe, (full, ref) => {
    const abs = safeUrl(baseUrl, ref);
    const local = abs && map.get(abs);
    if (!local || local === abs) return full;
    return `@import "${toRel(local)}";`;
  });
  return out;
}

function guessKind(url) {
  const ext = extFromUrl(url).toLowerCase();
  if ([".css"].includes(ext)) return "css";
  if ([".js", ".mjs", ".cjs"].includes(ext)) return "js";
  if ([".woff", ".woff2", ".ttf", ".otf", ".eot"].includes(ext)) return "font";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".ico", ".bmp"].includes(ext)) return "img";
  return "asset";
}

/**
 * Scrape a website: download HTML + CSS + JS + images + fonts, rewrite paths
 * so the site works offline.
 *
 * args:
 *   url         (required) page to scrape
 *   outDir      (required) folder to save into
 *   sameOriginOnly  default true — only download assets from the same host
 *   concurrency default 8
 *   timeout     default 25000ms
 */
export async function scrapeWebsite(args) {
  let { url, outDir, sameOriginOnly = true, concurrency = 8, timeout = DEFAULT_TIMEOUT } =
    typeof args === "string" ? { url: args } : (args || {});
  if (!url) throw new Error("scrapeWebsite: 'url' is required");
  if (!outDir) outDir = "./scraped_site";

  await fs.mkdir(outDir, { recursive: true });

  // 1. Fetch HTML.
  const htmlRes = await axios.get(url, {
    timeout,
    headers: { "User-Agent": UA, "Accept": "text/html,*/*" },
    responseType: "text",
    transformResponse: [(d) => d],
    maxRedirects: 5,
  });
  const finalUrl = htmlRes.request?.res?.responseUrl || url;
  const html = String(htmlRes.data);
  const $ = cheerio.load(html, { decodeEntities: false });
  const origin = new URL(finalUrl).origin;

  const downloader = new Downloader({ outDir, concurrency, timeout });
  const allowed = (u) => {
    if (!u) return false;
    if (u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("javascript:")) return false;
    if (!sameOriginOnly) return true;
    try { return new URL(u).origin === origin; } catch { return false; }
  };

  // 2. Collect every referenced asset. Each entry is {selector callback} so we can rewrite later.
  const jobs = [];
  const enqueue = (rawRef, kind) => {
    if (!rawRef) return null;
    const abs = safeUrl(finalUrl, rawRef);
    if (!abs) return null;
    if (!allowed(abs)) return null;
    jobs.push({ url: abs, kind });
    return abs;
  };

  const rewrites = []; // {fn: () => void} run after download

  // <link href> — stylesheets, icons, preloads.
  $('link[href]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    const rel = ($el.attr("rel") || "").toLowerCase();
    let kind = "asset";
    if (rel.includes("stylesheet")) kind = "css";
    else if (rel.includes("icon")) kind = "img";
    else if (rel.includes("preload")) kind = guessKind(href);
    const abs = enqueue(href, kind);
    if (abs) rewrites.push((map) => { const l = map.get(abs); if (l && l !== abs) $el.attr("href", l); });
  });

  // <script src>.
  $('script[src]').each((_, el) => {
    const $el = $(el);
    const abs = enqueue($el.attr("src"), "js");
    if (abs) rewrites.push((map) => { const l = map.get(abs); if (l && l !== abs) $el.attr("src", l); });
  });

  // <img>, <source>, <video>, <audio>, <iframe>.
  const mediaSelectors = [
    ["img", ["src", "data-src", "data-lazy-src", "data-original"], "img"],
    ["source", ["src"], "img"],
    ["video", ["src", "poster"], "img"],
    ["audio", ["src"], "asset"],
    ["iframe", ["src"], "asset"],
    ["embed", ["src"], "asset"],
    ["object", ["data"], "asset"],
  ];
  for (const [sel, attrs, kind] of mediaSelectors) {
    $(sel).each((_, el) => {
      const $el = $(el);
      for (const a of attrs) {
        const v = $el.attr(a);
        if (!v) continue;
        const abs = enqueue(v, kind);
        if (abs) rewrites.push((map) => { const l = map.get(abs); if (l && l !== abs) $el.attr(a, l); });
      }
    });
  }

  // srcset / imagesrcset.
  for (const attr of ["srcset", "imagesrcset"]) {
    $(`[${attr}]`).each((_, el) => {
      const $el = $(el);
      const items = parseSrcset($el.attr(attr));
      const absItems = items.map((it) => ({ ...it, abs: enqueue(it.url, "img") }));
      rewrites.push((map) => {
        const newItems = absItems.map((it) => {
          const l = it.abs && map.get(it.abs);
          return { url: (l && l !== it.abs) ? l : it.url, descriptor: it.descriptor };
        });
        $el.attr(attr, buildSrcset(newItems));
      });
    });
  }

  // 3. Download everything in parallel.
  const map = await downloader.batch(jobs);

  // 4. Process inline <style> blocks: rewrite url(...) and download referenced assets.
  // We need a "fake local path" for inline styles so relative rewrites resolve from the HTML's location.
  const htmlOutPath = path.join(outDir, "index.html");
  const inlineTasks = [];
  $("style").each((_, el) => {
    const $el = $(el);
    const css = $el.html() || "";
    if (!css.trim()) return;
    inlineTasks.push((async () => {
      const rewritten = await rewriteCss(css, finalUrl, downloader, htmlOutPath);
      $el.text(rewritten);
    })());
  });

  // Inline style="..." attributes.
  $("[style]").each((_, el) => {
    const $el = $(el);
    const styleAttr = $el.attr("style") || "";
    if (!styleAttr.includes("url(")) return;
    inlineTasks.push((async () => {
      const rewritten = await rewriteCss(styleAttr, finalUrl, downloader, htmlOutPath);
      $el.attr("style", rewritten);
    })());
  });

  await Promise.all(inlineTasks);

  // 5. Process downloaded CSS files: rewrite their url(...) and @import to local paths.
  const cssJobs = jobs.filter((j) => j.kind === "css");
  await Promise.all(cssJobs.map(async (j) => {
    const local = map.get(j.url);
    if (!local || local === j.url) return;
    const abs = path.join(outDir, local);
    try {
      const buf = await fs.readFile(abs);
      const text = buf.toString("utf8");
      const rewritten = await rewriteCss(text, j.url, downloader, abs);
      await fs.writeFile(abs, rewritten);
    } catch { /* ignore */ }
  }));

  // 6. Apply HTML rewrites now that we know all local paths.
  for (const fn of rewrites) fn(map);

  // 7. Inject a <base> comment so it's clear this is a scrape (optional, harmless).
  $("head").prepend(`\n<!-- Scraped from ${finalUrl} on ${new Date().toISOString()} -->\n`);

  // 8. Write index.html.
  await fs.writeFile(htmlOutPath, $.html(), "utf8");

  const stats = downloader.summary();
  return {
    sourceUrl: finalUrl,
    outDir,
    htmlFile: path.relative(outDir, htmlOutPath).split(path.sep).join("/"),
    assets: {
      total: jobs.length,
      downloaded: stats.downloaded,
      failed: stats.failed,
      bytes: stats.bytes,
    },
    failedUrls: [...downloader.cache.entries()]
      .filter(([, v]) => v.status === "error")
      .slice(0, 20)
      .map(([u, v]) => ({ url: u, error: v.error })),
  };
}
