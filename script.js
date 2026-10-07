(() => {
  "use strict";

  const STORAGE_KEY = "timework-tracker-v2";
  const LEGACY_STORAGE_KEY = "chas-freelance-tracker-v1";
  const DEFAULT_RATE = 1500;
  const MAX_RATE = 1_000_000_000;
  const HOUR_MS = 3_600_000;
  const SECOND_MS = 1000;
  const MAX_HISTORY_ITEMS = 20;
  const VALID_PERIODS = new Set(["day", "week", "month"]);

  const $ = (id) => document.getElementById(id);
  const ui = {
    rate: $("hourly-rate"),
    project: $("project-name"),
    timer: $("timer"),
    status: $("timer-status"),
    liveEarned: $("live-earned"),
    start: $("start-button"),
    pause: $("pause-button"),
    stop: $("stop-button"),
    period: $("period-select"),
    periodLabel: $("period-label"),
    periodTime: $("period-time"),
    periodCount: $("period-count"),
    periodEarned: $("period-earned"),
    list: $("session-list"),
    empty: $("empty-state"),
    clear: $("clear-button")
  };

  if (Object.values(ui).some((element) => !element)) {
    console.error("TimeWork: проверьте ID элементов в HTML.");
    return;
  }

  const state = loadState();
  let ticker = null;

  function validRate(value) {
    return Number.isFinite(value) && value >= 0 && value <= MAX_RATE;
  }

  function cleanProject(value) {
    return typeof value === "string" ? value.trim().slice(0, 120) : "";
  }

  function normalizeSession(session) {
    if (!session || typeof session !== "object") return null;

    if (
      Number.isFinite(session.startedAt) &&
      Number.isFinite(session.durationMs) && session.durationMs >= 0 &&
      Number.isFinite(session.rate) && session.rate >= 0
    ) {
      return {
        startedAt: session.startedAt,
        durationMs: session.durationMs,
        project: cleanProject(session.project),
        rate: session.rate
      };
    }

    // Поддержка формата завершённых сессий из предыдущей версии.
    if (
      Number.isFinite(session.startedAt) &&
      Number.isFinite(session.endedAt) && session.endedAt >= session.startedAt &&
      Number.isFinite(session.rate) && session.rate >= 0
    ) {
      return {
        startedAt: session.startedAt,
        durationMs: session.endedAt - session.startedAt,
        project: cleanProject(session.project),
        rate: session.rate
      };
    }

    return null;
  }

  function normalizeActive(active) {
    if (!active || typeof active !== "object" || !Number.isFinite(active.startedAt)) {
      return null;
    }

    const now = Date.now();
    const segmentStartedAt = Number.isFinite(active.segmentStartedAt) &&
      active.segmentStartedAt <= now
      ? active.segmentStartedAt
      : null;

    return {
      startedAt: active.startedAt,
      project: cleanProject(active.project),
      elapsedBeforePause: Number.isFinite(active.elapsedBeforePause)
        ? Math.max(0, active.elapsedBeforePause)
        : 0,
      segmentStartedAt
    };
  }

  function loadState() {
    const fallback = { rate: DEFAULT_RATE, sessions: [], active: null, period: "day" };

    try {
      let saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) saved = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return fallback;

      return {
        rate: validRate(saved.rate) ? saved.rate : DEFAULT_RATE,
        sessions: Array.isArray(saved.sessions)
          ? saved.sessions.map(normalizeSession).filter(Boolean)
          : [],
        active: normalizeActive(saved.active),
        period: VALID_PERIODS.has(saved.period) ? saved.period : "day"
      };
    } catch {
      return fallback;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      ui.liveEarned.textContent = "Не удалось сохранить данные в браузере.";
      return false;
    }
  }

  function activeDurationMs(active, now = Date.now()) {
    const currentSegment = active.segmentStartedAt === null
      ? 0
      : Math.max(0, now - active.segmentStartedAt);
    return active.elapsedBeforePause + currentSegment;
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / SECOND_MS);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  function formatWorkTime(milliseconds) {
    const totalMinutes = Math.floor(milliseconds / 60_000);
    return `${Math.floor(totalMinutes / 60)} ч ${totalMinutes % 60} мин`;
  }

  function formatMoney(amount) {
    return `${new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 0
    }).format(Math.round(amount))} ₽`;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function getPeriodBounds(period, now = new Date()) {
    if (period === "week") {
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const daysSinceMonday = (monday.getDay() + 6) % 7;
      monday.setDate(monday.getDate() - daysSinceMonday);
      const nextMonday = new Date(monday);
      nextMonday.setDate(nextMonday.getDate() + 7);
      return { start: monday.getTime(), end: nextMonday.getTime() };
    }

    if (period === "month") {
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
      };
    }

    const start = startOfDay(now);
    const nextDay = new Date(start);
    nextDay.setDate(nextDay.getDate() + 1);
    return { start, end: nextDay.getTime() };
  }

  function periodLabel(period, now = new Date()) {
    if (period === "week") {
      const bounds = getPeriodBounds("week", now);
      const start = new Date(bounds.start);
      const end = new Date(bounds.end);
      end.setDate(end.getDate() - 1);
      const format = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
      return `${format.format(start)} — ${format.format(end)}`;
    }

    if (period === "month") {
      return new Intl.DateTimeFormat("ru-RU", {
        month: "long",
        year: "numeric"
      }).format(now);
    }

    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(now);
  }

  function formatSessionDate(timestamp) {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(timestamp));
  }

  function startTicker() {
    if (ticker === null) ticker = window.setInterval(render, SECOND_MS);
  }

  function stopTicker() {
    if (ticker !== null) window.clearInterval(ticker);
    ticker = null;
  }

  function startSession() {
    if (state.active) return;

    const now = Date.now();
    state.active = {
      startedAt: now,
      project: cleanProject(ui.project.value),
      elapsedBeforePause: 0,
      segmentStartedAt: now
    };

    saveState();
    startTicker();
    render();
  }

  function togglePause() {
    const active = state.active;
    if (!active) return;

    if (active.segmentStartedAt !== null) {
      active.elapsedBeforePause += Math.max(0, Date.now() - active.segmentStartedAt);
      active.segmentStartedAt = null;
      stopTicker();
    } else {
      active.segmentStartedAt = Date.now();
      startTicker();
    }

    saveState();
    render();
  }

  function stopSession() {
    const active = state.active;
    if (!active) return;

    state.sessions.unshift({
      startedAt: active.startedAt,
      durationMs: activeDurationMs(active),
      project: active.project,
      rate: state.rate
    });
    state.active = null;
    stopTicker();
    saveState();
    render();
  }

  function renderHistory(sessions) {
    ui.list.replaceChildren();
    ui.empty.hidden = sessions.length > 0;
    const fragment = document.createDocumentFragment();

    sessions.slice(0, MAX_HISTORY_ITEMS).forEach((session) => {
      const item = document.createElement("li");
      item.className = "session";

      const info = document.createElement("div");
      const name = document.createElement("div");
      name.className = "session-name";
      name.textContent = session.project || "Без названия";

      const date = document.createElement("div");
      date.className = "session-date";
      date.textContent = formatSessionDate(session.startedAt);
      info.append(name, date);

      const duration = document.createElement("div");
      duration.className = "session-duration";
      duration.textContent = formatDuration(session.durationMs);

      const amount = document.createElement("div");
      amount.className = "session-amount";
      amount.textContent = formatMoney(session.durationMs / HOUR_MS * session.rate);

      item.append(info, duration, amount);
      fragment.append(item);
    });

    ui.list.append(fragment);
  }

  function render() {
    const now = Date.now();
    const active = state.active;
    const paused = Boolean(active && active.segmentStartedAt === null);
    const currentDuration = active ? activeDurationMs(active, now) : 0;

    if (document.activeElement !== ui.rate) ui.rate.value = String(state.rate);
    if (ui.period.value !== state.period) ui.period.value = state.period;

    ui.timer.textContent = active ? formatDuration(currentDuration) : "00:00:00";
    ui.status.textContent = !active ? "ГОТОВЫ НАЧАТЬ?" : paused ? "НА ПАУЗЕ" : "В РАБОТЕ";
    ui.liveEarned.textContent = active
      ? `Заработано за сессию: ${formatMoney(currentDuration / HOUR_MS * state.rate)}`
      : "Запустите таймер, чтобы считать заработок";

    ui.start.disabled = Boolean(active);
    ui.pause.disabled = !active;
    ui.pause.textContent = paused ? "Продолжить" : "Пауза";
    ui.pause.setAttribute("aria-label", paused ? "Продолжить работу" : "Поставить на паузу");
    ui.stop.disabled = !active;
    ui.project.disabled = Boolean(active);

    const nowDate = new Date(now);
    const bounds = getPeriodBounds(state.period, nowDate);
    const sessions = state.sessions
      .filter((session) => session.startedAt >= bounds.start && session.startedAt < bounds.end)
      .sort((a, b) => b.startedAt - a.startedAt);

    let totalTime = sessions.reduce((sum, session) => sum + session.durationMs, 0);
    let totalEarned = sessions.reduce(
      (sum, session) => sum + session.durationMs / HOUR_MS * session.rate,
      0
    );

    const activeInPeriod = active && active.startedAt >= bounds.start && active.startedAt < bounds.end;
    if (activeInPeriod) {
      totalTime += currentDuration;
      totalEarned += currentDuration / HOUR_MS * state.rate;
    }

    ui.periodLabel.textContent = periodLabel(state.period, nowDate);
    ui.periodTime.textContent = formatWorkTime(totalTime);
    ui.periodCount.textContent = String(sessions.length + Number(Boolean(activeInPeriod)));
    ui.periodEarned.textContent = formatMoney(totalEarned);
    renderHistory(sessions);
  }

  ui.rate.addEventListener("change", () => {
    const newRate = Number(ui.rate.value);
    if (!validRate(newRate)) {
      ui.rate.value = String(state.rate);
      return;
    }
    state.rate = newRate;
    saveState();
    render();
  });

  ui.rate.addEventListener("keydown", (event) => {
    if (event.key === "Enter") ui.rate.blur();
  });

  ui.period.addEventListener("change", () => {
    state.period = VALID_PERIODS.has(ui.period.value) ? ui.period.value : "day";
    saveState();
    render();
  });

  ui.start.addEventListener("click", startSession);
  ui.pause.addEventListener("click", togglePause);
  ui.stop.addEventListener("click", stopSession);

  ui.clear.addEventListener("click", () => {
    if (!state.sessions.length || !window.confirm("Удалить всю историю завершённых сессий?")) return;
    state.sessions = [];
    saveState();
    render();
  });

  if (state.active && state.active.segmentStartedAt !== null) startTicker();
  render();
})();