import axios from "axios";
import * as cheerio from "cheerio";

const HEX_RE = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;
const RGB_RE = /rgba?\([^)]+\)/g;

function rgbToHex(rgb) {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return null;
  const [r, g, b] = m.slice(0, 3).map((n) => Math.max(0, Math.min(255, parseInt(n, 10))));
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function topN(arr, n) {
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
}

function abs(base, src) {
  try { return new URL(src, base).toString(); } catch { return src; }
}

// Skip near-white/near-black so we get actual brand colors at the top of the palette
function isInteresting(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 25) return false;       // near black
  if (min > 235) return false;      // near white
  if (max - min < 15) return false; // near gray
  return true;
}

export async function extractDesign(url) {
  if (typeof url !== "string") url = String(url);
  const { data: html } = await axios.get(url, {
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; GenAI-CLI-Cloner/1.0)" },
    responseType: "text",
    transformResponse: [(d) => d],
  });
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim() || $('meta[property="og:title"]').attr("content") || "";
  const description =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") || "";
  const ogImage = $('meta[property="og:image"]').attr("content") || "";
  const themeColor = $('meta[name="theme-color"]').attr("content") || "";

  // logo
  const logoSrc =
    $('img[alt*="logo" i]').first().attr("src") ||
    $('header img').first().attr("src") ||
    $('a[class*="logo" i] img').first().attr("src") || "";

  // Aggregate CSS
  let cssBlob = "";
  $("style").each((_, el) => (cssBlob += "\n" + $(el).html()));
  $("[style]").each((_, el) => (cssBlob += "\n" + ($(el).attr("style") || "")));

  const cssLinks = $('link[rel="stylesheet"]')
    .map((_, el) => $(el).attr("href"))
    .get().filter(Boolean).slice(0, 4).map((href) => abs(url, href));
  for (const link of cssLinks) {
    try {
      const { data } = await axios.get(link, { timeout: 8000, responseType: "text", transformResponse: [(d) => d] });
      cssBlob += "\n" + String(data).slice(0, 80000);
    } catch { /* ignore */ }
  }

  // CSS custom properties — often hold brand tokens
  const cssVars = {};
  for (const m of cssBlob.matchAll(/(--[a-z0-9-_]+)\s*:\s*([^;}\n]+)/gi)) {
    const k = m[1].trim(), v = m[2].trim();
    if (!cssVars[k] && v.length < 80) cssVars[k] = v;
  }

  // Palette
  const hexes = (cssBlob.match(HEX_RE) || []).map((c) => c.toLowerCase());
  const rgbs = (cssBlob.match(RGB_RE) || []).map(rgbToHex).filter(Boolean);
  const all = [...hexes, ...rgbs];
  const interesting = all.filter(isInteresting);
  const palette = [...new Set([...topN(interesting, 6), ...topN(all, 4)])].slice(0, 8);

  // Fonts
  const fontFamilies = [];
  for (const ff of cssBlob.match(/font-family\s*:\s*([^;{}]+)/gi) || []) {
    const fams = ff.split(":")[1].split(",").map((s) => s.trim().replace(/['";]/g, ""));
    for (const f of fams) {
      if (!f) continue;
      if (/^(inherit|initial|unset|sans-serif|serif|monospace|system-ui|-apple-system|BlinkMacSystemFont|"?Segoe UI"?|Roboto|Helvetica|Arial)$/i.test(f)) continue;
      fontFamilies.push(f);
    }
  }
  $('link[href*="fonts.googleapis.com"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    for (const m of href.match(/family=([^&:]+)/g) || []) {
      fontFamilies.push(decodeURIComponent(m.replace("family=", "").replace(/\+/g, " ")));
    }
  });
  const fonts = topN(fontFamilies, 4);
  const googleFontsHref = $('link[href*="fonts.googleapis.com/css"]').first().attr("href") || "";

  // Headings & sections
  const headings = [];
  $("h1, h2, h3").each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, " ");
    if (t && t.length < 200) headings.push({ level: el.tagName.toLowerCase(), text: t });
  });

  // Section snippets — pair each h2/h3 with the next paragraph
  const sections = [];
  $("h2, h3").each((_, el) => {
    const heading = $(el).text().trim().replace(/\s+/g, " ");
    let body = "";
    const next = $(el).next("p, div");
    if (next && next.length) body = next.text().trim().replace(/\s+/g, " ").slice(0, 300);
    if (heading) sections.push({ heading, body });
  });

  // Nav
  const navLinks = [];
  $("nav a, header a").each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, " ");
    const href = $(el).attr("href") || "#";
    if (t && t.length < 60) navLinks.push({ text: t, href });
  });

  const heroHeading = $("h1").first().text().trim() || (headings[0] && headings[0].text) || title;
  const heroSubhead =
    $("h1").first().nextAll("p").first().text().trim().slice(0, 300) ||
    description;

  // CTA buttons
  const ctas = [];
  $('a, button').each((_, el) => {
    const $el = $(el);
    const cls = ($el.attr("class") || "").toLowerCase();
    const t = $el.text().trim().replace(/\s+/g, " ");
    if (!t || t.length > 40) return;
    if (/btn|button|cta|primary|signup|enroll|register|start|book|join|apply/i.test(cls)) {
      ctas.push(t);
    }
  });
  const ctaText = topN(ctas, 1)[0] || "Get Started";
  const secondaryCtaText = topN(ctas, 3)[1] || "Learn More";

  // Footer
  const footerText = $("footer").text().trim().replace(/\s+/g, " ").slice(0, 400) || `© ${new Date().getFullYear()} ${title}`;
  const footerLinks = [];
  $("footer a").each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, " ");
    if (t && t.length < 50) footerLinks.push(t);
  });

  // Images (skip 1x1, data:, svg sprites)
  const images = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-lazy-src");
    if (!src || src.startsWith("data:")) return;
    images.push({ src: abs(url, src), alt: $(el).attr("alt") || "" });
  });

  return {
    sourceUrl: url,
    title,
    description,
    themeColor,
    ogImage: ogImage ? abs(url, ogImage) : "",
    logoSrc: logoSrc ? abs(url, logoSrc) : "",
    palette,
    cssVars: Object.fromEntries(Object.entries(cssVars).slice(0, 20)),
    fonts,
    googleFontsHref,
    headings: headings.slice(0, 16),
    sections: sections.slice(0, 8),
    navLinks: navLinks.slice(0, 10),
    heroHeading,
    heroSubhead,
    ctaText,
    secondaryCtaText,
    footerText,
    footerLinks: [...new Set(footerLinks)].slice(0, 16),
    images: images.slice(0, 14),
  };
}
