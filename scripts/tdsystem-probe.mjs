const BASE_URL = "https://www.tdsystem.co.jp/";
const TEAM_NAME = process.argv[2] || "RSケーニーズ";
const TEAM_PATTERNS = [
  TEAM_NAME,
  "ＲＳケーニーズ",
  "RSｹｰﾆｰｽﾞ",
  "ＲＳｹｰﾆｰｽﾞ",
  "ケーニーズ",
  "ｹｰﾆｰｽﾞ"
];
const MAX_PAGES = 180;

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 RS-Kenneys-Records/0.1",
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  const buffer = await response.arrayBuffer();
  const charset = /charset=([^;]+)/i.exec(response.headers.get("content-type") || "")?.[1] || "shift_jis";
  return new TextDecoder(charset, { fatal: false }).decode(buffer);
}

function textOnly(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(html, baseUrl) {
  const links = [];
  const anchorPattern = /<a\b[^>]*href=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html))) {
    const href = match[1];
    const label = textOnly(match[2]);
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) continue;
    links.push({ href: new URL(href, baseUrl).toString(), label });
  }
  return links;
}

function uniqueByUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });
}

async function main() {
  console.log(`取得開始: ${BASE_URL}`);
  const homeHtml = await fetchText(BASE_URL);
  const seedLinks = uniqueByUrl(extractLinks(homeHtml, BASE_URL))
    .filter((link) => /ProList|Result|Rank|Meet|Game|program|result|\.php/i.test(link.href))
    .slice(0, 40);

  console.log(`候補リンク: ${seedLinks.length}件`);
  seedLinks.slice(0, 12).forEach((link, index) => {
    console.log(`${index + 1}. ${link.label || "(labelなし)"} -> ${link.href}`);
  });

  const queue = seedLinks.map((link) => ({ ...link, depth: 1 }));
  const visited = new Set([BASE_URL]);
  const hits = [];
  while (queue.length && visited.size < MAX_PAGES) {
    const link = queue.shift();
    if (visited.has(link.href)) continue;
    visited.add(link.href);

    try {
      const html = await fetchText(link.href);
      const bodyText = textOnly(html);
      const hitPattern = TEAM_PATTERNS.find((pattern) => bodyText.includes(pattern));
      if (hitPattern) {
        const position = bodyText.indexOf(hitPattern);
        hits.push({ ...link, sample: bodyText.slice(Math.max(0, position - 140), position + 260) });
      }

      if (link.depth < 3) {
        const childLinks = extractLinks(html, link.href)
          .filter((child) => child.href.startsWith(BASE_URL))
          .filter((child) => /Pro|Result|Rank|Race|Team|Kumi|Order|Best|Entry|Print|\.php/i.test(child.href))
          .map((child) => ({ ...child, depth: link.depth + 1 }));
        for (const child of childLinks) {
          if (!visited.has(child.href) && !queue.some((item) => item.href === child.href)) {
            queue.push(child);
          }
        }
      }
    } catch (error) {
      console.log(`取得失敗: ${link.href} (${error.message})`);
    }
  }

  console.log(`調査ページ: ${visited.size}件`);
  console.log(`チーム名ヒット: ${hits.length}件`);
  hits.forEach((hit, index) => {
    console.log(`--- hit ${index + 1}: ${hit.label}`);
    console.log(hit.href);
    console.log(hit.sample);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
