const qualificationCache = new Map();

export async function loadQualificationStandards(gender, age) {
  if (!gender || !age) return null;
  const key = `${gender}:${ageGroup(age)}`;
  if (!qualificationCache.has(key)) {
    qualificationCache.set(key, fetchQualificationStandards(gender, age));
  }
  return qualificationCache.get(key);
}

export function evaluateRecordQualification(record, qualificationData) {
  if (!record?.time || !qualificationData?.standards) return null;
  const event = qualificationEvent(record.event);
  if (!event || /リレー/.test(record.event || "")) return null;
  const table = qualificationData.standards.find((item) => item.stroke === event.stroke && item.rows.some((row) => row.times[String(event.distance)]));
  if (!table) return null;
  const resultSeconds = timeToSeconds(record.time);
  if (!Number.isFinite(resultSeconds)) return null;
  const matched = [...table.rows]
    .sort((a, b) => b.grade - a.grade)
    .find((row) => resultSeconds <= timeToSeconds(row.times[String(event.distance)]));
  return matched ? { grade: matched.grade, className: matched.className, label: `${matched.grade}級`, sourceUrl: qualificationData.sourceUrl } : null;
}

export function bestQualification(records, qualificationData) {
  return records
    .map((record) => evaluateRecordQualification(record, qualificationData))
    .filter(Boolean)
    .sort((a, b) => b.grade - a.grade)[0] || null;
}

export function qualificationEvent(value) {
  const text = String(value || "").normalize("NFKC");
  const distance = Number(text.match(/(50|100|200|400|800|1500)m/i)?.[1]);
  let stroke = "";
  if (text.includes("個人メドレー")) stroke = "個人メドレー";
  else if (text.includes("バタフライ")) stroke = "バタフライ";
  else if (text.includes("平泳ぎ")) stroke = "平泳ぎ";
  else if (text.includes("背泳ぎ")) stroke = "背泳ぎ";
  else if (text.includes("自由形")) stroke = "自由形";
  return stroke && distance ? { stroke, distance } : null;
}

function ageGroup(age) {
  const value = Number(age);
  if (value <= 8) return "under08";
  if (value >= 19) return "over19";
  if (value >= 17) return "17-18";
  if (value >= 15) return "15-16";
  return String(value);
}

async function fetchQualificationStandards(gender, age) {
  const cacheKey = `qualification:2026:${gender}:${ageGroup(age)}`;
  try {
    const cached = JSON.parse(window.localStorage.getItem(cacheKey) || "null");
    if (cached?.savedAt && Date.now() - cached.savedAt < 86400000) return cached.data;
  } catch {
  }
  const url = new URL("/api/qualification", window.location.origin);
  url.searchParams.set("gender", gender);
  url.searchParams.set("age", String(age));
  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("資格級表を取得できませんでした。");
  const data = await response.json();
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
  }
  return data;
}

function timeToSeconds(value) {
  const parts = String(value || "").replace(/秒/g, "").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  return parts.length === 1 ? parts[0] : parts.reduce((total, part) => total * 60 + part, 0);
}
