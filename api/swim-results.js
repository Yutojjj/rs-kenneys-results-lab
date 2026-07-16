const DEFAULT_TEAM = "RSケーニーズ";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const team = DEFAULT_TEAM;
  const feedUrl = process.env.SWIM_RESULTS_FEED_URL;
  if (!feedUrl) {
    response.status(200).json({ records: [], upcomingMeets: [], sourceStatus: "feed-not-configured", checkedAt: new Date().toISOString() });
    return;
  }

  try {
    const upstream = await fetch(feedUrl, { headers: { Accept: "application/json", "User-Agent": "RS-Kenneys-Results-Lab/1.0" } });
    if (!upstream.ok) throw new Error(`upstream returned ${upstream.status}`);
    const payload = await upstream.json();
    const records = findRecordArray(payload)
      .map(normalizeFeedRecord)
      .filter((record) => record.swimmer && record.date && record.event)
      .filter((record) => !record.team || matchesTeam(record.team, team));
    const upcomingMeets = findMeetArray(payload)
      .map((meet, index) => normalizeFeedMeet(meet, team, index))
      .filter((meet) => meet.date && meet.entries.length > 0);

    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=1800");
    response.status(200).json({ records, upcomingMeets, sourceStatus: "ok", checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Swim results sync failed", error);
    response.status(502).json({ error: "結果データの取得に失敗しました。", records: [], upcomingMeets: [] });
  }
}

function findRecordArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.data?.records)) return payload.data.records;
  if (Array.isArray(payload?.data?.players)) return payload.data.players;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function findMeetArray(payload) {
  if (Array.isArray(payload?.upcomingMeets)) return payload.upcomingMeets;
  if (Array.isArray(payload?.meets)) return payload.meets;
  if (Array.isArray(payload?.competitions)) return payload.competitions;
  if (Array.isArray(payload?.data?.upcomingMeets)) return payload.data.upcomingMeets;
  if (Array.isArray(payload?.data?.meets)) return payload.data.meets;
  return [];
}

function normalizeFeedRecord(record) {
  const eventParts = [record.gender || record.gender_name, record.age_class || record.class_name, record.distance || record.distance_name, record.style || record.swimming_style_name, record.round || record.race_division_name].filter(Boolean);
  return {
    id: record.id || record.result_id || record.record_id || "",
    team: record.team || record.club || record.club_name || record.entry_group_name || "",
    date: normalizeDate(record.date || record.event_date || record.race_date),
    swimmer: record.swimmer || record.player_name || record.swimmer_name || record.name || "",
    event: record.event || record.event_name || eventParts.join(" "),
    time: record.time || record.record || record.result_time || record.record_value || "",
    rank: record.rank || record.ranking || record.place_rank || "",
    meet: record.meet || record.tournament_name || record.competition_name || "",
    place: record.place || record.venue || record.venue_name || "",
    sourceUrl: record.sourceUrl || record.url || ""
  };
}

function normalizeFeedMeet(meet, team, index) {
  const rawEntries = meet.entries || meet.entrants || meet.members || meet.players || [];
  const entries = rawEntries
    .map(normalizeFeedEntry)
    .filter((entry) => entry.swimmer && entry.event)
    .filter((entry) => !entry.team || matchesTeam(entry.team, team));
  return {
    id: meet.id || meet.competition_id || `upcoming-${index}`,
    date: normalizeDate(meet.date || meet.startDate || meet.start_date),
    endDate: normalizeDate(meet.endDate || meet.end_date || meet.date || meet.startDate),
    name: meet.name || meet.title || meet.tournament_name || meet.competition_name || "大会名未取得",
    place: meet.place || meet.venue || meet.venue_name || "",
    sourceUrl: meet.sourceUrl || meet.url || "",
    team,
    status: "upcoming",
    entries
  };
}

function normalizeFeedEntry(entry) {
  const eventParts = [entry.gender || entry.gender_name, entry.distance || entry.distance_name, entry.style || entry.swimming_style_name, entry.round || entry.race_division_name].filter(Boolean);
  return {
    id: entry.id || entry.entry_id || "",
    team: entry.team || entry.club || entry.club_name || entry.entry_group_name || "",
    swimmer: entry.swimmer || entry.player_name || entry.swimmer_name || entry.name || "",
    reading: entry.reading || entry.kana || entry.player_kana || "",
    gender: entry.gender || entry.gender_name || "",
    age: Number(entry.age) || "",
    event: entry.event || entry.event_name || eventParts.join(" "),
    entryTime: entry.entryTime || entry.entry_time || entry.seed_time || ""
  };
}

function normalizeDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10).replace(/-/g, "/");
}

function matchesTeam(value, team) {
  const normalize = (text) => String(text || "").normalize("NFKC").replace(/[\s・･]/g, "").toLowerCase();
  const normalizedValue = normalize(value);
  return normalizedValue === normalize(team) || normalizedValue.includes("ケーニーズ");
}
