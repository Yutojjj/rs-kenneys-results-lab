import React, { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  Camera,
  CalendarDays,
  ImagePlus,
  Search,
  Settings,
  Trophy,
  UsersRound,
  WifiOff
} from "lucide-react";
import "./styles.css";
import { loadBoardState, saveBoardState, subscribeBoardState, uploadMemberImage } from "./firebaseStorage";
import { getStoredState, saveStoredState, syncRecordRanks, syncRecords } from "./recordSync";
import { bestQualification, evaluateRecordQualification, loadQualificationStandards, qualificationEvent } from "./qualification";

const CARD_CROP_ASPECT = 1;
const NAME_READING_PARTS = [
  ["森川", "もりかわ"],
  ["結芽", "ゆめ"]
];

function App() {
  const [state, setState] = useState(() => getStoredState());
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isDockHidden, setIsDockHidden] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const queryReadyRef = useRef(false);
  const searchFocusedRef = useRef(false);
  const searchScrollTimersRef = useRef([]);
  const stateRef = useRef(state);
  const syncInFlightRef = useRef(null);

  function resetSearchScroll() {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  function settleSearchScroll() {
    searchScrollTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    resetSearchScroll();
    searchScrollTimersRef.current = [80, 220, 500, 800].map((delay) => window.setTimeout(resetSearchScroll, delay));
  }

  const filteredRecords = useMemo(() => {
    const needle = normalizeSearchText(query);
    if (!needle) return state.recentResults;
    return state.recentResults.filter((record) => buildRecordSearchText(record, state.memberReadings || {}).includes(needle));
  }, [query, state.recentResults, state.memberReadings]);

  async function handleSync({ silent = false } = {}) {
    if (syncInFlightRef.current) return syncInFlightRef.current;
    setError("");
    const syncTask = (async () => {
      try {
        let nextState = await syncRecords(stateRef.current);
        stateRef.current = nextState;
        setState(nextState);
        await persistState(nextState);
        nextState = await syncRecordRanks(nextState, async (rankedState) => {
          stateRef.current = rankedState;
          setState(rankedState);
          await persistState(rankedState);
        });
      } catch (syncError) {
        if (!silent || stateRef.current.recentResults.length === 0) setError(syncError.message);
      } finally {
        syncInFlightRef.current = null;
      }
    })();
    syncInFlightRef.current = syncTask;
    return syncTask;
  }

  function updateState(patch) {
    const nextState = { ...stateRef.current, ...patch };
    stateRef.current = nextState;
    setState(nextState);
    persistState(nextState);
  }

  async function persistState(nextState) {
    saveStoredState(nextState);
    try {
      await saveBoardState(nextState);
    } catch {
    }
  }

  function handleArchiveToggle(memberName) {
    const archivedMembers = state.archivedMembers || [];
    const nextArchivedMembers = archivedMembers.includes(memberName)
      ? archivedMembers.filter((name) => name !== memberName)
      : [...archivedMembers, memberName];
    updateState({ archivedMembers: nextArchivedMembers });
  }

  function handlePhotoUpdate(memberName, photoUrl) {
    updateState({
      memberPhotos: {
        ...(state.memberPhotos || {}),
        [memberName]: photoUrl
      }
    });
  }

  function handleReadingUpdate(memberName, reading) {
    updateState({
      memberReadings: {
        ...(state.memberReadings || {}),
        [memberName]: reading
      }
    });
  }

  function handleBirthdateUpdate(memberName, birthdate) {
    updateState({
      memberBirthdates: {
        ...(state.memberBirthdates || {}),
        [memberName]: birthdate || ""
      }
    });
  }

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    function applyCloudState(cloudState) {
      if (cancelled || !cloudState) return;
      const currentState = stateRef.current;
      const mergedState = {
        ...currentState,
        ...cloudState,
        settings: { ...currentState.settings, ...(cloudState.settings || {}) },
        upcomingMeets: cloudState.upcomingMeets || currentState.upcomingMeets || []
      };
      stateRef.current = mergedState;
      setState(mergedState);
      saveStoredState(mergedState);
    }

    const unsubscribe = subscribeBoardState(applyCloudState, () => {});
    loadBoardState()
      .then(applyCloudState)
      .catch(() => {})
      .finally(() => {
        if (!cancelled) handleSync({ silent: true });
      });
    const refreshMinutes = stateRef.current.settings.refreshMinutes || 360;
    const interval = window.setInterval(() => handleSync({ silent: true }), refreshMinutes * 60 * 1000);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if ("caches" in window) {
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then((registration) => {
        registration.update();
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "activated" && navigator.serviceWorker.controller) {
              window.location.reload();
            }
          });
        });
      });
    }
  }, []);

  useEffect(() => {
    let showTimer = 0;
    function handleScroll() {
      if (searchFocusedRef.current) {
        window.clearTimeout(showTimer);
        setIsDockHidden(false);
        return;
      }
      setIsDockHidden(true);
      window.clearTimeout(showTimer);
      showTimer = window.setTimeout(() => setIsDockHidden(false), 260);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.clearTimeout(showTimer);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    if (!queryReadyRef.current) {
      queryReadyRef.current = true;
      return;
    }
    settleSearchScroll();
    return () => {
      searchScrollTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, [query]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    function keepResultsAtTop() {
      if (!searchFocusedRef.current) {
        setKeyboardOffset(0);
        return;
      }
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
      const visibleBottom = viewport.height + viewport.offsetTop;
      setKeyboardOffset(Math.max(0, Math.round(layoutHeight - visibleBottom)));
      resetSearchScroll();
      window.requestAnimationFrame(resetSearchScroll);
    }
    viewport.addEventListener("resize", keepResultsAtTop);
    viewport.addEventListener("scroll", keepResultsAtTop);
    return () => {
      viewport.removeEventListener("resize", keepResultsAtTop);
      viewport.removeEventListener("scroll", keepResultsAtTop);
    };
  }, []);

  return (
    <main
      className={`app tab-meets ${isDockHidden ? "dockHidden" : ""}`}
      style={{ "--keyboard-offset": `${keyboardOffset}px` }}
    >
      {error ? (
        <div className="notice" role="status">
          <WifiOff size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="controls">
        <label className="searchBox">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => {
              searchFocusedRef.current = true;
              setIsDockHidden(false);
              settleSearchScroll();
              window.setTimeout(() => {
                const viewport = window.visualViewport;
                if (!viewport) return;
                const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
                setKeyboardOffset(Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop)));
              }, 80);
            }}
            onBlur={() => {
              searchFocusedRef.current = false;
              setKeyboardOffset(0);
            }}
            enterKeyHint="search"
            placeholder="選手名・大会名で検索"
          />
        </label>
        <button className="settingsButton" onClick={() => setSettingsOpen(true)} aria-label="設定">
          <Settings size={16} />
        </button>
      </div>

      <div className="pageSurface">
        <MeetsView
          records={filteredRecords}
          allRecords={state.recentResults}
          upcomingMeets={state.upcomingMeets || []}
          archivedMembers={state.archivedMembers || []}
          memberPhotos={state.memberPhotos || {}}
          memberBirthdates={state.memberBirthdates || {}}
          memberReadings={state.memberReadings || {}}
          onArchiveToggle={handleArchiveToggle}
          onPhotoUpdate={handlePhotoUpdate}
          onReadingUpdate={handleReadingUpdate}
          onBirthdateUpdate={handleBirthdateUpdate}
          query={query}
        />
      </div>
      {settingsOpen ? (
        <SettingsModal
          records={state.recentResults}
          archivedMembers={state.archivedMembers || []}
          memberPhotos={state.memberPhotos || {}}
          memberReadings={state.memberReadings || {}}
          memberBirthdates={state.memberBirthdates || {}}
          onArchiveToggle={handleArchiveToggle}
          onPhotoUpdate={handlePhotoUpdate}
          onReadingUpdate={handleReadingUpdate}
          onBirthdateUpdate={handleBirthdateUpdate}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </main>
  );
}

function useQualifiedMembers(records, memberPhotos, memberReadings, memberBirthdates) {
  const baseMembers = useMemo(() => buildMemberCards(records, memberPhotos, memberReadings, memberBirthdates), [records, memberPhotos, memberReadings, memberBirthdates]);
  const [qualifications, setQualifications] = useState({});

  useEffect(() => {
    let cancelled = false;
    const eligible = baseMembers.filter((member) => member.age && ["男子", "女子"].includes(member.gender));
    Promise.all(eligible.map(async (member) => {
      try {
        const standards = await loadQualificationStandards(member.gender, member.age);
        const qualification = bestQualification(member.records, standards);
        const byRecord = Object.fromEntries(member.records.map((record) => [record.id, evaluateRecordQualification(record, standards)]));
        return [member.name, { qualification, byRecord, sourceUrl: standards?.sourceUrl || "" }];
      } catch {
        return [member.name, { qualification: null, byRecord: {}, unavailable: true }];
      }
    })).then((entries) => {
      if (!cancelled) setQualifications(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [baseMembers]);

  return useMemo(() => baseMembers.map((member) => ({
      ...member,
      swimClass: qualifications[member.name]?.qualification?.label || "",
      qualification: qualifications[member.name]?.qualification || null,
      qualificationByRecord: qualifications[member.name]?.byRecord || {},
      qualificationSourceUrl: qualifications[member.name]?.sourceUrl || "",
      qualificationUnavailable: qualifications[member.name]?.unavailable || false
    })), [baseMembers, qualifications]);
}

function MembersView({ records, archivedMembers, memberPhotos, memberReadings, memberBirthdates, onArchiveToggle, onPhotoUpdate, onReadingUpdate, onBirthdateUpdate }) {
  const [selectedMember, setSelectedMember] = useState(null);
  const [uploadMember, setUploadMember] = useState(null);
  const [readingMember, setReadingMember] = useState(null);
  const [birthdateMember, setBirthdateMember] = useState(null);
  const [actionMember, setActionMember] = useState(null);
  const [genderFilters, setGenderFilters] = useState([]);
  const [ageFilter, setAgeFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [sortMode, setSortMode] = useState("class");
  const [seenMemberUpdates, setSeenMemberUpdates] = useState(() => readSeenMemberUpdates());
  const latestRecordDate = useMemo(() => getLatestDate(records), [records]);
  const qualifiedMembers = useQualifiedMembers(records, memberPhotos, memberReadings, memberBirthdates);
  const allMembers = useMemo(
    () =>
      qualifiedMembers
        .filter((member) => !archivedMembers.includes(member.name))
        .map((member) => {
          const latestRecords = latestRecordDate ? member.records.filter((record) => record.date === latestRecordDate) : [];
          const isSeen = seenMemberUpdates.includes(`${member.name}:${latestRecordDate}`);
          return {
            ...member,
            hasUpdate: latestRecords.length > 0 && !isSeen,
            hasBestUpdate: latestRecords.some((record) => isEventBest(member.records, record)) && !isSeen
          };
        }),
    [qualifiedMembers, archivedMembers, latestRecordDate, seenMemberUpdates]
  );
  const filterOptions = useMemo(() => buildMemberFilterOptions(allMembers), [allMembers]);
  useEffect(() => {
    if (!selectedMember) return;
    const refreshed = allMembers.find((member) => member.name === selectedMember.name);
    if (refreshed) setSelectedMember(refreshed);
  }, [allMembers, selectedMember?.name]);
  const members = sortMembers(
    allMembers.filter((member) => {
      if (genderFilters.length && !genderFilters.includes(member.gender)) return false;
      if (ageFilter !== "all" && String(member.age) !== ageFilter) return false;
      if (classFilter !== "all" && member.swimClass !== classFilter) return false;
      return true;
    }),
    sortMode
  );

  function handleOpenMember(member) {
    if (member.hasUpdate && latestRecordDate) {
      const nextSeen = Array.from(new Set([...seenMemberUpdates, `${member.name}:${latestRecordDate}`]));
      setSeenMemberUpdates(nextSeen);
      saveSeenMemberUpdates(nextSeen);
    }
    setSelectedMember(member);
  }

  return (
    <>
      <section className="memberFilterBar" aria-label="メンバー絞り込み">
        <div className="genderToggle" aria-label="性別">
          {["男子", "女子"].map((gender) => (
            <button
              key={gender}
              className={genderFilters.includes(gender) ? "active" : ""}
              onClick={() => {
                setGenderFilters((current) => {
                  if (current.includes(gender)) return current.filter((value) => value !== gender);
                  return [...current, gender];
                });
              }}
            >
              {gender === "男子" ? "男" : "女"}
            </button>
          ))}
        </div>
        <label>
          <span className="inlineFilterLabel">年齢</span>
          <select value={ageFilter} onChange={(event) => setAgeFilter(event.target.value)}>
            <option value="all">すべて</option>
            {filterOptions.ages.map((age) => <option key={age} value={age}>{age}歳</option>)}
          </select>
        </label>
        <label>
          <span className="inlineFilterLabel">級</span>
          <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
            <option value="all">すべて</option>
            {filterOptions.classes.map((swimClass) => <option key={swimClass} value={swimClass}>{swimClass}</option>)}
          </select>
        </label>
        <button
          className={`sortInlineButton ${sortMode === "class" ? "classSort" : "ageSort"}`}
          onClick={() => setSortMode((current) => (current === "age" ? "class" : "age"))}
        >
          {sortMode === "age" ? "年齢順" : "級順"}
        </button>
      </section>
      <section className="memberGrid" aria-label="メンバー">
        {members.map((member) => (
          <MemberCard
            key={member.name}
            member={member}
            onClick={() => handleOpenMember(member)}
            onActionRequest={() => setActionMember(member)}
          />
        ))}
      </section>
      {members.length === 0 ? <EmptyState title="表示中の選手がいません" text="設定からアーカイブ済み選手を戻すと表示されます。" /> : null}
      {selectedMember ? (
        <MemberModal
          member={selectedMember}
          isArchived={archivedMembers.includes(selectedMember.name)}
          onArchiveToggle={onArchiveToggle}
          onPhotoUpdate={onPhotoUpdate}
          onReadingUpdate={onReadingUpdate}
          onBirthdateUpdate={onBirthdateUpdate}
          onClose={() => setSelectedMember(null)}
        />
      ) : null}
      {uploadMember ? (
        <PhotoUploadModal
          memberName={uploadMember.name}
          currentPhotoUrl={uploadMember.photoUrl}
          onSaved={(photoUrl) => {
            onPhotoUpdate(uploadMember.name, photoUrl);
            setUploadMember(null);
          }}
          onDelete={() => {
            onPhotoUpdate(uploadMember.name, "");
            setUploadMember(null);
          }}
          onClose={() => setUploadMember(null)}
        />
      ) : null}
      {readingMember ? (
        <ReadingEditModal
          member={readingMember}
          onReadingUpdate={onReadingUpdate}
          onClose={() => setReadingMember(null)}
        />
      ) : null}
      {birthdateMember ? (
        <BirthdateEditModal
          member={birthdateMember}
          onBirthdateUpdate={onBirthdateUpdate}
          onClose={() => setBirthdateMember(null)}
        />
      ) : null}
      {actionMember ? (
        <MemberActionSheet
          member={actionMember}
          onPhotoRequest={() => {
            setUploadMember(actionMember);
            setActionMember(null);
          }}
          onArchive={() => {
            onArchiveToggle(actionMember.name);
            setActionMember(null);
          }}
          onReadingRequest={() => {
            setReadingMember(actionMember);
            setActionMember(null);
          }}
          onBirthdateRequest={() => {
            setBirthdateMember(actionMember);
            setActionMember(null);
          }}
          onClose={() => setActionMember(null)}
        />
      ) : null}
    </>
  );
}

function MemberCard({ member, onClick, onActionRequest }) {
  const longPressTimer = useRef(null);
  const longPressTriggered = useRef(false);

  function clearLongPress() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function openMenu() {
    longPressTriggered.current = true;
    onActionRequest();
  }

  function handlePointerDown() {
    longPressTriggered.current = false;
    clearLongPress();
    longPressTimer.current = window.setTimeout(openMenu, 520);
  }

  function handlePointerEnd() {
    clearLongPress();
  }

  function handleClick(event) {
    if (longPressTriggered.current) {
      event.preventDefault();
      longPressTriggered.current = false;
      return;
    }
    onClick();
  }

  return (
    <div className="memberCardWrap">
      <button
        className={`memberCard ${member.photoUrl ? "hasPhoto" : ""}`}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu();
        }}
      >
        {member.photoUrl ? <img src={member.photoUrl} alt="" /> : null}
        <div className="memberOverlay">
          {member.hasUpdate ? <span className="updateDot" aria-label="更新あり" /> : null}
          {member.hasBestUpdate ? <span className="bestUpdateBadge">ベスト更新</span> : null}
          {member.reading ? <p className="memberReading">{member.reading}</p> : null}
          <h2>{member.name}</h2>
          <div className="memberFacts">
            <span className={`factChip ${genderClassName(member.gender)}`}>{member.gender || "性別未取得"}</span>
            <span className="factChip ageChip">{member.age !== "" ? `${member.age}歳` : "未設定"}</span>
            <span className="factChip classChip">{member.swimClass || "級未判定"}</span>
          </div>
        </div>
      </button>
    </div>
  );
}

function MemberActionSheet({ member, onPhotoRequest, onArchive, onReadingRequest, onBirthdateRequest, onClose }) {
  return (
    <div className="actionSheetBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="memberActionSheet" role="dialog" aria-modal="true" aria-label={`${member.name}の操作`} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <small>{member.reading || "メンバー操作"}</small>
          <strong>{member.name}</strong>
        </header>
        <button type="button" className="photoMenuAction" onClick={onPhotoRequest}>画像アップロード</button>
        <button type="button" className="birthdateMenuAction" onClick={onBirthdateRequest}>生年月日入力</button>
        <button type="button" className="readingMenuAction" onClick={onReadingRequest}>かな入力</button>
        <button type="button" className="archiveMenuAction" onClick={onArchive}>アーカイブ（表示しない）</button>
        <button type="button" className="cancelMenuAction" onClick={onClose}>キャンセル</button>
      </section>
    </div>
  );
}

function MemberModal({ member, isArchived = false, onArchiveToggle, onPhotoUpdate, onReadingUpdate, onBirthdateUpdate, onClose }) {
  const [expandedEvent, setExpandedEvent] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [readingOpen, setReadingOpen] = useState(false);
  const [birthdateOpen, setBirthdateOpen] = useState(false);
  const [eventQuery, setEventQuery] = useState("");
  const eventSummaries = useMemo(() => buildMemberEventSummaries(member.records), [member.records]);
  const filteredEventSummaries = useMemo(() => {
    const needle = normalizeSearchText(eventQuery);
    if (!needle) return eventSummaries;
    return eventSummaries.filter(({ eventName, best, records }) =>
      normalizeSearchText([eventName, best?.meet, best?.date, best?.time, ...records.map((record) => record.meet)].filter(Boolean).join(" ")).includes(needle)
    );
  }, [eventQuery, eventSummaries]);

  useEffect(() => {
    setExpandedEvent("");
    setEventQuery("");
  }, [member]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
        <section className="memberModal" role="dialog" aria-modal="true" aria-label={`${member.name}の記録`} onMouseDown={(event) => event.stopPropagation()}>
          <header className="modalHeader memberDetailHeader">
            <div className="memberTitleBlock">
              <div className="memberNameLine">
                <h2>{member.name}</h2>
                <span>{member.gender || "性別未取得"} / {member.birthdate ? `${formatBirthdate(member.birthdate)}（${member.age}歳）` : "未設定"} / {member.swimClass || "級未判定"}</span>
              </div>
            </div>
            <div className="modalActions">
              <button className="archiveButton ageButton" onClick={() => setBirthdateOpen(true)}>
                <span>生年月日</span>
              </button>
              <button className="archiveButton readingButton" onClick={() => setReadingOpen(true)}>
                <span>よみ</span>
              </button>
              <button className="archiveButton photoButton" onClick={() => setUploadOpen(true)}>
                <ImagePlus size={16} />
                <span>写真</span>
              </button>
              <button className="iconButton closeButton" onClick={onClose} aria-label="閉じる">×</button>
            </div>
          </header>

          <label className="memberEventSearch">
            <Search size={15} />
            <input value={eventQuery} onChange={(event) => setEventQuery(event.target.value)} placeholder="種目・大会で検索" />
          </label>

          <section className="eventBestList" aria-label="種目別ベスト">
            {filteredEventSummaries.map(({ eventName, best, records }) => {
              const expanded = expandedEvent === eventName;
              return (
                <article className={`eventBestCard ${expanded ? "expanded" : ""}`} key={eventName}>
                  <button onClick={() => setExpandedEvent(expanded ? "" : eventName)}>
                    <div className="eventBestMain">
                      <span>{eventName}</span>
                      <div className="eventBestTimeLine">
                        <strong>{formatTime(best?.time)}</strong>
                        <em>自己ベスト</em>
                      </div>
                    </div>
                    {member.qualificationByRecord?.[best?.id] ? <span className="qualificationBadge">{member.qualificationByRecord[best.id].label}</span> : null}
                    <div className="eventBestMeta">
                      <time>{formatDateWithWeekday(best?.date)}</time>
                      <span className={rankClassName(best?.rank)}>{formatRank(best?.rank) || "-"}</span>
                      <span>{best?.meet || "-"}</span>
                    </div>
                    <span className="historyHint">{expanded ? "閉じる" : "履歴を見る"} <b>{expanded ? "⌃" : "⌄"}</b></span>
                  </button>
                  {expanded ? (
                    <div className="recordTable compactRecordTable" aria-label={`${eventName}の履歴`}>
                      <div className="recordTableHeader">
                        <span>日付</span>
                        <span>大会名</span>
                        <span>記録</span>
                        <span>順位</span>
                      </div>
                      {records.map((record) => (
                        <article className="recordTableRow" key={record.id}>
                          <time>{formatDateWithWeekday(record.date)}</time>
                          <strong>{record.meet}</strong>
                          <span className="recordTime">{formatTime(record.time)}</span>
                          <span className={`recordRank ${rankClassName(record.rank)}`}>{formatRank(record.rank) || "-"}</span>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
        </section>
      </div>
      {readingOpen ? (
        <ReadingEditModal
          member={member}
          onReadingUpdate={onReadingUpdate}
          onClose={() => setReadingOpen(false)}
        />
      ) : null}
      {birthdateOpen ? (
        <BirthdateEditModal member={member} onBirthdateUpdate={onBirthdateUpdate} onClose={() => setBirthdateOpen(false)} />
      ) : null}
      {uploadOpen ? (
        <PhotoUploadModal
          memberName={member.name}
          currentPhotoUrl={member.photoUrl}
          onSaved={(photoUrl) => {
            onPhotoUpdate(member.name, photoUrl);
            setUploadOpen(false);
          }}
          onDelete={() => {
            onPhotoUpdate(member.name, "");
            setUploadOpen(false);
          }}
          onClose={() => setUploadOpen(false)}
        />
      ) : null}
    </>
  );
}

function BirthdateEditModal({ member, onBirthdateUpdate, onClose }) {
  const initial = parseBirthdate(member.birthdate);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(initial.year || "");
  const [month, setMonth] = useState(initial.month || "");
  const [day, setDay] = useState(initial.day || "");
  const years = Array.from({ length: 101 }, (_, index) => currentYear - index);
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  const dayCount = year && month ? new Date(Number(year), Number(month), 0).getDate() : 31;
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);
  const birthdate = year && month && day ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
  const validBirthdate = birthdate && new Date(`${birthdate}T00:00:00`) <= new Date();

  useEffect(() => {
    if (Number(day) > dayCount) setDay(String(dayCount));
  }, [day, dayCount]);

  return (
    <div className="modalBackdrop topModal" role="presentation" onMouseDown={onClose}>
      <section className="readingModal" role="dialog" aria-modal="true" aria-label="生年月日入力" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader compactModalHeader">
          <div>
            <p className="eyebrow">資格級の判定</p>
            <h2>{member.name}</h2>
          </div>
          <button className="iconButton closeButton" onClick={onClose} aria-label="閉じる">×</button>
        </header>
        <div className="birthdateFields" aria-label="生年月日">
          <label><span>年</span><select autoFocus value={year} onChange={(event) => setYear(event.target.value)}><option value="">選択</option>{years.map((value) => <option key={value} value={value}>{value}年</option>)}</select></label>
          <label><span>月</span><select value={month} onChange={(event) => setMonth(event.target.value)}><option value="">選択</option>{months.map((value) => <option key={value} value={value}>{value}月</option>)}</select></label>
          <label><span>日</span><select value={day} onChange={(event) => setDay(event.target.value)}><option value="">選択</option>{days.map((value) => <option key={value} value={value}>{value}日</option>)}</select></label>
        </div>
        <button className="ageSaveButton" disabled={!validBirthdate} onClick={() => { onBirthdateUpdate(member.name, birthdate); onClose(); }}>保存して級を判定</button>
        {member.birthdate ? <button className="birthdateDeleteButton" onClick={() => { onBirthdateUpdate(member.name, ""); onClose(); }}>生年月日を削除</button> : null}
        <p className="qualificationNote">生年月日から満年齢を計算し、性別・自己ベストと日本水泳連盟の2026年度資格級表を照合します。</p>
      </section>
    </div>
  );
}

function ReadingEditModal({ member, onReadingUpdate, onClose }) {
  const [readingInput, setReadingInput] = useState(member.reading || "");

  useEffect(() => {
    setReadingInput(member.reading || "");
  }, [member]);

  function handleSave() {
    onReadingUpdate(member.name, readingInput.trim());
    onClose();
  }

  return (
    <div className="modalBackdrop topModal" role="presentation" onMouseDown={onClose}>
      <section className="readingModal" role="dialog" aria-modal="true" aria-label="検索用よみ" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader compactModalHeader">
          <div>
            <p className="eyebrow">検索用よみ</p>
            <h2>{member.name}</h2>
          </div>
          <button className="iconButton closeButton" onClick={onClose} aria-label="閉じる">×</button>
        </header>
        <label className="readingEditBox">
          <span>ひらがな</span>
          <input
            autoFocus
            value={readingInput}
            onChange={(event) => setReadingInput(event.target.value)}
            onCompositionStart={() => {}}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) handleSave();
            }}
            placeholder="例: もりかわ ゆめ"
          />
        </label>
        <div className="readingEditActions">
          <button type="button" className="readingCancelButton" onClick={onClose}>キャンセル</button>
          <button type="button" className="readingSaveButton" onClick={handleSave}>保存</button>
        </div>
      </section>
    </div>
  );
}

function TimesView({ records, memberPhotos, memberReadings, memberBirthdates, archivedMembers, onArchiveToggle, onPhotoUpdate, onReadingUpdate, onBirthdateUpdate, onMeetOpen }) {
  const [eventFilter, setEventFilter] = useState("all");
  const [ageFilter, setAgeFilter] = useState("all");
  const [genderFilter, setGenderFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [selectedMember, setSelectedMember] = useState(null);
  const memberCards = useQualifiedMembers(records, memberPhotos, memberReadings, memberBirthdates);
  const memberByName = useMemo(() => new Map(memberCards.map((member) => [member.name, member])), [memberCards]);
  const options = useMemo(() => buildFilterOptions(records, memberCards), [records, memberCards]);
  useEffect(() => {
    if (!selectedMember) return;
    const refreshed = memberCards.find((member) => member.name === selectedMember.name);
    if (refreshed) setSelectedMember(refreshed);
  }, [memberCards, selectedMember?.name]);
  const eventOptions = useMemo(
    () => options.events.filter((eventName) => genderFilter === "all" || getGender(eventName) === genderFilter),
    [options.events, genderFilter]
  );
  const filtered = records.filter((record) => {
    if (eventFilter !== "all" && record.event !== eventFilter) return false;
    const member = memberByName.get(record.swimmer);
    if (ageFilter !== "all" && String(member?.age || "") !== ageFilter) return false;
    if (classFilter !== "all" && member?.swimClass !== classFilter) return false;
    if (genderFilter !== "all" && getGender(record.event) !== genderFilter) return false;
    return true;
  });
  const groupedRecords = useMemo(() => groupRecordsByMeet(filtered), [filtered]);

  useEffect(() => {
    if (eventFilter !== "all" && !eventOptions.includes(eventFilter)) {
      setEventFilter("all");
    }
  }, [eventFilter, eventOptions]);

  return (
    <>
      <section className="filterBar eventFilterBar" aria-label="種目絞り込み">
        <div className="filterRow eventCompactFilters">
          <label>
            <span className="inlineFilterLabel">性別</span>
            <select value={genderFilter} onChange={(event) => setGenderFilter(event.target.value)}>
              <option value="all">すべて</option>
              <option value="男子">男子</option>
              <option value="女子">女子</option>
              <option value="混合">混合</option>
            </select>
          </label>
          <label>
            <span className="inlineFilterLabel">年齢</span>
            <select value={ageFilter} onChange={(event) => setAgeFilter(event.target.value)}>
              <option value="all">すべて</option>
              {options.ages.map((age) => <option key={age} value={age}>{age}歳</option>)}
            </select>
          </label>
          <label>
            <span className="inlineFilterLabel">級</span>
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
              <option value="all">すべて</option>
              {options.classes.map((swimClass) => <option key={swimClass} value={swimClass}>{swimClass}</option>)}
            </select>
          </label>
          <label className="eventSelect">
            <span className="inlineFilterLabel">種目</span>
            <select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}>
              <option value="all">すべて</option>
              {eventOptions.map((eventName) => <option key={eventName} value={eventName}>{eventName}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="timeMeetSections" aria-label="種目一覧">
        {groupedRecords.map((group) => (
          <section className="timeMeetSection" key={group.key}>
            <button
              className="timeMeetHeader"
              onClick={() => onMeetOpen?.({
                key: group.key,
                date: group.date,
                name: group.meet,
                place: latestValue(group.records, "place"),
                records: group.records,
                status: "past"
              })}
            >
              <h2>{group.meet}</h2>
              <span><time>{formatDateWithWeekday(group.date)}</time><b aria-hidden="true">›</b></span>
            </button>
            <div className="timeGrid compactTimeGrid">
              {group.records.map((record) => (
                <button className={`timeCard ${eventColorClassName(record.event)}`} key={record.id} onClick={() => setSelectedMember(memberCards.find((member) => member.name === record.swimmer) || null)}>
                  <p>{record.event}</p>
                  <div className="timeCardNameLine">
                    <div className="timeCardNameBlock">
                      {getDisplayReading(record.swimmer, memberReadings[record.swimmer]) ? (
                        <span className="timeCardReading">{getDisplayReading(record.swimmer, memberReadings[record.swimmer])}</span>
                      ) : null}
                      <h2>{record.swimmer}</h2>
                    </div>
                    <span>{memberByName.get(record.swimmer)?.age ? `${memberByName.get(record.swimmer).age}歳` : "-"}</span>
                  </div>
                  <strong>{formatTime(record.time)}</strong>
                </button>
              ))}
            </div>
          </section>
        ))}
      </section>
      {filtered.length === 0 ? <EmptyState title="該当する種目がありません" text="絞り込み条件を変更してください。" /> : null}
      {selectedMember ? (
        <MemberModal
          member={selectedMember}
          isArchived={archivedMembers.includes(selectedMember.name)}
          onArchiveToggle={onArchiveToggle}
          onPhotoUpdate={onPhotoUpdate}
          onReadingUpdate={onReadingUpdate}
          onBirthdateUpdate={onBirthdateUpdate}
          onClose={() => setSelectedMember(null)}
        />
      ) : null}
    </>
  );
}

function MeetsView({ records, allRecords, upcomingMeets, archivedMembers, memberPhotos, memberBirthdates, memberReadings, onArchiveToggle, onPhotoUpdate, onReadingUpdate, onBirthdateUpdate, query }) {
  const [mode, setMode] = useState("upcoming");
  const [visualMode, setVisualMode] = useState("upcoming");
  const [selectedMeet, setSelectedMeet] = useState(null);
  const modeTabsRef = useRef(null);
  const modeSwipeSurfaceRef = useRef(null);
  const modeSwipeTrackRef = useRef(null);
  const modeSwipeStartRef = useRef(null);
  const modeSwipeFrameRef = useRef(0);
  const modeSwipeTimerRef = useRef(0);
  const futureMeets = useMemo(() => buildUpcomingMeetCards(upcomingMeets, query), [upcomingMeets, query]);
  const modeOrder = ["upcoming", "history", "members"];
  const modeIndex = modeOrder.indexOf(mode);

  function setModeSwipeOffset(offset, animate = false) {
    if (modeSwipeFrameRef.current) window.cancelAnimationFrame(modeSwipeFrameRef.current);
    modeSwipeFrameRef.current = window.requestAnimationFrame(() => {
      const track = modeSwipeTrackRef.current;
      const surface = modeSwipeSurfaceRef.current;
      const tabBar = modeTabsRef.current;
      if (track) {
        track.style.setProperty("--swipe-offset", `${offset}px`);
        track.classList.toggle("swipeAnimating", animate);
      }
      if (tabBar) {
        const width = surface?.offsetWidth || window.innerWidth;
        tabBar.style.setProperty("--meet-mode-drag-offset", `${(-offset / width) * 100}%`);
        tabBar.classList.toggle("swipeAnimating", animate);
      }
      surface?.classList.toggle("swipeDragging", Math.abs(offset) > 0.5);
      modeSwipeFrameRef.current = 0;
    });
  }

  function finishModeSwipe(nextMode, targetOffset) {
    window.clearTimeout(modeSwipeTimerRef.current);
    setVisualMode(nextMode);
    setModeSwipeOffset(targetOffset, true);
    modeSwipeTimerRef.current = window.setTimeout(() => {
      const track = modeSwipeTrackRef.current;
      const tabBar = modeTabsRef.current;
      track?.classList.remove("swipeAnimating");
      tabBar?.classList.remove("swipeAnimating");
      flushSync(() => setMode(nextMode));
      track?.style.setProperty("--swipe-offset", "0px");
      tabBar?.style.setProperty("--meet-mode-drag-offset", "0%");
      modeSwipeSurfaceRef.current?.classList.remove("swipeDragging");
    }, 220);
  }

  function changeMode(nextMode) {
    const nextIndex = modeOrder.indexOf(nextMode);
    if (nextIndex < 0 || nextIndex === modeIndex) return;
    const width = modeSwipeSurfaceRef.current?.offsetWidth || window.innerWidth;
    finishModeSwipe(nextMode, (modeIndex - nextIndex) * width);
  }

  function handleModeTouchStart(event) {
    if (!event.touches.length || event.target.closest("input,select,textarea,a,.meetModeTabs,.modalBackdrop")) {
      modeSwipeStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    modeSwipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
      locked: "",
      deltaX: 0,
      dragging: false
    };
  }

  function handleModeTouchMove(event) {
    const start = modeSwipeStartRef.current;
    if (!start || !event.touches.length) return;
    const touch = event.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (!start.locked) {
      const horizontal = Math.abs(dx);
      const vertical = Math.abs(dy);
      if (horizontal < 8 && vertical < 8) return;
      if (horizontal > vertical * 1.2) start.locked = "horizontal";
      else if (vertical > horizontal * 1.05) start.locked = "vertical";
      else return;
    }
    if (start.locked !== "horizontal") return;
    event.preventDefault();
    const atFirst = modeIndex === 0 && dx > 0;
    const atLast = modeIndex === modeOrder.length - 1 && dx < 0;
    const offset = atFirst || atLast ? dx * 0.22 : dx;
    start.deltaX = offset;
    start.dragging = true;
    setModeSwipeOffset(offset);
  }

  function handleModeTouchEnd(event) {
    const start = modeSwipeStartRef.current;
    modeSwipeStartRef.current = null;
    if (!start?.dragging) {
      setModeSwipeOffset(0, true);
      return;
    }
    const elapsed = Math.max(Date.now() - start.time, 1);
    const width = modeSwipeSurfaceRef.current?.offsetWidth || window.innerWidth;
    const threshold = Math.min(width * 0.24, 96);
    const velocity = Math.abs(start.deltaX) / elapsed;
    const direction = start.deltaX < 0 ? 1 : -1;
    const nextIndex = clamp(modeIndex + direction, 0, modeOrder.length - 1);
    const shouldChange = Math.abs(start.deltaX) >= threshold || (velocity > 0.48 && Math.abs(start.deltaX) > 30);
    if (shouldChange && nextIndex !== modeIndex) {
      finishModeSwipe(modeOrder[nextIndex], direction * -width);
    } else {
      setModeSwipeOffset(0, true);
      window.setTimeout(() => {
        modeSwipeTrackRef.current?.classList.remove("swipeAnimating");
        modeSwipeSurfaceRef.current?.classList.remove("swipeDragging");
        modeTabsRef.current?.classList.remove("swipeAnimating");
      }, 220);
    }
  }

  function renderModeContent(paneMode) {
    if (paneMode === "history") {
      return (
        <TimesView
          records={records}
          memberPhotos={memberPhotos}
          memberReadings={memberReadings}
          memberBirthdates={memberBirthdates}
          archivedMembers={archivedMembers}
          onArchiveToggle={onArchiveToggle}
          onPhotoUpdate={onPhotoUpdate}
          onReadingUpdate={onReadingUpdate}
          onBirthdateUpdate={onBirthdateUpdate}
          onMeetOpen={setSelectedMeet}
        />
      );
    }

    if (paneMode === "members") {
      return (
        <MembersView
          records={records}
          archivedMembers={archivedMembers}
          memberPhotos={memberPhotos}
          memberReadings={memberReadings}
          memberBirthdates={memberBirthdates}
          onArchiveToggle={onArchiveToggle}
          onPhotoUpdate={onPhotoUpdate}
          onReadingUpdate={onReadingUpdate}
          onBirthdateUpdate={onBirthdateUpdate}
        />
      );
    }

    const paneMeets = futureMeets;
    return (
      <>
        <section className="meetList" aria-label="大会一覧">
          {paneMeets.map((meet) => (
            <button className="meetCard" key={meet.key} onClick={() => setSelectedMeet(meet)}>
              <div>
                <time>{formatMeetDateRange(meet)}</time>
                <h2>{meet.name}</h2>
                <p>{meet.place}</p>
              </div>
              <span>
                {meet.status === "upcoming"
                  ? `${new Set(meet.entries.map((entry) => normalizeMemberName(entry.swimmer))).size}名 / ${new Set(meet.entries.map((entry) => upcomingEventSectionName(entry.event))).size}種目`
                  : `${meet.records.length}件`}
              </span>
            </button>
          ))}
        </section>
        {paneMeets.length === 0 ? (
          <EmptyState
            title="出場予定の大会はありません"
            text="RSケーニーズのエントリーが取得されると自動表示されます。"
          />
        ) : null}
      </>
    );
  }

  return (
    <section
      className={`meetsView ${mode === "history" ? "historyMode" : ""}`}
    >
      <section
        className="meetModeTabs"
        ref={modeTabsRef}
        style={{ "--meet-mode-offset": `${modeIndex * 100}%`, "--meet-mode-drag-offset": "0%" }}
        aria-label="大会の開催状況"
      >
        <button className={visualMode === "upcoming" ? "active" : ""} onClick={() => changeMode("upcoming")}>
          <CalendarDays size={17} strokeWidth={2.2} />
          <span>予定</span>
        </button>
        <button className={visualMode === "history" ? "active" : ""} onClick={() => changeMode("history")}>
          <Trophy size={17} strokeWidth={2.2} />
          <span>結果</span>
        </button>
        <button className={visualMode === "members" ? "active" : ""} onClick={() => changeMode("members")}>
          <UsersRound size={17} strokeWidth={2.2} />
          <span>選手</span>
        </button>
      </section>
      <div
        className="swipeSurface meetModeSwipeSurface"
        ref={modeSwipeSurfaceRef}
        onTouchStart={handleModeTouchStart}
        onTouchMove={handleModeTouchMove}
        onTouchEnd={handleModeTouchEnd}
        onTouchCancel={() => {
          modeSwipeStartRef.current = null;
          setModeSwipeOffset(0, true);
        }}
      >
        <div
          className="swipeTrack meetModeSwipeTrack"
          ref={modeSwipeTrackRef}
          style={{ "--track-index-offset": `${modeIndex * -100}%`, "--swipe-offset": "0px" }}
        >
          {modeOrder.map((paneMode) => (
            <section
              className={`swipePane ${paneMode === mode ? "activePane" : ""}`}
              aria-hidden={paneMode !== mode}
              key={paneMode}
            >
              {renderModeContent(paneMode)}
            </section>
          ))}
        </div>
      </div>
      {selectedMeet ? (
        <MeetModal
          meet={selectedMeet}
          records={records}
          allRecords={allRecords}
          archivedMembers={archivedMembers}
          memberPhotos={memberPhotos}
          memberBirthdates={memberBirthdates}
          memberReadings={memberReadings}
          onArchiveToggle={onArchiveToggle}
          onPhotoUpdate={onPhotoUpdate}
          onReadingUpdate={onReadingUpdate}
          onBirthdateUpdate={onBirthdateUpdate}
          onClose={() => setSelectedMeet(null)}
        />
      ) : null}
    </section>
  );
}

function MeetModal({ meet, records, allRecords, archivedMembers, memberPhotos, memberBirthdates, memberReadings, onArchiveToggle, onPhotoUpdate, onReadingUpdate, onBirthdateUpdate, onClose }) {
  if (meet.status === "upcoming") {
    return (
      <UpcomingMeetModal
        meet={meet}
        records={allRecords}
        archivedMembers={archivedMembers}
        memberPhotos={memberPhotos}
        memberBirthdates={memberBirthdates}
        memberReadings={memberReadings}
        onArchiveToggle={onArchiveToggle}
        onPhotoUpdate={onPhotoUpdate}
        onReadingUpdate={onReadingUpdate}
        onBirthdateUpdate={onBirthdateUpdate}
        onClose={onClose}
      />
    );
  }
  return (
    <PastMeetModal
      meet={meet}
      records={records}
      archivedMembers={archivedMembers}
      memberPhotos={memberPhotos}
      memberBirthdates={memberBirthdates}
      memberReadings={memberReadings}
      onArchiveToggle={onArchiveToggle}
      onPhotoUpdate={onPhotoUpdate}
      onReadingUpdate={onReadingUpdate}
      onBirthdateUpdate={onBirthdateUpdate}
      onClose={onClose}
    />
  );
}

function PastMeetModal({ meet, records, archivedMembers, memberPhotos, memberBirthdates, memberReadings, onArchiveToggle, onPhotoUpdate, onReadingUpdate, onBirthdateUpdate, onClose }) {
  const [genderFilters, setGenderFilters] = useState([]);
  const [ageFilter, setAgeFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [selectedMember, setSelectedMember] = useState(null);
  const members = useQualifiedMembers(records, memberPhotos, memberReadings, memberBirthdates);
  const memberByKey = useMemo(() => new Map(members.map((member) => [normalizeMemberName(member.name), member])), [members]);
  const meetRecords = useMemo(() => meet.records.map((record) => {
    const memberKey = normalizeMemberName(record.swimmer);
    const member = memberByKey.get(memberKey);
    const memberRecords = records.filter((item) => normalizeMemberName(item.swimmer) === memberKey);
    return {
      ...record,
      gender: record.gender || getGender(record.event) || member?.gender || "",
      age: member?.age || calculateAge(memberBirthdates[record.swimmer]) || "",
      swimClass: member?.swimClass || "",
      reading: memberReadings[record.swimmer] || member?.reading || getNameReading(record.swimmer),
      best: findBestForEvent(memberRecords, record.event)
    };
  }), [meet.records, records, memberByKey, memberBirthdates, memberReadings]);
  const options = useMemo(() => ({
    ages: Array.from(new Set(meetRecords.map((record) => record.age).filter((value) => value !== ""))).sort((a, b) => a - b),
    classes: Array.from(new Set(meetRecords.map((record) => record.swimClass).filter(Boolean))).sort(compareSwimClass),
    events: Array.from(new Set(meetRecords.map((record) => upcomingEventSectionName(record.event)).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ja"))
  }), [meetRecords]);
  const filteredRecords = meetRecords.filter((record) => {
    if (genderFilters.length && !genderFilters.includes(record.gender)) return false;
    if (ageFilter !== "all" && String(record.age) !== ageFilter) return false;
    if (classFilter !== "all" && record.swimClass !== classFilter) return false;
    if (eventFilter !== "all" && upcomingEventSectionName(record.event) !== eventFilter) return false;
    return true;
  });
  const groupedRecords = useMemo(() => groupMeetRecordsByEvent(filteredRecords), [filteredRecords]);

  function openMember(record) {
    const existing = memberByKey.get(normalizeMemberName(record.swimmer));
    if (existing) {
      setSelectedMember(existing);
      return;
    }
    setSelectedMember({
      name: record.swimmer,
      records: [],
      events: [],
      photoUrl: memberPhotos[record.swimmer] || "",
      reading: record.reading || "",
      gender: record.gender || "",
      birthdate: memberBirthdates[record.swimmer] || "",
      age: record.age || "",
      swimClass: record.swimClass || "",
      overallBest: record.best || null
    });
  }

  return (
    <>
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="settingsModal meetModal" role="dialog" aria-modal="true" aria-label={`${meet.name}の記録`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader meetModalHeader">
          <div>
            <p className="eyebrow">大会一覧</p>
            <h2>{meet.name}</h2>
            <span>{formatMeetDateRange(meet)} / {meet.place}</span>
          </div>
          <button className="iconButton closeButton" onClick={onClose} aria-label="閉じる">×</button>
        </header>
        <section className="pastMeetFilters" aria-label="大会記録の絞り込み">
          <div className="genderToggle pastMeetGender" aria-label="性別">
            {["男子", "女子"].map((gender) => (
              <button
                key={gender}
                className={genderFilters.includes(gender) ? "active" : ""}
                onClick={() => setGenderFilters((current) => current.includes(gender) ? current.filter((value) => value !== gender) : [...current, gender])}
              >
                {gender === "男子" ? "男" : "女"}
              </button>
            ))}
          </div>
          <label>
            <span>年齢</span>
            <select value={ageFilter} onChange={(event) => setAgeFilter(event.target.value)}>
              <option value="all">すべて</option>
              {options.ages.map((age) => <option key={age} value={age}>{age}歳</option>)}
            </select>
          </label>
          <label>
            <span>級</span>
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
              <option value="all">すべて</option>
              {options.classes.map((swimClass) => <option key={swimClass} value={swimClass}>{swimClass}</option>)}
            </select>
          </label>
          <label className="pastMeetEventFilter">
            <span>種目</span>
            <select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}>
              <option value="all">すべて</option>
              {options.events.map((eventName) => <option key={eventName} value={eventName}>{eventName}</option>)}
            </select>
          </label>
        </section>
          <section className="pastMeetResultList">
            {groupedRecords.map((group) => (
              <section className={`pastMeetEventSection ${eventColorClassName(group.eventName)}`} key={group.eventName}>
                <header>
                  <h3>{group.eventName}</h3>
                  <span>{group.records.length}名</span>
                </header>
                <div className="pastMeetResultGrid">
                  {group.records.map((record) => (
                    <button className="pastMeetResultCard" key={record.id} onClick={() => openMember(record)}>
                      <div className="pastMeetResultMember">
                        {record.reading ? <small>{record.reading}</small> : null}
                        <strong>{record.swimmer}</strong>
                        <span className="pastMeetMemberMeta">
                          {[record.age !== "" ? `${record.age}歳` : "", record.swimClass].filter(Boolean).join(" / ") || "-"}
                          {record.rank ? <b className={rankClassName(record.rank)}>{formatRank(record.rank)}</b> : null}
                        </span>
                      </div>
                      <div className="pastMeetResultTimes">
                        <span>今回</span>
                        <strong>{formatTime(record.time)}</strong>
                        <em>BEST {record.best ? formatTime(record.best.time) : "記録なし"}</em>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </section>
          {!filteredRecords.length ? <EmptyState title="該当する記録がありません" text="絞り込み条件を変更してください。" /> : null}
      </section>
    </div>
      {selectedMember ? (
        <MemberModal
          member={selectedMember}
          isArchived={archivedMembers.includes(selectedMember.name)}
          onArchiveToggle={onArchiveToggle}
          onPhotoUpdate={onPhotoUpdate}
          onReadingUpdate={onReadingUpdate}
          onBirthdateUpdate={onBirthdateUpdate}
          onClose={() => setSelectedMember(null)}
        />
      ) : null}
    </>
  );
}

function UpcomingMeetModal({ meet, records, archivedMembers, memberPhotos, memberBirthdates, memberReadings, onArchiveToggle, onPhotoUpdate, onReadingUpdate, onBirthdateUpdate, onClose }) {
  const [genderFilter, setGenderFilter] = useState("all");
  const [ageFilter, setAgeFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [selectedMember, setSelectedMember] = useState(null);
  const members = useQualifiedMembers(records, memberPhotos, memberReadings, memberBirthdates);
  const memberByKey = useMemo(() => new Map(members.map((member) => [normalizeMemberName(member.name), member])), [members]);
  const entries = useMemo(() => meet.entries.map((entry) => {
    const memberKey = normalizeMemberName(entry.swimmer);
    const memberRecords = records.filter((record) => normalizeMemberName(record.swimmer) === memberKey);
    const canonicalName = memberRecords[0]?.swimmer || entry.swimmer;
    const best = findBestForEvent(memberRecords, entry.event);
    return {
      ...entry,
      swimmer: canonicalName,
      reading: entry.reading || memberReadings[canonicalName] || memberReadings[entry.swimmer] || getNameReading(canonicalName),
      gender: entry.gender || getGender(entry.event) || latestGender(memberRecords),
      age: entry.age || calculateAge(memberBirthdates[canonicalName] || memberBirthdates[entry.swimmer]) || "",
      best
    };
  }), [meet, records, memberBirthdates, memberReadings]);
  const options = useMemo(() => ({
    ages: Array.from(new Set(entries.map((entry) => entry.age).filter(Boolean))).sort((a, b) => a - b),
    events: Array.from(new Set(entries.map((entry) => upcomingEventSectionName(entry.event)).filter(Boolean))).sort()
  }), [entries]);
  const filtered = entries.filter((entry) => {
    if (genderFilter !== "all" && entry.gender !== genderFilter) return false;
    if (ageFilter !== "all" && String(entry.age) !== ageFilter) return false;
    if (eventFilter !== "all" && upcomingEventSectionName(entry.event) !== eventFilter) return false;
    return true;
  });
  const groupedEntries = useMemo(() => groupUpcomingEntries(filtered), [filtered]);

  function openMember(entry) {
    const existing = memberByKey.get(normalizeMemberName(entry.swimmer));
    setSelectedMember(existing || {
      name: entry.swimmer,
      records: [],
      events: [],
      photoUrl: memberPhotos[entry.swimmer] || "",
      reading: entry.reading || "",
      gender: entry.gender || "",
      birthdate: memberBirthdates[entry.swimmer] || "",
      age: entry.age || "",
      swimClass: "",
      overallBest: null
    });
  }

  return (
    <>
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="settingsModal meetModal upcomingMeetModal" role="dialog" aria-modal="true" aria-label={`${meet.name}の出場予定`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader meetModalHeader">
          <div>
            <p className="eyebrow">出場予定</p>
            <h2>{meet.name}</h2>
            <span>{formatMeetDateRange(meet)} / {meet.place}</span>
          </div>
          <button className="iconButton closeButton" onClick={onClose} aria-label="閉じる">×</button>
        </header>
        <section className="upcomingEntryFilters" aria-label="出場予定の絞り込み">
          <label><span>性別</span><select value={genderFilter} onChange={(event) => setGenderFilter(event.target.value)}><option value="all">すべて</option><option value="男子">男子</option><option value="女子">女子</option><option value="混合">混合</option></select></label>
          <label><span>年齢</span><select value={ageFilter} onChange={(event) => setAgeFilter(event.target.value)}><option value="all">すべて</option>{options.ages.map((age) => <option key={age} value={age}>{age}歳</option>)}</select></label>
          <label className="upcomingEventFilter"><span>種目</span><select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}><option value="all">すべて</option>{options.events.map((eventName) => <option key={eventName} value={eventName}>{eventName}</option>)}</select></label>
        </section>
        <section className="upcomingEntryList" aria-label="出場予定メンバー">
          {groupedEntries.map((group) => (
            <section className={`upcomingEventSection ${eventColorClassName(group.eventName)}`} key={group.eventName}>
              <header>
                <h3>{group.eventName}</h3>
                <span>{group.entries.length}名</span>
              </header>
              <div className="upcomingEntryGrid">
                {group.entries.map((entry) => (
                  <button className="upcomingEntryCard" key={entry.id} onClick={() => openMember(entry)}>
                    <div className="upcomingEntryMember">
                      {entry.reading ? <small>{entry.reading}</small> : null}
                      <strong>{entry.swimmer}</strong>
                      <span>{[entry.gender, entry.age ? `${entry.age}歳` : ""].filter(Boolean).join(" / ")}</span>
                    </div>
                    <div className="upcomingBestTime">
                      <span>BEST</span>
                      <strong>{entry.best ? formatTime(entry.best.time) : "記録なし"}</strong>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </section>
        {!filtered.length ? <EmptyState title="該当する出場予定がありません" text="絞り込み条件を変更してください。" /> : null}
      </section>
    </div>
      {selectedMember ? (
        <MemberModal
          member={selectedMember}
          isArchived={archivedMembers.includes(selectedMember.name)}
          onArchiveToggle={onArchiveToggle}
          onPhotoUpdate={onPhotoUpdate}
          onReadingUpdate={onReadingUpdate}
          onBirthdateUpdate={onBirthdateUpdate}
          onClose={() => setSelectedMember(null)}
        />
      ) : null}
    </>
  );
}

function SettingsModal({ records, archivedMembers, memberPhotos, memberReadings, memberBirthdates, onArchiveToggle, onPhotoUpdate, onReadingUpdate, onBirthdateUpdate, onClose }) {
  const [selectedMember, setSelectedMember] = useState(null);
  const allMembers = useQualifiedMembers(records, memberPhotos, memberReadings, memberBirthdates);
  const archivedMemberCards = allMembers.filter((member) => archivedMembers.includes(member.name));

  useEffect(() => {
    if (!selectedMember) return;
    const refreshed = allMembers.find((member) => member.name === selectedMember.name);
    if (refreshed) setSelectedMember(refreshed);
  }, [allMembers, selectedMember?.name]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
        <section className="settingsModal" role="dialog" aria-modal="true" aria-label="設定" onMouseDown={(event) => event.stopPropagation()}>
          <header className="modalHeader">
            <div>
              <p className="eyebrow">設定</p>
              <h2>アーカイブ選手</h2>
              <span>退会・休会などで普段表示しない選手をここで管理します。</span>
            </div>
            <button className="iconButton closeButton" onClick={onClose} aria-label="閉じる">×</button>
          </header>
          <section className="archiveList">
            {archivedMemberCards.length ? (
              archivedMemberCards.map((member) => (
                <article className="archiveRow" key={member.name}>
                  <button onClick={() => setSelectedMember(member)}>
                    <strong>{member.name}</strong>
                    <span>{member.gender || "性別未取得"} / {member.birthdate ? `${formatBirthdate(member.birthdate)}（${member.age}歳）` : "未設定"} / {member.swimClass || "級未判定"}</span>
                  </button>
                  <button className="restoreButton" onClick={() => onArchiveToggle(member.name)}>戻す</button>
                </article>
              ))
            ) : (
              <EmptyState title="アーカイブ選手はいません" text="選手カードの詳細からアーカイブできます。" />
            )}
          </section>
        </section>
      </div>
      {selectedMember ? (
        <MemberModal
          member={selectedMember}
          isArchived
          onArchiveToggle={onArchiveToggle}
          onPhotoUpdate={onPhotoUpdate}
          onReadingUpdate={onReadingUpdate}
          onBirthdateUpdate={onBirthdateUpdate}
          onClose={() => setSelectedMember(null)}
        />
      ) : null}
    </>
  );
}

function PhotoUploadModal({ memberName, currentPhotoUrl = "", onSaved, onDelete, onClose }) {
  const albumInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const stageRef = useRef(null);
  const frameRef = useRef(null);
  const activePointers = useRef(new Map());
  const pinchStart = useRef(null);
  const panStart = useRef(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageMeta, setImageMeta] = useState(null);
  const [crop, setCrop] = useState(() => initialCardCrop());
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const frameAspect = imageMeta ? imageMeta.width / imageMeta.height : 1;
  const fittedCrop = fitCropToFrame(crop, frameAspect);

  async function handleFile(file) {
    if (!file) return;
    const nextUrl = URL.createObjectURL(file);
    const image = await loadImage(nextUrl);
    const nextMeta = { width: image.naturalWidth, height: image.naturalHeight };
    setImageUrl(nextUrl);
    setImageMeta(nextMeta);
    setCrop(initialCardCrop(nextMeta.width / nextMeta.height));
    setImageZoom(1);
    setImagePan({ x: 0, y: 0 });
    setMessage("");
  }

  function handleStagePointerDown(event) {
    if (!imageUrl) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.current.size === 2) {
      const [first, second] = Array.from(activePointers.current.values());
      pinchStart.current = {
        distance: getPointerDistance(first, second),
        zoom: imageZoom
      };
      panStart.current = null;
      setDragging(null);
      return;
    }
    panStart.current = {
      startX: event.clientX,
      startY: event.clientY,
      pan: imagePan,
      rect: frameRef.current?.getBoundingClientRect()
    };
  }

  function handlePointerDown(event, mode = "move") {
    if (!imageUrl) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = frameRef.current.getBoundingClientRect();
    setDragging({
      mode,
      startX: event.clientX,
      startY: event.clientY,
      crop: fittedCrop,
      rect
    });
  }

  function handlePointerMove(event) {
    if (activePointers.current.has(event.pointerId)) {
      activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinchStart.current && activePointers.current.size >= 2) {
      const [first, second] = Array.from(activePointers.current.values());
      const distance = getPointerDistance(first, second);
      const nextZoom = clamp(pinchStart.current.zoom * (distance / pinchStart.current.distance), 1, 4);
      setImageZoom(nextZoom);
      setImagePan((current) => clampImagePan(current, nextZoom));
      return;
    }
    if (panStart.current && activePointers.current.size === 1) {
      const rect = panStart.current.rect;
      if (!rect) return;
      const dx = ((event.clientX - panStart.current.startX) / rect.width) * 100;
      const dy = ((event.clientY - panStart.current.startY) / rect.height) * 100;
      setImagePan(clampImagePan({
        x: panStart.current.pan.x + dx,
        y: panStart.current.pan.y + dy
      }, imageZoom));
      return;
    }
    if (!dragging) return;
    const dx = ((event.clientX - dragging.startX) / dragging.rect.width) * 100;
    const dy = ((event.clientY - dragging.startY) / dragging.rect.height) * 100;

    if (dragging.mode === "resize") {
      const maxWidth = getMaxCropWidth(frameAspect);
      const nextWidth = clamp(dragging.crop.width + Math.max(dx, dy), 28, maxWidth);
      const nextHeight = getCropHeight(nextWidth, frameAspect);
      setCrop({
        ...dragging.crop,
        width: nextWidth,
        height: nextHeight,
        x: clamp(dragging.crop.x, 0, 100 - nextWidth),
        y: clamp(dragging.crop.y, 0, 100 - nextHeight)
      });
      return;
    }

    setCrop({
      ...dragging.crop,
      x: clamp(dragging.crop.x + dx, 0, 100 - dragging.crop.width),
      y: clamp(dragging.crop.y + dy, 0, 100 - dragging.crop.height)
    });
  }

  function handlePointerUp() {
    activePointers.current.clear();
    pinchStart.current = null;
    panStart.current = null;
    setDragging(null);
  }

  async function handleSave() {
    if (!imageUrl) return;
    setSaving(true);
    setMessage("");
    try {
      const blob = await cropImageToCard(imageUrl, fittedCrop, imageZoom, imagePan);
      let photoUrl;
      try {
        photoUrl = await uploadMemberImage(blob, memberName);
      } catch {
        photoUrl = await blobToDataUrl(blob);
        setMessage("Firebase未設定のため、この端末内に保存しました。");
      }
      onSaved(photoUrl);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop topModal" role="presentation" onMouseDown={onClose}>
      <section className="uploadModal" role="dialog" aria-modal="true" aria-label="画像アップロード" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <p className="eyebrow">画像</p>
            <h2>{memberName}</h2>
            <span>顔が見やすいように正方形でトリミングします。</span>
          </div>
          <button className="iconButton closeButton" onClick={onClose} aria-label="閉じる">×</button>
        </header>
        <div className="uploadActions">
          <button onClick={() => cameraInputRef.current?.click()}>
            <Camera size={18} />
            <span>カメラ</span>
          </button>
          <button onClick={() => albumInputRef.current?.click()}>
            <ImagePlus size={18} />
            <span>アルバム</span>
          </button>
          {currentPhotoUrl ? (
            <button className="deletePhotoButton" onClick={onDelete}>
              <span>削除</span>
            </button>
          ) : null}
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={(event) => handleFile(event.target.files?.[0])} />
          <input ref={albumInputRef} type="file" accept="image/*" onChange={(event) => handleFile(event.target.files?.[0])} />
        </div>
        <div
          className="cropStage"
          ref={stageRef}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {imageUrl ? (
            <div className="cropImageFrame" ref={frameRef} style={getImageFrameStyle(imageMeta, imageZoom, imagePan)}>
              <img src={imageUrl} alt="" />
              <div className="cropShade" />
              <div
                className="cropBox"
                style={{ left: `${fittedCrop.x}%`, top: `${fittedCrop.y}%`, width: `${fittedCrop.width}%`, height: `${fittedCrop.height}%` }}
                onPointerDown={(event) => handlePointerDown(event, "move")}
              >
                <span className="cropHandle" onPointerDown={(event) => {
                  event.stopPropagation();
                  handlePointerDown(event, "resize");
                }} />
              </div>
            </div>
          ) : (
            <span>画像を選択してください</span>
          )}
        </div>
        {message ? <p className="uploadMessage">{message}</p> : null}
        <button className="syncButton savePhotoButton" onClick={handleSave} disabled={!imageUrl || saving}>
          {saving ? "保存中" : "保存"}
        </button>
      </section>
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="emptyState">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function buildMemberCards(records, memberPhotos = {}, memberReadings = {}, memberBirthdates = {}) {
  const byMember = new Map();
  records.forEach((record) => {
    const existing = byMember.get(record.swimmer) || [];
    existing.push(record);
    byMember.set(record.swimmer, existing);
  });

  return Array.from(byMember.entries())
    .map(([name, memberRecords]) => {
      const events = Array.from(new Set(memberRecords.map((record) => record.event))).sort();
      return {
        name,
        records: memberRecords,
        events,
        photoUrl: memberPhotos[name] || "",
        reading: getDisplayReading(name, memberReadings[name]),
        gender: latestGender(memberRecords),
        birthdate: memberBirthdates[name] || "",
        age: calculateAge(memberBirthdates[name]),
        swimClass: "",
        overallBest: getBestRecord(memberRecords)
      };
    })
    .sort((a, b) => (Number(a.age) || 999) - (Number(b.age) || 999) || a.name.localeCompare(b.name, "ja"));
}

function parseBirthdate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? { year: match[1], month: String(Number(match[2])), day: String(Number(match[3])) } : { year: "", month: "", day: "" };
}

function calculateAge(value, referenceDate = new Date()) {
  const parsed = parseBirthdate(value);
  if (!parsed.year) return "";
  let age = referenceDate.getFullYear() - Number(parsed.year);
  const birthdayHasPassed = referenceDate.getMonth() + 1 > Number(parsed.month)
    || (referenceDate.getMonth() + 1 === Number(parsed.month) && referenceDate.getDate() >= Number(parsed.day));
  if (!birthdayHasPassed) age -= 1;
  return age >= 0 ? age : "";
}

function formatBirthdate(value) {
  return String(value || "").replace(/-/g, "/");
}

function buildMemberFilterOptions(members) {
  return {
    genders: Array.from(new Set(members.map((member) => member.gender).filter(Boolean))).sort(),
    ages: Array.from(new Set(members.map((member) => member.age).filter(Boolean))).sort((a, b) => a - b),
    classes: Array.from(new Set(members.map((member) => member.swimClass).filter(Boolean))).sort(compareSwimClass)
  };
}

function sortMembers(members, sortMode) {
  return [...members].sort((a, b) => {
    if (sortMode === "class") {
      return compareSwimClass(a.swimClass, b.swimClass) || (Number(a.age) || 999) - (Number(b.age) || 999) || a.name.localeCompare(b.name, "ja");
    }
    return (Number(a.age) || 999) - (Number(b.age) || 999) || compareSwimClass(a.swimClass, b.swimClass) || a.name.localeCompare(b.name, "ja");
  });
}

function buildMemberEventSummaries(records) {
  const byEvent = new Map();
  records.forEach((record) => {
    const existing = byEvent.get(record.event) || [];
    existing.push(record);
    byEvent.set(record.event, existing);
  });
  return Array.from(byEvent.entries())
    .map(([eventName, eventRecords]) => {
      const sortedRecords = [...eventRecords].sort((a, b) => b.date.localeCompare(a.date));
      return {
        eventName,
        records: sortedRecords,
        best: getBestRecord(sortedRecords)
      };
    })
    .sort((a, b) => a.eventName.localeCompare(b.eventName, "ja"));
}

function buildFilterOptions(records, members = []) {
  return {
    events: Array.from(new Set(records.map((record) => record.event).filter(Boolean))).sort(),
    ages: Array.from(new Set(members.map((member) => member.age).filter(Boolean))).sort((a, b) => a - b),
    classes: Array.from(new Set(members.map((member) => member.swimClass).filter(Boolean))).sort(compareSwimClass)
  };
}

function buildMeetCards(records) {
  const byMeet = new Map();
  records.forEach((record) => {
    const key = `${record.date}-${record.meet}`;
    const existing = byMeet.get(key) || { key, date: record.date, name: record.meet, place: record.place, records: [] };
    existing.records.push(record);
    byMeet.set(key, existing);
  });
  return Array.from(byMeet.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function buildUpcomingMeetCards(meets, query = "") {
  const today = new Date();
  const todayText = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
  const needle = normalizeSearchText(query);
  return meets
    .map((meet) => ({
      key: meet.id || `${meet.date}-${meet.name}`,
      date: meet.date,
      endDate: meet.endDate || meet.date,
      name: meet.name,
      place: meet.place || "",
      sourceUrl: meet.sourceUrl || "",
      status: "upcoming",
      records: [],
      entries: Array.isArray(meet.entries) ? meet.entries : []
    }))
    .filter((meet) => meet.entries.length > 0 && (meet.endDate || meet.date || "") >= todayText)
    .filter((meet) => {
      if (!needle) return true;
      return normalizeSearchText([meet.date, meet.name, meet.place, ...meet.entries.flatMap((entry) => [entry.swimmer, entry.reading, entry.event])].filter(Boolean).join(" ")).includes(needle);
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function upcomingEventSectionName(value) {
  const text = String(value || "").normalize("NFKC").trim();
  const distanceIndex = text.search(/(?:50|100|200|400|800|1500)m/i);
  return distanceIndex >= 0 ? text.slice(distanceIndex).trim() : text;
}

function groupUpcomingEntries(entries) {
  const byEvent = new Map();
  entries.forEach((entry) => {
    const eventName = upcomingEventSectionName(entry.event) || "種目未取得";
    const current = byEvent.get(eventName) || [];
    current.push(entry);
    byEvent.set(eventName, current);
  });
  return Array.from(byEvent, ([eventName, eventEntries]) => ({
    eventName,
    entries: [...eventEntries].sort((a, b) => a.swimmer.localeCompare(b.swimmer, "ja"))
  })).sort((a, b) => a.eventName.localeCompare(b.eventName, "ja"));
}

function groupMeetRecordsByEvent(records) {
  const byEvent = new Map();
  records.forEach((record) => {
    const eventName = upcomingEventSectionName(record.event) || "種目未取得";
    const current = byEvent.get(eventName) || [];
    current.push(record);
    byEvent.set(eventName, current);
  });
  return Array.from(byEvent, ([eventName, eventRecords]) => ({
    eventName,
    records: [...eventRecords].sort((a, b) => {
      const timeDiff = timeToMilliseconds(a.time) - timeToMilliseconds(b.time);
      if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
      return a.swimmer.localeCompare(b.swimmer, "ja");
    })
  })).sort((a, b) => a.eventName.localeCompare(b.eventName, "ja"));
}

function findBestForEvent(records, eventName) {
  const target = qualificationEvent(eventName) || extractEventKey(eventName);
  const targetWaterway = eventWaterway(eventName);
  const matching = records.filter((record) => {
    const candidate = qualificationEvent(record.event) || extractEventKey(record.event);
    if (target && candidate) {
      return target.stroke === candidate.stroke && target.distance === candidate.distance;
    }
    return normalizeEventMatchText(record.event) === normalizeEventMatchText(eventName);
  });
  if (!matching.length) return null;
  const sameWaterway = targetWaterway
    ? matching.filter((record) => eventWaterway(record.event) === targetWaterway)
    : [];
  return getBestRecord(sameWaterway.length ? sameWaterway : matching);
}

function extractEventKey(value) {
  const text = String(value || "").normalize("NFKC");
  const distance = Number(text.match(/(\d{2,4})\s*m/i)?.[1] || 0);
  let stroke = "";
  if (text.includes("個人メドレー")) stroke = "個人メドレー";
  else if (text.includes("自由形")) stroke = "自由形";
  else if (text.includes("背泳ぎ")) stroke = "背泳ぎ";
  else if (text.includes("平泳ぎ")) stroke = "平泳ぎ";
  else if (text.includes("バタフライ")) stroke = "バタフライ";
  if (!distance || !stroke) return null;
  return { distance, stroke, waterway: eventWaterway(text) };
}

function eventWaterway(value) {
  const text = String(value || "").normalize("NFKC");
  if (text.includes("長水路")) return "長水路";
  if (text.includes("短水路")) return "短水路";
  return "";
}

function normalizeMemberName(value) {
  return String(value || "").normalize("NFKC").replace(/[\s・･]/g, "").toLowerCase();
}

function normalizeEventMatchText(value) {
  return normalizeSearchText(String(value || "").replace(/(予選|決勝|タイム決勝|T決勝|年齢別|全区分|小学生|\d+歳以上|\d+歳以下)/g, ""));
}

function groupRecordsByMeet(records) {
  const byMeet = new Map();
  records.forEach((record) => {
    const key = `${record.date}-${record.meet}`;
    const group = byMeet.get(key) || { key, date: record.date, meet: record.meet || "大会名未取得", records: [] };
    group.records.push(record);
    byMeet.set(key, group);
  });
  return Array.from(byMeet.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function latestValue(records, key) {
  return [...records].sort((a, b) => b.date.localeCompare(a.date)).find((record) => record[key])?.[key] || "";
}

function latestGender(records) {
  return [...records].sort((a, b) => b.date.localeCompare(a.date)).map((record) => getGender(record.event)).find(Boolean) || "";
}

function latestSwimClass(records) {
  return [...records].sort((a, b) => b.date.localeCompare(a.date)).map(getSwimClass).find(Boolean) || "";
}

function getBestRecord(records) {
  return records.reduce((best, record) => {
    if (!best) return record;
    return timeToMilliseconds(record.time) < timeToMilliseconds(best.time) ? record : best;
  }, null);
}

function timeToMilliseconds(time) {
  if (!time) return Number.POSITIVE_INFINITY;
  const parts = time.split(":").map(Number);
  if (parts.length === 1) return parts[0] * 1000;
  return parts[0] * 60 * 1000 + parts[1] * 1000;
}

function getGender(eventName) {
  if (eventName?.includes("男子")) return "男子";
  if (eventName?.includes("女子")) return "女子";
  if (eventName?.includes("混合")) return "混合";
  return "";
}

function eventColorClassName(eventName = "") {
  if (eventName.includes("個人メドレー") || eventName.includes("メドレー")) return "eventMedley";
  if (eventName.includes("バタフライ")) return "eventFly";
  if (eventName.includes("背泳ぎ")) return "eventBack";
  if (eventName.includes("平泳ぎ")) return "eventBreast";
  if (eventName.includes("自由形")) {
    if (eventName.includes("400m") || eventName.includes("800m") || eventName.includes("1500m")) return "eventDistanceFree";
    if (eventName.includes("200m")) return "eventMidFree";
    return "eventFree";
  }
  return "eventOther";
}

function genderClassName(gender) {
  if (gender === "男子") return "maleChip";
  if (gender === "女子") return "femaleChip";
  if (gender === "混合") return "mixedChip";
  return "unknownChip";
}

function buildRecordSearchText(record, memberReadings = {}) {
  const values = [record.swimmer, memberReadings[record.swimmer], getNameReading(record.swimmer), record.event, record.meet, record.place, record.note];
  return normalizeSearchText(values.filter(Boolean).join(" "));
}

function getNameReading(name) {
  return NAME_READING_PARTS.reduce((reading, [kanji, kana]) => reading.replaceAll(kanji, kana), String(name || ""));
}

function getDisplayReading(name, savedReading) {
  const reading = normalizeSearchText(savedReading || getNameReading(name));
  const normalizedName = normalizeSearchText(name);
  return reading && reading !== normalizedName ? reading : "";
}

function normalizeSearchText(value) {
  return toHiragana(String(value || ""))
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
}

function toHiragana(value) {
  return value.replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

function getSwimClass(record) {
  const direct = record.swimClass || record.class || record.level;
  if (direct) return normalizeSwimClass(direct);
  return normalizeSwimClass([record.grade, record.note, record.event].filter(Boolean).join(" "));
}

function normalizeSwimClass(value) {
  const text = String(value || "").replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  return text.match(/(?:\d{1,2}|[A-ZＳ])級/)?.[0] || "";
}

function compareSwimClass(a, b) {
  return swimClassOrder(a) - swimClassOrder(b) || a.localeCompare(b, "ja");
}

function swimClassOrder(value) {
  const text = String(value || "");
  const number = Number(text.replace(/\D/g, ""));
  if (Number.isFinite(number) && number > 0) return number;
  if (text.includes("S") || text.includes("Ｓ")) return 0;
  return 99;
}

function getLatestDate(records) {
  return records.reduce((latest, record) => (record.date > latest ? record.date : latest), "");
}

function isEventBest(records, targetRecord) {
  const eventRecords = records.filter((record) => record.event === targetRecord.event);
  const best = getBestRecord(eventRecords);
  return best?.id === targetRecord.id || timeToMilliseconds(targetRecord.time) <= timeToMilliseconds(best?.time);
}

function readSeenMemberUpdates() {
  try {
    return JSON.parse(localStorage.getItem("rs-kenneys-seen-member-updates") || "[]");
  } catch {
    return [];
  }
}

function saveSeenMemberUpdates(values) {
  localStorage.setItem("rs-kenneys-seen-member-updates", JSON.stringify(values.slice(-300)));
}

function compareGrade(a, b) {
  return gradeOrder(a) - gradeOrder(b);
}

function gradeOrder(grade) {
  const group = grade?.[0] || "";
  const number = Number(grade?.replace(/\D/g, "") || 0);
  const base = group === "小" ? 0 : group === "中" ? 10 : group === "高" ? 20 : 30;
  return base + number;
}

function formatRank(rank) {
  if (!rank) return "";
  return /^\d+$/.test(rank) ? `${rank}位` : rank;
}

function rankClassName(rank) {
  const value = Number.parseInt(String(rank || "").replace(/\D/g, ""), 10);
  if (value === 1) return "rankValue rankFirst";
  if (value === 2) return "rankValue rankSecond";
  if (value === 3) return "rankValue rankThird";
  return "rankValue";
}

function formatTime(time) {
  if (!time) return "--";
  return `${time}秒`;
}

function formatMeetDateRange(meet) {
  if (!meet?.date) return "-";
  const startDate = formatDateWithWeekday(meet.date);
  if (!meet.endDate || meet.endDate === meet.date) return startDate;
  return `${startDate} - ${formatDateWithWeekday(meet.endDate)}`;
}

function formatDateWithWeekday(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("/").map(Number);
  if (!year || !month || !day) return value;
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const date = new Date(year, month - 1, day);
  return `${value}(${weekdays[date.getDay()]})`;
}

function formatRefreshInterval(minutes) {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440}日ごと`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}時間ごと`;
  return `${minutes}分ごと`;
}

function initialCardCrop(frameAspect = 1) {
  const width = frameAspect >= CARD_CROP_ASPECT ? 78 / frameAspect : 78;
  const height = getCropHeight(width, frameAspect);
  return {
    x: (100 - width) / 2,
    y: (100 - height) / 2,
    width,
    height
  };
}

async function cropImageToCard(imageUrl, crop, imageZoom = 1, imagePan = { x: 0, y: 0 }) {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = Math.round(canvas.width / CARD_CROP_ASPECT);
  const context = canvas.getContext("2d");

  const zoom = Math.max(1, imageZoom || 1);
  const sourceXPercent = clamp(50 + (crop.x - 50 - (imagePan.x || 0)) / zoom, 0, 100);
  const sourceYPercent = clamp(50 + (crop.y - 50 - (imagePan.y || 0)) / zoom, 0, 100);
  const sourceWidthPercent = Math.min(crop.width / zoom, 100 - sourceXPercent);
  const sourceHeightPercent = Math.min(crop.height / zoom, 100 - sourceYPercent);
  const sx = image.naturalWidth * (sourceXPercent / 100);
  const sy = image.naturalHeight * (sourceYPercent / 100);
  const sourceWidth = image.naturalWidth * (sourceWidthPercent / 100);
  const sourceHeight = image.naturalHeight * (sourceHeightPercent / 100);

  context.drawImage(image, sx, sy, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

function getCropHeight(width, frameAspect = 1) {
  return width * frameAspect / CARD_CROP_ASPECT;
}

function getMaxCropWidth(frameAspect = 1) {
  return Math.min(94, 94 / frameAspect);
}

function fitCropToFrame(crop, frameAspect = 1) {
  const width = clamp(crop.width, 28, getMaxCropWidth(frameAspect));
  const height = getCropHeight(width, frameAspect);
  return {
    ...crop,
    width,
    height,
    x: clamp(crop.x, 0, 100 - width),
    y: clamp(crop.y, 0, 100 - height)
  };
}

function getPointerDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y) || 1;
}

function clampImagePan(pan, imageZoom = 1) {
  const maxPan = 50 * (Math.max(1, imageZoom || 1) - 1) / Math.max(1, imageZoom || 1);
  return {
    x: clamp(pan.x || 0, -maxPan, maxPan),
    y: clamp(pan.y || 0, -maxPan, maxPan)
  };
}

function getImageFrameStyle(meta, imageZoom = 1, imagePan = { x: 0, y: 0 }) {
  if (!meta?.width || !meta?.height) return {};
  const zoom = Math.max(1, imageZoom || 1);
  const pan = clampImagePan(imagePan, zoom);
  const imageAspect = meta.width / meta.height;
  if (imageAspect >= 1) {
    const height = 100 / imageAspect;
    return {
      width: "100%",
      height: `${height}%`,
      left: "0%",
      top: `${(100 - height) / 2}%`,
      "--image-zoom": zoom,
      "--image-pan-x": `${pan.x}%`,
      "--image-pan-y": `${pan.y}%`
    };
  }
  const width = imageAspect * 100;
  return {
    width: `${width}%`,
    height: "100%",
    left: `${(100 - width) / 2}%`,
    top: "0%",
    "--image-zoom": zoom,
    "--image-pan-x": `${pan.x}%`,
    "--image-pan-y": `${pan.y}%`
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

createRoot(document.getElementById("root")).render(<App />);
