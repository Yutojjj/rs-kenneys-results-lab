import { fileURLToPath } from "node:url";

const BASE_URL = "https://www.tdsystem.co.jp/";
const DEFAULT_TEAM = "RSケーニーズ";
const TEAM_ALIASES = ["RSケーニーズ", "ＲＳケーニーズ", "RSｹｰﾆｰｽﾞ", "ＲＳｹｰﾆｰｽﾞ", "ケーニーズ", "ｹｰﾆｰｽﾞ"];
const MAX_MEETS = 90;
const REQUEST_DELAY_MS = 0;
const MEET_CONCURRENCY = 8;

export async function scrapeTdsystemRecords({ team = DEFAULT_TEAM, source = BASE_URL, limitMeets = MAX_MEETS, months = 12, futureMonths = 6 } = {}) {
  const meetLinks = await collectMeetLinks({ source, months, futureMonths, limitMeets });
  const records = [];
  const scannedMeets = [];
  const upcomingMeets = [];
  const today = formatDateForCompare(new Date());

  await mapWithConcurrency(meetLinks, MEET_CONCURRENCY, async (meetLink) => {
    const teamListUrl = withSearchParams(meetLink.href, { L: "2" });
    const teamListHtml = await fetchText(teamListUrl);
    const meet = parseMeetInfo(teamListHtml, meetLink);
    const teamProgram = parseTeamProgram(teamListHtml, team);
    scannedMeets.push({ title: meet.name, url: meetLink.href, teamFound: Boolean(teamProgram) });

    if (isUpcomingMeet(meet, today)) {
      upcomingMeets.push({
        id: stableId([meet.date, meet.name, meet.url]),
        date: meet.date,
        endDate: meet.endDate || meet.date,
        name: meet.name,
        place: meet.place,
        sourceUrl: meet.url,
        teamFound: Boolean(teamProgram),
        status: "upcoming"
      });
      return;
    }

    if (!teamProgram) return;

    await delay(REQUEST_DELAY_MS);
    const recordUrl = buildRecordUrl(meetLink.href, teamProgram.p, "2");
    const recordHtml = await fetchText(recordUrl);
    records.push(...parseRecordRows(recordHtml, { meet, recordUrl, team }));
  });

  return {
    team,
    source,
    fetchedAt: new Date().toISOString(),
    scannedMeets,
    upcomingMeets: uniqueMeets(upcomingMeets).sort((a, b) => a.date.localeCompare(b.date)),
    records: uniqueRecords(records).sort((a, b) => b.date.localeCompare(a.date))
  };
}

async function collectMeetLinks({ source, months, futureMonths, limitMeets }) {
  const monthUrls = buildMonthUrls(source, months, futureMonths);
  const links = [];

  for (const monthUrl of monthUrls) {
    await delay(REQUEST_DELAY_MS);
    const html = await fetchText(monthUrl);
    links.push(...parseMeetLinksFromMonth(html, monthUrl));
  }

  return uniqueByHref(links).slice(0, limitMeets);
}

function buildMonthUrls(source, months, futureMonths = 0) {
  const urls = [];
  const now = new Date();
  for (let offset = futureMonths; offset >= -months + 1; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const url = new URL(source);
    url.searchParams.set("Y", String(date.getFullYear()));
    url.searchParams.set("M", String(date.getMonth() + 1));
    urls.push(url.toString());
  }
  return urls;
}

function parseMeetLinksFromMonth(html, pageUrl) {
  const page = new URL(pageUrl);
  const year = page.searchParams.get("Y") || String(new Date().getFullYear());
  const month = page.searchParams.get("M") || String(new Date().getMonth() + 1);
  const rows = html.match(/<TR[\s\S]*?<\/TR>/gi) || [];

  return rows
    .map((row) => {
      const gameId = /name=['"]G['"]\s+value=?"?(\d+)"?/i.exec(row)?.[1];
      if (!gameId) return null;
      const cells = extractCells(row);
      const dateRange = parseMonthRowDate(cells[0], year, month);
      const label = cells[1] || `大会 ${gameId}`;
      const place = cells[2] || "";
      const href = new URL("ProList.php", pageUrl);
      href.searchParams.set("Y", year);
      href.searchParams.set("M", String(month).padStart(2, "0"));
      href.searchParams.set("GL", "0");
      href.searchParams.set("G", gameId);
      return { href: href.toString(), label, place, date: dateRange.date, endDate: dateRange.endDate };
    })
    .filter(Boolean);
}

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
  const charset = /charset=([^;]+)/i.exec(response.headers.get("content-type") || "")?.[1] || "utf-8";
  return new TextDecoder(charset, { fatal: false }).decode(buffer);
}

function extractLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const href = match[1];
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) continue;
    links.push({ href: new URL(href, baseUrl).toString(), label: cleanText(match[2]) });
  }
  return links;
}

function uniqueByHref(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });
}

function parseMeetInfo(html, link) {
  const plain = cleanText(html).replace(/\s+/g, " ");
  const meetName = /戻る\s*([^<]+?)\s*20\d{2}年/.exec(plain)?.[1]?.trim() || link.label || "大会名未取得";
  const dateLine = /(20\d{2})年(\d{1,2})月(\d{1,2})日[^\s　]*[　\s]+([^<]+?)\(\d+m\)/.exec(plain);
  const date = dateLine ? `${dateLine[1]}/${dateLine[2].padStart(2, "0")}/${dateLine[3].padStart(2, "0")}` : link.date || "";
  const place = dateLine?.[4]?.trim() || link.place || "";
  return { name: meetName, date, endDate: link.endDate || date, place, url: link.href };
}

function parseTeamProgram(html, team) {
  const rows = html.match(/<TR[\s\S]*?<\/TR>/gi) || [];
  for (const row of rows) {
    const cells = extractCells(row);
    const teamName = cells[0] || "";
    if (!teamAliases(team).some((alias) => teamName.includes(alias))) continue;
    const p = /name=['"]P['"]\s+value=?"?(\d+)"?/i.exec(row)?.[1];
    if (p) return { p, teamName };
  }
  return null;
}

function buildRecordUrl(proListUrl, p, listType = "1") {
  const url = new URL("Record.php", proListUrl);
  const source = new URL(proListUrl);
  for (const key of ["Y", "M", "G", "GL"]) {
    url.searchParams.set(key, source.searchParams.get(key) || "");
  }
  url.searchParams.set("S", "2");
  url.searchParams.set("Lap", "1");
  url.searchParams.set("Cls", "999");
  url.searchParams.set("L", listType);
  url.searchParams.set("RG", "1");
  url.searchParams.set("Page", "ProList.php");
  url.searchParams.set("P", p);
  return url.toString();
}

function parseRecordRows(html, context) {
  const records = [];
  const chunks = html.split(/(<H3>[\s\S]*?<\/H3>)/i);
  let currentEvent = "";

  for (const chunk of chunks) {
    if (/^<H3>/i.test(chunk)) {
      const heading = cleanText(chunk);
      if (/^No\.\d+/.test(heading)) currentEvent = heading.replace(/^No\.\d+\s*/, "");
      continue;
    }

    const rows = chunk.match(/<TR[\s\S]*?<\/TR>/gi) || [];
    for (const row of rows) {
      const cells = extractCells(row);
      if (cells.length < 7 || cells[0] === "順位") continue;
      const [rank, swimmer, teamName, grade, time, newRecord, note] = cells;
      if (!teamAliases(context.team).some((alias) => teamName.includes(alias))) continue;
      if (!/\d/.test(time)) continue;

      records.push({
        id: stableId([context.meet.date, currentEvent, swimmer, teamName, time, context.recordUrl]),
        team: context.team,
        date: context.meet.date,
        swimmer: normalizeName(swimmer),
        event: currentEvent || "種目未取得",
        time,
        meet: context.meet.name,
        place: context.meet.place,
        rank,
        grade,
        note: [newRecord, note].filter(Boolean).join(" / "),
        sourceUrl: context.recordUrl
      });
    }
  }

  return records;
}

function extractCells(row) {
  const cells = [];
  const pattern = /<T[HD]\b[^>]*>([\s\S]*?)<\/T[HD]>/gi;
  let match;
  while ((match = pattern.exec(row))) {
    cells.push(cleanText(match[1]));
  }
  return cells;
}

function cleanText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(name) {
  return cleanText(name).replace(/\s+/g, " ");
}

function withSearchParams(url, params) {
  const nextUrl = new URL(url);
  Object.entries(params).forEach(([key, value]) => nextUrl.searchParams.set(key, value));
  return nextUrl.toString();
}

function teamAliases(team) {
  return Array.from(new Set([team, ...TEAM_ALIASES]));
}

function uniqueRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
}

function uniqueMeets(meets) {
  const seen = new Set();
  return meets.filter((meet) => {
    const key = `${meet.date}-${meet.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseMonthRowDate(value, year, month) {
  const text = cleanText(value);
  const days = Array.from(text.matchAll(/(\d{1,2})日/g)).map((match) => Number(match[1]));
  const startDay = days[0];
  const endDay = days[days.length - 1] || startDay;
  return {
    date: startDay ? formatDateParts(year, month, startDay) : "",
    endDate: endDay ? formatDateParts(year, month, endDay) : ""
  };
}

function isUpcomingMeet(meet, today) {
  const endDate = meet.endDate || meet.date;
  return Boolean(endDate && endDate >= today);
}

function formatDateParts(year, month, day) {
  return `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function formatDateForCompare(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function stableId(parts) {
  let hash = 0;
  const input = parts.join("|");
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return `tds-${hash.toString(16)}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items, concurrency, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  scrapeTdsystemRecords({
    team: process.argv[2] || DEFAULT_TEAM,
    limitMeets: Number(process.argv[3] || MAX_MEETS),
    months: Number(process.argv[4] || 12),
    futureMonths: Number(process.argv[5] || 6)
  })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
