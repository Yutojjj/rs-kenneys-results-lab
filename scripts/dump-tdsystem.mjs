const url = process.argv[2] || "https://www.tdsystem.co.jp/ProList.php?Y=2026&M=07&GL=0&G=155";

const response = await fetch(url, {
  headers: {
    "User-Agent": "Mozilla/5.0 RS-Kenneys-Records/0.1",
    Accept: "text/html,application/xhtml+xml"
  }
});

const buffer = await response.arrayBuffer();
const charset = /charset=([^;]+)/i.exec(response.headers.get("content-type") || "")?.[1] || "shift_jis";
const text = new TextDecoder(charset, { fatal: false }).decode(buffer);
console.log(text.slice(0, Number(process.argv[3] || 12000)));
