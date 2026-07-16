const API_BASE = "https://result.swim.or.jp/api/v1";
const PLAYER_SEARCH_URL = "https://result.swim.or.jp/player-search";
const TEAM_NAME = "RSケーニーズ";
const TEAM_SEARCH_TERM = "ケーニーズ";
const TEAM_CODE = "22285";
const PERIOD_CODE = 3;

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const months = clampNumber(request.query?.months, 12, 1, 24);
    const cutoff = createCutoffDate(months);
    const rosterPayload = await fetchOfficialJson("/athletes", {
      entry_group_name: TEAM_SEARCH_TERM,
      member_group_code: 99,
      school_class_code: 99,
      gender_code: 99
    });
    const members = (rosterPayload?.data || []).filter((member) => String(member?.entry_group?.code || "") === TEAM_CODE);

    const membersWithEntries = await mapLimit(members, 12, async (member) => {
      const athleteId = encodeAthleteCode(member.swimmer_code);
      try {
        const entries = await fetchOfficialJson(`/athletes/${athleteId}/entries`, { period_code: PERIOD_CODE });
        return { member, athleteId, entries: Array.isArray(entries) ? entries : [] };
      } catch (error) {
        console.warn(`Entry fetch failed for ${member.swimmer_code}`, error.message);
        return { member, athleteId, entries: [] };
      }
    });

    const jobs = buildRecordJobs(membersWithEntries);
    let failedJobs = 0;
    const resultGroups = await mapLimit(jobs, 16, async (job) => {
      try {
        const payload = await fetchOfficialJson(
          `/athletes/${job.athleteId}/results/waterways/${job.waterway.code}/swimming_styles/${job.entry.swimming_style.code}/distances/${job.entry.distance.code}/records`,
          { period_code: PERIOD_CODE }
        );
        return normalizeOfficialRecords(payload, job, cutoff);
      } catch (error) {
        failedJobs += 1;
        console.warn(`Record fetch failed for ${job.member.swimmer_code}`, error.message);
        return [];
      }
    });

    const records = dedupeRecords(resultGroups.flat()).sort((a, b) => b.date.localeCompare(a.date));
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    response.status(200).json({
      records,
      upcomingMeets: [],
      members: members.map(normalizeMember),
      sourceStatus: failedJobs ? "partial" : "ok",
      diagnostics: {
        memberCount: members.length,
        recordCount: records.length,
        failedRecordRequests: failedJobs
      },
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Official swim results sync failed", error);
    response.status(502).json({
      error: "日本水泳連盟の選手記録を取得できませんでした。時間をおいて再度更新してください。",
      records: [],
      upcomingMeets: []
    });
  }
}

function buildRecordJobs(membersWithEntries) {
  const jobs = [];
  for (const item of membersWithEntries) {
    for (const entry of item.entries) {
      for (const waterway of entry.waterways || []) {
        jobs.push({ ...item, entry, waterway });
      }
    }
  }
  return jobs;
}

function normalizeOfficialRecords(payload, job, cutoff) {
  const member = job.member;
  const sourceUrl = `https://result.swim.or.jp/athletes/${job.athleteId}`;
  const grade = formatSchoolGrade(member.school_class);
  const gender = member.gender?.name || "";
  const distance = job.entry.distance?.name || "";
  const style = job.entry.swimming_style?.name || "";
  const waterway = job.waterway?.name || "";
  const records = [];

  for (const yearGroup of payload?.result || []) {
    for (const result of yearGroup?.data || []) {
      const date = normalizeDate(result.result_date);
      if (!date || date < cutoff) continue;
      const division = result.division?.name || "";
      records.push({
        id: `result-swim-${result.result_id}`,
        resultId: result.result_id,
        memberCode: String(member.swimmer_code || ""),
        team: TEAM_NAME,
        date,
        swimmer: member.swimmer_name || "",
        gender,
        grade,
        event: [gender, distance, style, division, waterway ? `(${waterway})` : ""].filter(Boolean).join(" "),
        time: result.result_time || "",
        rank: "",
        meet: String(result.game_name || "").replace(/^[^：:]+[：:]/, ""),
        place: "",
        note: result.is_best_record ? "公式サイト自己ベスト" : "",
        isBestRecord: Boolean(result.is_best_record),
        sourceUrl
      });
    }
  }
  return records;
}

function normalizeMember(member) {
  return {
    code: String(member.swimmer_code || ""),
    name: member.swimmer_name || "",
    team: TEAM_NAME,
    teamCode: TEAM_CODE,
    gender: member.gender?.name || "",
    grade: formatSchoolGrade(member.school_class),
    sourceUrl: `${PLAYER_SEARCH_URL}?entry_group_name=${encodeURIComponent(TEAM_SEARCH_TERM)}`
  };
}

async function fetchOfficialJson(path, params = {}, attempt = 0) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "RS-Kenneys-Results-Lab/1.0"
      }
    });
    if (!upstream.ok) {
      if (attempt < 1 && (upstream.status === 429 || upstream.status >= 500)) {
        await delay(350);
        return fetchOfficialJson(path, params, attempt + 1);
      }
      throw new Error(`Official API returned ${upstream.status}`);
    }
    return upstream.json();
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

function dedupeRecords(records) {
  const byId = new Map();
  records.forEach((record) => byId.set(record.id, record));
  return Array.from(byId.values());
}

function encodeAthleteCode(code) {
  return 3 * (Number(code) + 10000000) + 3;
}

function formatSchoolGrade(schoolClass) {
  const name = schoolClass?.name || "";
  const grade = schoolClass?.school_grades || schoolClass?.school_grade || "";
  const prefix = name === "小学" ? "小" : name === "中学" ? "中" : name === "高校" ? "高" : name === "大学" ? "大" : name;
  return grade && Number(grade) !== 99 ? `${prefix}${grade}` : prefix;
}

function createCutoffDate(months) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return `${cutoff.getFullYear()}/${String(cutoff.getMonth() + 1).padStart(2, "0")}/${String(cutoff.getDate()).padStart(2, "0")}`;
}

function normalizeDate(value) {
  return String(value || "").slice(0, 10).replace(/-/g, "/");
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
