const STORAGE_KEY = "rs-kenneys-results-lab-state";

const demoRecentResults = [
  {
    id: "demo-20260712-001",
    date: "2026/07/12",
    swimmer: "山田 湊",
    event: "男子 50m 自由形",
    time: "25.84",
    meet: "2026年度JSCA岐阜県クラブ対抗水泳競技大会",
    place: "長良川スイミングプラザ",
    note: "自己新"
  },
  {
    id: "demo-20260712-002",
    date: "2026/07/12",
    swimmer: "佐藤 凛",
    event: "女子 100m 背泳ぎ",
    time: "1:08.42",
    meet: "2026年度JSCA岐阜県クラブ対抗水泳競技大会",
    place: "長良川スイミングプラザ",
    note: "決勝 4位"
  },
  {
    id: "demo-20260705-003",
    date: "2026/07/05",
    swimmer: "高橋 悠真",
    event: "男子 200m 個人メドレー",
    time: "2:18.09",
    meet: "KANSAI MASTERS 2026",
    place: "東和薬品ラクタブドーム",
    note: ""
  }
];

const defaultState = {
  settings: {
    teamName: "RSケーニーズ",
    refreshMinutes: 360,
    sourceUrl: "https://result.swim.or.jp/player-search",
    proxyUrl: import.meta.env.VITE_SWIM_RESULTS_PROXY_URL || "/api/swim-results",
    syncMonths: 12
  },
  recentResults: [],
  bestRecords: [],
  upcomingMeets: [],
  archivedMembers: [],
  memberPhotos: {},
  memberReadings: {},
  memberBirthdates: {},
  updateHistory: [],
  lastSyncedAt: ""
};

export function getStoredState() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultState;
    const parsed = JSON.parse(stored);
    return {
      ...defaultState,
      ...parsed,
      settings: { ...defaultState.settings, ...(parsed.settings || {}) },
      upcomingMeets: parsed.upcomingMeets || defaultState.upcomingMeets
    };
  } catch {
    return defaultState;
  }
}

export function saveStoredState(state) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function syncRecords(previousState) {
  const settings = previousState.settings;
  const fetched = settings.proxyUrl ? await fetchViaProxy(settings) : { records: [] };
  const incomingRecords = normalizeRecords(fetched.records, settings.teamName);
  const incomingMeets = normalizeMeets(fetched.upcomingMeets || [], settings.teamName);
  const hasFreshMeetSnapshot = fetched.upcomingMeetsStatus === "ok";
  const archivedRecords = mergeRecordArchive(previousState.recentResults || [], incomingRecords);
  const bestRecords = buildBestRecords(archivedRecords);
  const updateHistory = mergeHistory(previousState, incomingRecords);

  return {
    ...previousState,
    recentResults: archivedRecords,
    bestRecords,
    upcomingMeets: hasFreshMeetSnapshot
      ? incomingMeets
      : incomingMeets.length ? incomingMeets : keepFutureMeets(previousState.upcomingMeets || []),
    updateHistory,
    lastSyncedAt: new Date().toISOString()
  };
}

async function fetchViaProxy(settings) {
  const url = new URL(settings.proxyUrl, window.location.origin);
  url.searchParams.set("source", settings.sourceUrl);
  url.searchParams.set("team", settings.teamName);
  url.searchParams.set("months", String(settings.syncMonths || 12));
  url.searchParams.set("refresh", String(Date.now()));

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache"
    }
  });
  if (!response.ok) {
    throw new Error("記録の取得に失敗しました。プロキシ/APIの状態を確認してください。");
  }

  const payload = await response.json();
  if (!Array.isArray(payload.records)) {
    throw new Error("取得データの形式が想定と違います。records 配列を返すようにしてください。");
  }

  return payload;
}

function normalizeRecords(records, teamName) {
  return records
    .filter((record) => !record.team || matchesTeam(record.team, teamName))
    .map((record, index) => ({
      id: record.id || stableRecordId(record, index),
      date: record.date || "",
      swimmer: record.swimmer || "選手名未取得",
      event: record.event || "種目未取得",
      time: record.time || "",
      meet: record.meet || "",
      place: record.place || "",
      note: record.note || "",
      rank: record.rank || "",
      grade: record.grade || "",
      swimClass: record.swimClass || record.class || record.level || "",
      sourceUrl: record.sourceUrl || ""
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function normalizeMeets(meets, teamName) {
  const today = formatDateForCompare(new Date());
  return meets
    .filter((meet) => !meet.team || matchesTeam(meet.team, teamName))
    .map((meet, index) => ({
      id: meet.id || stableMeetId(meet, index),
      date: meet.date || "",
      endDate: meet.endDate || meet.date || "",
      name: meet.name || meet.title || "大会名未取得",
      place: meet.place || "",
      team: meet.team || teamName,
      sourceUrl: meet.sourceUrl || meet.url || "",
      status: meet.status || "upcoming",
      entries: normalizeMeetEntries(meet.entries || meet.entrants || meet.members || [], teamName)
    }))
    .filter((meet) => meet.entries.length > 0)
    .filter((meet) => meet.date && (meet.endDate || meet.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeMeetEntries(entries, teamName) {
  return entries
    .filter((entry) => !entry.team || matchesTeam(entry.team, teamName))
    .map((entry, index) => ({
      id: entry.id || `${entry.swimmer || entry.name || "member"}-${entry.event || "event"}-${index}`,
      swimmer: entry.swimmer || entry.playerName || entry.player_name || entry.name || "",
      reading: entry.reading || entry.kana || "",
      gender: entry.gender || "",
      age: Number(entry.age) || "",
      event: entry.event || entry.eventName || entry.event_name || "",
      entryTime: entry.entryTime || entry.entry_time || "",
      team: entry.team || teamName
    }))
    .filter((entry) => entry.swimmer && entry.event);
}

function keepFutureMeets(meets) {
  const today = formatDateForCompare(new Date());
  return meets.filter((meet) => (meet.endDate || meet.date || "") >= today && Array.isArray(meet.entries) && meet.entries.length);
}

function buildBestRecords(records) {
  const bestByEvent = new Map();
  records.forEach((record) => {
    const key = record.event;
    const current = bestByEvent.get(key);
    if (!current || timeToMilliseconds(record.time) < timeToMilliseconds(current.time)) {
      bestByEvent.set(key, record);
    }
  });

  return Array.from(bestByEvent.values()).map((record) => ({
    id: `best-${record.id}`,
    swimmer: record.swimmer,
    event: record.event,
    time: record.time,
    date: record.date,
    meet: record.meet
  }));
}

function mergeHistory(previousState, records) {
  const previousIds = new Set(previousState.recentResults.map((record) => record.id));
  const newItems = records
    .filter((record) => !previousIds.has(record.id))
    .map((record) => ({
      id: `history-${record.id}`,
      detectedAt: new Date().toISOString(),
      title: `${record.event}を更新`,
      detail: `${record.swimmer} ${record.time} / ${record.meet}${record.note ? ` / ${record.note}` : ""}`
    }));

  return [...newItems, ...previousState.updateHistory].slice(0, 60);
}

function stableRecordId(record, index) {
  const sourceKey = [record.date, record.swimmer, record.event, record.time, record.meet, record.rank || ""].join("|");
  return `result-${hashText(sourceKey || String(index))}`;
}

function mergeRecordArchive(currentRecords, incomingRecords) {
  const recordsById = new Map();
  currentRecords.forEach((record, index) => {
    const id = record.id || stableRecordId(record, index);
    recordsById.set(id, { ...record, id });
  });
  incomingRecords.forEach((record, index) => {
    const id = record.id || stableRecordId(record, index);
    recordsById.set(id, { ...(recordsById.get(id) || {}), ...record, id });
  });
  return Array.from(recordsById.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function matchesTeam(value, teamName) {
  const normalizedValue = String(value || "").normalize("NFKC").replace(/[\s・･]/g, "").toLowerCase();
  const normalizedTeam = String(teamName || "").normalize("NFKC").replace(/[\s・･]/g, "").toLowerCase();
  return normalizedValue === normalizedTeam || normalizedValue.includes("ケーニーズ");
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableMeetId(meet, index) {
  return `${meet.date}-${meet.name || meet.title || ""}-${index}`.replace(/\s+/g, "-");
}

function formatDateForCompare(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function timeToMilliseconds(time) {
  if (!time) return Number.POSITIVE_INFINITY;
  const parts = time.split(":").map(Number);
  if (parts.length === 1) return parts[0] * 1000;
  return parts[0] * 60 * 1000 + parts[1] * 1000;
}
