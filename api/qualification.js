const OFFICIAL_BASE_URL = "https://aquatics.or.jp/swim/qualification";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const gender = String(request.query.gender || "");
  const age = Number(request.query.age);
  if (!(["男子", "女子"].includes(gender)) || !Number.isFinite(age) || age < 1 || age > 99) {
    response.status(400).json({ error: "性別と年齢を正しく指定してください。" });
    return;
  }

  const sourceUrl = `${OFFICIAL_BASE_URL}/${qualificationSlug(gender, age)}/`;
  try {
    const officialResponse = await fetch(sourceUrl, {
      headers: { "User-Agent": "RS-Kenneys-Results-Lab/1.0" }
    });
    if (!officialResponse.ok) throw new Error(`official site returned ${officialResponse.status}`);
    const html = await officialResponse.text();
    const standards = parseQualificationTables(html);
    if (!standards.length) throw new Error("qualification tables were not found");

    response.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    response.status(200).json({ gender, age, sourceUrl, standards });
  } catch (error) {
    response.status(502).json({ error: "日本水泳連盟の資格級表を取得できませんでした。", detail: error.message });
  }
}

function qualificationSlug(gender, age) {
  const prefix = gender === "男子" ? "mens" : "woman";
  if (age <= 8) return `${prefix}_under08`;
  if (age >= 19) return `${prefix}_over19`;
  if (age >= 17) return `${prefix}_17-18`;
  if (age >= 15) return `${prefix}_15-16`;
  return `${prefix}_${String(age).padStart(2, "0")}`;
}

function parseQualificationTables(html) {
  const tables = [];
  const blockPattern = /<h3[^>]*class=["'][^"']*heading[^"']*["'][^>]*>([\s\S]*?)<\/h3>[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/gi;
  let blockMatch;
  while ((blockMatch = blockPattern.exec(html))) {
    const heading = cleanText(blockMatch[1]);
    const tableHtml = blockMatch[2];
    const headHtml = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || "";
    const headerCells = extractCells(headHtml, "th").map((value) => Number(value.replace(/\D/g, ""))).filter(Boolean);
    const rows = [];
    let currentClass = "";
    const bodyHtml = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] || "";
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowPattern.exec(bodyHtml))) {
      const labels = extractCells(rowMatch[1], "th");
      const times = extractCells(rowMatch[1], "td");
      if (!labels.length || !times.length) continue;
      if (/^(AA|A|B)$/.test(labels[0])) currentClass = labels.shift();
      const grade = Number(labels[0]);
      if (!grade) continue;
      rows.push({
        grade,
        className: currentClass,
        times: Object.fromEntries(headerCells.map((distance, index) => [String(distance), times[index] || ""]))
      });
    }
    if (rows.length) tables.push({ stroke: qualificationStroke(heading), heading, rows });
  }
  return tables;
}

function extractCells(html, tagName) {
  const values = [];
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  let match;
  while ((match = pattern.exec(html))) values.push(cleanText(match[1]));
  return values;
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function qualificationStroke(heading) {
  if (heading.includes("自由形")) return "自由形";
  if (heading.includes("背泳ぎ")) return "背泳ぎ";
  if (heading.includes("平泳ぎ")) return "平泳ぎ";
  if (heading.includes("バタフライ")) return "バタフライ";
  if (heading.includes("個人メドレー")) return "個人メドレー";
  return heading;
}
