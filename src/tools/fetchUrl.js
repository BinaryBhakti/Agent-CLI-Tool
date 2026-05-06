import axios from "axios";

export async function fetchUrl(url) {
  if (typeof url !== "string") url = String(url);
  const { data } = await axios.get(url, {
    timeout: 20000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; GenAI-CLI-Cloner/1.0; +https://example.com)",
    },
    responseType: "text",
    transformResponse: [(d) => d],
  });
  const html = String(data);
  return html.length > 20000 ? html.slice(0, 20000) + "\n<!-- truncated -->" : html;
}
