import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { scrapeTdsystemRecords } from "./tdsystem-scraper.mjs";

const port = Number(process.env.PORT || 4173);
const root = normalize(join(process.cwd(), "dist"));
const apiCache = new Map();
const API_CACHE_MS = 12 * 60 * 60 * 1000;

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/api/tdsystem-records") {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    const options = {
      team: url.searchParams.get("team") || "RSケーニーズ",
      source: url.searchParams.get("source") || "https://www.tdsystem.co.jp/",
      limitMeets: Number(url.searchParams.get("limitMeets") || 240),
      months: Number(url.searchParams.get("months") || 12),
      futureMonths: Number(url.searchParams.get("futureMonths") || 6)
    };
    const cacheKey = JSON.stringify(options);
    const cached = apiCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < API_CACHE_MS) {
      response.end(JSON.stringify({ ...cached.result, cached: true }));
      return;
    }

    scrapeTdsystemRecords({
      team: options.team,
      source: options.source,
      limitMeets: options.limitMeets,
      months: options.months,
      futureMonths: options.futureMonths
    })
      .then((result) => {
        apiCache.set(cacheKey, { savedAt: Date.now(), result });
        response.end(JSON.stringify({ ...result, cached: false }));
      })
      .catch((error) => {
        response.statusCode = 502;
        response.end(JSON.stringify({ records: [], error: error.message }));
      });
    return;
  }

  const requestedPath = decodeURIComponent(url.pathname);
  const safePath = normalize(join(root, requestedPath));
  const filePath = safePath.startsWith(root) && existsSync(safePath) && statSync(safePath).isFile()
    ? safePath
    : join(root, "index.html");

  response.setHeader("Content-Type", types[extname(filePath)] || "application/octet-stream");
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`RSケーニーズ 記録ボード: http://127.0.0.1:${port}/`);
});
