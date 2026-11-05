import {
  calculatePaceSeconds,
  evaluateRoutePoint,
  formatDistance,
  formatDuration,
  formatDurationCompact,
  formatPace,
  isUsablePoint,
  pointFromPosition,
  totalStats,
  weekRangeLabel,
  weeklyStats,
} from "./geo.js";
import {
  buildKilometerSplits,
  buildWeeklyBuckets,
  consecutiveCompletedWeeks,
  fastestFullSplit,
  goalProgress,
  groupRunsByMonth,
  monthStats,
  personalRecords,
  rollingPaceSeconds,
  runDurationMilliseconds,
  runPaceSeconds,
} from "./analytics.js";
import {
  clearActiveRun,
  deleteRun,
  getAllRuns,
  getActiveRun,
  getSettings,
  saveActiveRun,
  saveRun,
  saveRuns,
  saveSettings,
} from "./db.js";
import {
  DEFAULT_SETTINGS,
  createBackup,
  mergeBackupRuns,
  normalizeSettings,
  parseBackup,
} from "./data-model.js";
import { renderSplitChart, renderWeeklyChart } from "./charts.js";
import { renderRouteSvg } from "./route-view.js";

const APP_VERSION = "2.0.0";
const SVG_NS = "http://www.w3.org/2000/svg";

const $ = (id) => document.getElementById(id);

const elements = {
  appShell: document.querySelector(".app-shell"),
  topbar: $("topbar"),
  todayLabel: $("today-label"),
  settingsButton: $("settings-button"),
  mainContent: $("main-content"),
  tabbar: $("tabbar"),
  views: {
    home: $("home-view"),
    history: $("history-view"),
    trends: $("trends-view"),
    settings: $("settings-view"),
    record: $("record-view"),
  },
  weekRange: $("week-range"),
  weekDistance: $("week-distance"),
  weekDistanceTarget: $("week-distance-target"),
  weekDistanceProgress: $("week-distance-progress"),
  weekDistanceBar: $("week-distance-bar"),
  weekGoalRemaining: $("week-goal-remaining"),
  weekCount: $("week-count"),
  weekCountTarget: $("week-count-target"),
  weekCountDots: $("week-count-dots"),
  weekDuration: $("week-duration"),
  goalStreak: $("goal-streak"),
  latestRun: $("latest-run"),
  homeWeekNote: $("home-week-note"),
  startButton: $("start-run-button"),
  totalDistance: $("total-distance"),
  totalCount: $("total-count"),
  historyList: $("history-list"),
  trendWeekRange: $("trend-week-range"),
  trendWeekDistance: $("trend-week-distance"),
  trendWeekCount: $("trend-week-count"),
  trendDistanceBar: $("trend-distance-bar"),
  trendCountBar: $("trend-count-bar"),
  weeklyChart: $("weekly-chart"),
  monthDistance: $("month-distance"),
  trendStreak: $("trend-streak"),
  personalRecords: $("personal-records"),
  goalSettingsForm: $("goal-settings-form"),
  weeklyDistanceGoal: $("weekly-distance-goal"),
  weeklyCountGoal: $("weekly-count-goal"),
  settingsBackButton: $("settings-back-button"),
  storageState: $("storage-state"),
  storageUsage: $("storage-usage"),
  exportBackupButton: $("export-backup-button"),
  importBackupButton: $("import-backup-button"),
  backupFileInput: $("backup-file-input"),
  appVersion: $("app-version"),
  recordBackButton: $("record-back-button"),
  deleteRunButton: $("delete-run-button"),
  recordDate: $("record-date"),
  recordTitle: $("record-title"),
  recordDistance: $("record-distance"),
  recordDuration: $("record-duration"),
  recordPace: $("record-pace"),
  recordFastestSplit: $("record-fastest-split"),
  recordRoute: $("record-route"),
  splitCaption: $("split-caption"),
  splitChart: $("split-chart"),
  splitList: $("split-list"),
  recordNote: $("record-note"),
  runView: $("run-view"),
  runKicker: $("run-kicker"),
  runTitle: $("run-title"),
  gpsBadge: $("gps-badge"),
  gpsLabel: $("gps-label"),
  liveDistance: $("live-distance"),
  liveDuration: $("live-duration"),
  liveCurrentPace: $("live-current-pace"),
  livePace: $("live-pace"),
  liveCompletedDistance: $("live-completed-distance"),
  liveSplits: $("live-splits"),
  liveRoute: $("live-route"),
  signalMessage: $("signal-message"),
  signalText: $("signal-text"),
  pauseButton: $("pause-button"),
  endButton: $("end-button"),
  dialog: $("app-dialog"),
  dialogIcon: $("dialog-icon"),
  dialogTitle: $("dialog-title"),
  dialogMessage: $("dialog-message"),
  dialogActions: $("dialog-actions"),
  importDialog: $("import-dialog"),
  importSummary: $("import-summary"),
  importSettingsCheckbox: $("import-settings-checkbox"),
  importConfirmButton: $("import-confirm-button"),
  importCancelButton: $("import-cancel-button"),
  toast: $("toast"),
};

const state = {
  runs: [],
  settings: normalizeSettings(DEFAULT_SETTINGS),
  currentView: "home",
  settingsReturnView: "home",
  recordReturnView: "history",
  currentRecordId: null,
  activeRun: null,
  liveSplits: [],
  watchId: null,
  timerId: null,
  wakeLock: null,
  wakeLockUnavailable: false,
  dialogResolver: null,
  pendingImport: null,
  toastTimer: null,
  lastPersistedAt: 0,
  hiddenAt: 0,
  permissionDialogShown: false,
  signalMode: "",
};

const shortDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
});

const weekdayFormatter = new Intl.DateTimeFormat("zh-CN", {
  weekday: "short",
});

const longDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
});

const recordDayFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

function createId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createIcon(name, className = "icon") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${name}`);
  svg.append(use);
  return svg;
}

function formatRunTitle(run) {
  const hour = new Date(run.startedAt).getHours();
  if (hour < 11) {
    return "晨间跑步";
  }
  if (hour < 17) {
    return "日间跑步";
  }
  return "夜间跑步";
}

function currentElapsedMilliseconds() {
  const active = state.activeRun;
  if (!active) {
    return 0;
  }
  const stored = Math.max(0, Number(active.elapsedMilliseconds) || 0);
  if (active.status === "running" && active.resumeStartedAt) {
    return stored + Math.max(0, Date.now() - active.resumeStartedAt);
  }
  return stored;
}

function renderHome() {
  const now = new Date();
  const stats = weeklyStats(state.runs, now);
  const goal = goalProgress(stats, state.settings);
  const streak = consecutiveCompletedWeeks(state.runs, state.settings, now);
  const total = totalStats(state.runs);

  elements.todayLabel.textContent = `${shortDateFormatter.format(now)} ${weekdayFormatter.format(now)}`;
  elements.weekRange.textContent = weekRangeLabel(now);
  elements.weekDistance.textContent = formatDistance(stats.distanceMeters);
  elements.weekDistanceTarget.textContent = `/ ${goal.distanceGoalMeters / 1000} km`;
  elements.weekDistanceProgress.setAttribute(
    "aria-valuemax",
    String(goal.distanceGoalMeters / 1000),
  );
  elements.weekDistanceProgress.setAttribute(
    "aria-valuenow",
    String(stats.distanceMeters / 1000),
  );
  elements.weekDistanceBar.style.width = `${goal.distanceRatio * 100}%`;
  elements.weekCount.textContent = String(stats.count);
  elements.weekCountTarget.textContent = ` / ${goal.countGoal} 次`;
  elements.weekDuration.textContent = formatDurationCompact(stats.durationMilliseconds);
  elements.goalStreak.textContent = String(streak);

  if (goal.complete) {
    elements.weekGoalRemaining.textContent = "本周双目标已完成";
    elements.weekGoalRemaining.classList.add("is-complete");
  } else {
    elements.weekGoalRemaining.classList.remove("is-complete");
    const remaining = [];
    if (!goal.distanceComplete) {
      remaining.push(`还差 ${formatDistance(goal.remainingDistanceMeters, 1)} km`);
    }
    if (!goal.countComplete) {
      remaining.push(`${goal.remainingCount} 次跑步`);
    }
    elements.weekGoalRemaining.textContent = `本周${remaining.join(" · ")}`;
  }

  elements.weekCountDots.replaceChildren();
  for (let index = 0; index < goal.countGoal; index += 1) {
    const dot = document.createElement("span");
    dot.className = index < stats.count ? "goal-dot is-filled" : "goal-dot";
    elements.weekCountDots.append(dot);
  }

  elements.latestRun.replaceChildren();
  if (state.runs.length === 0) {
    elements.latestRun.append(
      createEmptyState("还没有跑步记录", "完成第一次跑步后，记录会出现在这里。"),
    );
  } else {
    elements.latestRun.append(createRunRow(state.runs[0], { compact: true }));
  }

  elements.homeWeekNote.replaceChildren();
  const paceMetric = document.createElement("div");
  const paceLabel = document.createElement("span");
  paceLabel.className = "meta-label";
  paceLabel.textContent = "本周平均配速";
  const paceValue = document.createElement("strong");
  paceValue.textContent = formatPace(stats.paceSeconds);
  paceMetric.append(paceLabel, paceValue);

  const totalMetric = document.createElement("div");
  totalMetric.className = "week-note-total";
  const totalLabel = document.createElement("span");
  totalLabel.className = "meta-label";
  totalLabel.textContent = "累计";
  const totalValue = document.createElement("strong");
  totalValue.textContent = `${formatDistance(total.distanceMeters, 1)} km`;
  const totalCount = document.createElement("small");
  totalCount.textContent = `${total.count} 次`;
  totalMetric.append(totalLabel, totalValue, totalCount);
  elements.homeWeekNote.append(paceMetric, totalMetric);
}

function createEmptyState(title, description) {
  const container = document.createElement("div");
  container.className = "empty-block";

  const icon = document.createElement("span");
  icon.className = "empty-icon";
  icon.append(createIcon("i-route"));

  const heading = document.createElement("h3");
  heading.textContent = title;
  const text = document.createElement("p");
  text.textContent = description;
  container.append(icon, heading, text);
  return container;
}

function createRunRow(run, options = {}) {
  const { compact = false } = options;
  const button = document.createElement("button");
  button.className = compact ? "recent-item" : "history-button";
  button.type = "button";
  button.dataset.runId = run.id;
  const started = new Date(run.startedAt);
  button.setAttribute(
    "aria-label",
    `${longDateFormatter.format(started)}，${formatDistance(run.distanceMeters)} 公里`,
  );

  if (compact) {
    const main = document.createElement("span");
    const date = document.createElement("span");
    date.className = "run-item-date";
    date.textContent = `${shortDateFormatter.format(started)} ${weekdayFormatter.format(started)}`;
    const metrics = document.createElement("span");
    metrics.className = "run-item-metrics";
    const distance = document.createElement("strong");
    distance.className = "run-item-distance";
    distance.textContent = formatDistance(run.distanceMeters);
    const unit = document.createElement("span");
    unit.className = "run-item-unit";
    unit.textContent = "km";
    metrics.append(distance, unit);
    main.append(date, metrics);

    const details = document.createElement("span");
    details.className = "run-item-details";
    details.append(
      document.createTextNode(formatDuration(runDurationMilliseconds(run))),
      document.createElement("br"),
      document.createTextNode(`${formatPace(runPaceSeconds(run))} /km`),
    );
    button.append(main, details);
    return button;
  }

  const tile = document.createElement("span");
  tile.className = "date-tile";
  const day = document.createElement("strong");
  day.textContent = String(started.getDate()).padStart(2, "0");
  const weekday = document.createElement("span");
  weekday.textContent = weekdayFormatter.format(started);
  tile.append(day, weekday);

  const main = document.createElement("span");
  main.className = "history-main";
  const distance = document.createElement("strong");
  distance.textContent = `${formatDistance(run.distanceMeters)} km`;
  const details = document.createElement("span");
  details.textContent = `${formatDuration(runDurationMilliseconds(run))} · ${formatPace(runPaceSeconds(run))} /km`;
  main.append(distance, details);

  const arrow = document.createElement("span");
  arrow.className = "history-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.append(createIcon("i-chevron-right"));
  button.append(tile, main, arrow);
  return button;
}

function renderHistory() {
  const total = totalStats(state.runs);
  elements.totalDistance.textContent = `${formatDistance(total.distanceMeters)} km`;
  elements.totalCount.textContent = `${total.count} 次`;
  elements.historyList.replaceChildren();

  if (state.runs.length === 0) {
    elements.historyList.append(
      createEmptyState("还没有记录", "完成一次 GPS 跑步后，路线和数据会出现在这里。"),
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const group of groupRunsByMonth(state.runs)) {
    const section = document.createElement("section");
    section.className = "history-group";
    const heading = document.createElement("header");
    heading.className = "history-group-heading";
    const title = document.createElement("h2");
    title.textContent = group.label;
    const summary = document.createElement("span");
    summary.textContent = `${group.count} 次 · ${formatDistance(group.distanceMeters)} km`;
    heading.append(title, summary);
    section.append(heading);
    for (const run of group.runs) {
      section.append(createRunRow(run));
    }
    fragment.append(section);
  }
  elements.historyList.append(fragment);
}

function renderTrends() {
  const now = new Date();
  const stats = weeklyStats(state.runs, now);
  const goal = goalProgress(stats, state.settings);
  const month = monthStats(state.runs, now);
  const streak = consecutiveCompletedWeeks(state.runs, state.settings, now);
  const records = personalRecords(state.runs);

  elements.trendWeekRange.textContent = weekRangeLabel(now);
  elements.trendWeekDistance.textContent = `${formatDistance(stats.distanceMeters, 1)} / ${goal.distanceGoalMeters / 1000} km`;
  elements.trendWeekCount.textContent = `${stats.count} / ${goal.countGoal} 次`;
  elements.trendDistanceBar.style.width = `${goal.distanceRatio * 100}%`;
  elements.trendCountBar.style.width = `${goal.countRatio * 100}%`;
  elements.monthDistance.textContent = `${formatDistance(month.distanceMeters)} km`;
  elements.trendStreak.textContent = `${streak} 周`;

  renderWeeklyChart(
    elements.weeklyChart,
    buildWeeklyBuckets(state.runs, now),
    state.settings.weeklyDistanceGoalKm,
  );

  elements.personalRecords.replaceChildren();
  const rows = [
    {
      icon: "i-trophy",
      label: "最远距离",
      value: records.longest ? `${formatDistance(records.longest.value)} km` : "—",
      detail: records.longest
        ? recordDayFormatter.format(new Date(records.longest.run.startedAt))
        : "完成第一次跑步后生成",
    },
    {
      icon: "i-navigation",
      label: "最佳平均配速",
      value: records.bestAveragePace
        ? `${formatPace(records.bestAveragePace.value)} /km`
        : "—",
      detail: records.bestAveragePace
        ? recordDayFormatter.format(new Date(records.bestAveragePace.run.startedAt))
        : "至少完成 1 km 后生成",
    },
    {
      icon: "i-target",
      label: "最快完整公里",
      value: records.fastestKilometer
        ? `${formatPace(records.fastestKilometer.value)} /km`
        : "—",
      detail: records.fastestKilometer
        ? `第 ${records.fastestKilometer.split.index} 公里`
        : "新记录完成 1 km 分段后生成",
    },
  ];

  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "record-item";
    const icon = document.createElement("span");
    icon.className = "record-icon";
    icon.append(createIcon(row.icon));
    const copy = document.createElement("span");
    copy.className = "record-copy";
    const label = document.createElement("span");
    label.textContent = row.label;
    const detail = document.createElement("small");
    detail.textContent = row.detail;
    copy.append(label, detail);
    const value = document.createElement("strong");
    value.textContent = row.value;
    item.append(icon, copy, value);
    elements.personalRecords.append(item);
  }
}

function renderRecord(run) {
  if (!run) {
    return;
  }
  const durationMilliseconds = runDurationMilliseconds(run);
  const fastestSplit = fastestFullSplit(run);
  const splits = Array.isArray(run.splits) ? run.splits : [];
  state.currentRecordId = run.id;

  elements.recordDate.textContent = longDateFormatter.format(new Date(run.startedAt));
  elements.recordTitle.textContent = formatRunTitle(run);
  elements.recordDistance.textContent = formatDistance(run.distanceMeters);
  elements.recordDuration.textContent = formatDuration(durationMilliseconds);
  elements.recordPace.textContent = formatPace(runPaceSeconds(run));
  elements.recordFastestSplit.textContent = fastestSplit
    ? formatPace(fastestSplit.paceSecondsPerKilometer)
    : "--'--\"";
  elements.splitCaption.textContent =
    splits.length > 0 ? `${splits.filter((split) => split.distanceMeters >= 999).length} 个完整公里` : "";
  renderRouteSvg(elements.recordRoute, run.route || []);
  renderSplitChart(elements.splitChart, splits);

  elements.splitList.replaceChildren();
  if (splits.length > 0) {
    const partial = splits.at(-1);
    if (partial && partial.distanceMeters < 999) {
      const note = document.createElement("span");
      note.className = "partial-split-note";
      note.textContent = `最后一段 ${formatDistance(partial.distanceMeters)} km · ${formatPace(partial.paceSecondsPerKilometer)} /km`;
      elements.splitList.append(note);
    }
  }

  if (Array.isArray(run.route) && run.route.length >= 2) {
    elements.recordNote.textContent = "数据与轨迹仅保存在当前设备，建议在设置中定期导出备份。";
  } else {
    elements.recordNote.textContent = "本次没有记录到可用轨迹，距离与配速数据可能不完整。";
  }
}

async function renderSettings() {
  elements.weeklyDistanceGoal.value = String(
    state.settings.weeklyDistanceGoalKm,
  );
  elements.weeklyCountGoal.value = String(state.settings.weeklyCountGoal);
  elements.appVersion.textContent = `v${APP_VERSION}`;
  await renderStorageInfo();
}

async function renderStorageInfo() {
  elements.storageState.textContent = "本机保存";
  elements.storageUsage.textContent = "正在读取本地存储信息…";
  try {
    const persisted = await navigator.storage?.persisted?.();
    if (persisted) {
      elements.storageState.textContent = "已持久化";
    }
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.usage != null) {
      const usageMb = estimate.usage / 1024 / 1024;
      const quotaGb = Number(estimate.quota) / 1024 / 1024 / 1024;
      elements.storageUsage.textContent =
        `本地数据约 ${usageMb < 0.1 ? "< 0.1" : usageMb.toFixed(1)} MB` +
        (Number.isFinite(quotaGb) && quotaGb > 0
          ? ` · 浏览器可用空间约 ${quotaGb.toFixed(1)} GB`
          : "");
    } else {
      elements.storageUsage.textContent = "浏览器未提供存储空间信息。";
    }
  } catch (error) {
    console.warn(error);
    elements.storageUsage.textContent = "无法读取本地存储信息。";
  }
}

function renderAll() {
  renderHome();
  renderHistory();
  renderTrends();
  if (state.currentView === "settings") {
    void renderSettings();
  }
}

function navigateTo(viewName) {
  if (!elements.views[viewName]) {
    return;
  }
  state.currentView = viewName;
  for (const [name, view] of Object.entries(elements.views)) {
    view.classList.toggle("is-active", name === viewName);
  }
  const isDetailView = viewName === "record" || viewName === "settings";
  elements.topbar.hidden = isDetailView;
  elements.tabbar.hidden = isDetailView;

  for (const tab of elements.tabbar.querySelectorAll("[data-tab]")) {
    const active = tab.dataset.tab === viewName;
    tab.classList.toggle("is-active", active);
    if (active) {
      tab.setAttribute("aria-current", "page");
    } else {
      tab.removeAttribute("aria-current");
    }
  }
  window.scrollTo({ top: 0 });
}

function openRecord(run, returnView = "history") {
  if (!run) {
    showToast("没有找到这条跑步记录。");
    return;
  }
  state.recordReturnView = returnView;
  renderRecord(run);
  navigateTo("record");
}

function openSettings() {
  state.settingsReturnView =
    state.currentView === "record" || state.currentView === "settings"
      ? "home"
      : state.currentView;
  navigateTo("settings");
  void renderSettings();
}

async function loadData() {
  try {
    const [runs, settings] = await Promise.all([getAllRuns(), getSettings()]);
    state.runs = runs;
    state.settings = settings;
  } catch (error) {
    console.error(error);
    state.runs = [];
    state.settings = normalizeSettings(DEFAULT_SETTINGS);
    showToast("无法读取本地数据。");
  }
  renderAll();
}

function buildNewActiveRun() {
  const now = Date.now();
  return {
    id: createId(),
    startedAt: null,
    endedAt: null,
    status: "locating",
    elapsedMilliseconds: 0,
    resumeStartedAt: null,
    segmentStart: false,
    distanceMeters: 0,
    route: [],
    lastSeenAt: now,
    lastAcceptedAt: null,
    lastAccuracy: null,
    createdAt: now,
  };
}

async function handleStartRun() {
  if (state.activeRun) {
    showToast("已有一段正在记录的跑步。");
    return;
  }
  if (!window.isSecureContext) {
    await showDialog({
      title: "需要通过安全地址打开",
      message:
        "iPhone 定位只能在 HTTPS 地址下使用。请从已部署的 HTTPS 地址打开轻跑。",
      icon: true,
      actions: [{ label: "我知道了", value: "ok" }],
    });
    return;
  }
  if (!("geolocation" in navigator)) {
    await showDialog({
      title: "无法使用定位",
      message: "当前浏览器不支持定位功能，请使用最新版 Safari。",
      icon: true,
      actions: [{ label: "我知道了", value: "ok" }],
    });
    return;
  }

  state.permissionDialogShown = false;
  state.liveSplits = [];
  state.activeRun = buildNewActiveRun();
  showRunScreen();
  renderLiveRun();
  setSignal("locating", "正在定位", "正在获取准确位置，请稍候。");
  await persistActiveRun();
  startLocationWatch();
  startLiveTimer();
}

function showRunScreen() {
  elements.runView.hidden = false;
  elements.appShell.inert = true;
  document.body.style.overflow = "hidden";
  elements.runView.scrollTop = 0;
}

function hideRunScreen() {
  elements.runView.hidden = true;
  elements.appShell.inert = false;
  document.body.style.overflow = "";
}

function startLocationWatch() {
  if (state.watchId !== null || !state.activeRun) {
    return;
  }
  state.watchId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15_000,
  });
}

function stopLocationWatch() {
  if (state.watchId === null) {
    return;
  }
  navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
}

function handlePosition(position) {
  const active = state.activeRun;
  if (!active) {
    return;
  }

  const point = pointFromPosition(position);
  point.elapsedMilliseconds = currentElapsedMilliseconds();
  active.lastSeenAt = Date.now();

  if (!isUsablePoint(point)) {
    setSignal(
      "warning",
      "信号较弱",
      Number.isFinite(point.accuracyMeters)
        ? `当前定位精度约 ${Math.round(point.accuracyMeters)} 米，请移动到开阔区域。`
        : "暂时无法获得可靠位置，正在等待新的定位点。",
    );
    renderLiveMetrics();
    return;
  }

  active.lastAccuracy = point.accuracyMeters;
  if (active.status === "paused") {
    setSignal("paused", "记录已暂停", "继续后将重新接入定位并累计数据。");
    renderLiveMetrics();
    return;
  }

  if (active.status === "locating") {
    active.status = "running";
    active.startedAt = Date.now();
    active.resumeStartedAt = Date.now();
    point.elapsedMilliseconds = 0;
    active.route.push(point);
    active.lastAcceptedAt = Date.now();
    void requestWakeLock();
  } else if (active.segmentStart) {
    point.segmentStart = true;
    active.route.push(point);
    active.lastAcceptedAt = Date.now();
    active.segmentStart = false;
  } else {
    const previousPoint = active.route.at(-1);
    const result = evaluateRoutePoint(previousPoint, point);
    if (result.accepted) {
      if (result.reason === "gap") {
        point.segmentStart = true;
      }
      active.route.push(point);
      active.distanceMeters += result.distanceMeters;
      active.lastAcceptedAt = Date.now();
    }
  }

  state.liveSplits = buildKilometerSplits(active.route);
  setSignal(
    "good",
    "GPS 已连接",
    `定位精度约 ${Math.round(point.accuracyMeters)} 米，保持页面在前台可减少记录中断。`,
  );
  elements.pauseButton.disabled = false;
  elements.endButton.disabled = false;
  renderLiveRun();
  void persistActiveRun();
}

function handlePositionError(error) {
  if (!state.activeRun) {
    return;
  }
  if (error.code === 1) {
    setSignal(
      "warning",
      "定位未开启",
      "请在 iPhone 设置中允许 Safari 使用精确位置，然后重新开始跑步。",
    );
    if (!state.permissionDialogShown) {
      state.permissionDialogShown = true;
      void showDialog({
        title: "需要定位权限",
        message:
          "请在 iPhone 的“设置 > 隐私与安全性 > 定位服务”中允许 Safari 网站使用精确位置。",
        icon: true,
        actions: [
          { label: "我知道了", value: "ok" },
          { label: "返回首页", value: "home", style: "secondary" },
        ],
      }).then((choice) => {
        if (choice === "home") {
          void abandonUnstartedRun();
        }
      });
    }
    return;
  }
  if (error.code === 3) {
    setSignal("locating", "仍在定位", "暂时没有获得位置，请移动到开阔区域继续等待。");
  } else {
    setSignal("warning", "定位不可用", "当前无法获取位置，请稍后重试。");
  }
  renderLiveMetrics();
}

function startLiveTimer() {
  stopLiveTimer();
  state.timerId = window.setInterval(() => {
    if (!state.activeRun) {
      return;
    }
    renderLiveMetrics();
    if (
      state.activeRun.status === "running" &&
      Date.now() - (state.activeRun.lastSeenAt || 0) > 15_000 &&
      state.signalMode !== "warning"
    ) {
      setSignal("warning", "定位中断", "已超过 15 秒没有新位置，距离将暂缓累计。");
    }
    if (Date.now() - state.lastPersistedAt > 1_000) {
      void persistActiveRun();
    }
  }, 250);
}

function stopLiveTimer() {
  if (state.timerId !== null) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function renderLiveRun() {
  renderLiveMetrics();
  renderLiveRoute();
  renderLiveSplits();
  const active = state.activeRun;
  if (!active) {
    return;
  }
  const isPaused = active.status === "paused";
  const isLocating = active.status === "locating";
  elements.runKicker.textContent = isLocating ? "准备出发" : isPaused ? "暂时停下" : "轻跑";
  elements.runTitle.textContent = isLocating ? "寻找信号" : isPaused ? "已暂停" : "跑步中";
  elements.pauseButton.disabled = isLocating;
  elements.endButton.disabled = false;
  elements.pauseButton.classList.toggle("is-resume", isPaused);
  const pauseUse = elements.pauseButton.querySelector("use");
  pauseUse.setAttribute("href", isPaused ? "#i-play" : "#i-pause");
  elements.pauseButton.querySelector("span").textContent = isPaused ? "继续" : "暂停";
}

function renderLiveMetrics() {
  const active = state.activeRun;
  if (!active) {
    return;
  }
  const elapsed = currentElapsedMilliseconds();
  elements.liveDistance.textContent = formatDistance(active.distanceMeters);
  elements.liveDuration.textContent = formatDuration(elapsed);
  elements.liveCurrentPace.textContent = formatPace(
    rollingPaceSeconds(active.route),
  );
  elements.livePace.textContent = formatPace(
    calculatePaceSeconds(active.distanceMeters, elapsed),
  );
  elements.liveCompletedDistance.textContent =
    `${Math.floor(active.distanceMeters / 1000)} km`;
}

function renderLiveRoute() {
  const active = state.activeRun;
  if (!active) {
    return;
  }
  renderRouteSvg(elements.liveRoute, active.route || [], {
    live: true,
    height: 138,
    emptyMessage: "路线将在这里逐渐显现",
  });
}

function renderLiveSplits() {
  elements.liveSplits.replaceChildren();
  if (state.liveSplits.length === 0) {
    const empty = document.createElement("span");
    empty.className = "live-split-empty";
    empty.textContent = "完成 1 km 后显示分段";
    elements.liveSplits.append(empty);
    return;
  }

  for (const split of state.liveSplits.slice(-4)) {
    const chip = document.createElement("span");
    chip.className = "live-split-chip";
    const label = document.createElement("small");
    label.textContent =
      split.distanceMeters >= 999 ? `${split.index} km` : `${formatDistance(split.distanceMeters)} km`;
    const pace = document.createElement("strong");
    pace.textContent = formatPace(split.paceSecondsPerKilometer);
    chip.append(label, pace);
    elements.liveSplits.append(chip);
  }
}

function setSignal(mode, label, message) {
  state.signalMode = mode;
  elements.gpsBadge.classList.toggle("is-live", mode === "good");
  elements.gpsBadge.classList.toggle("is-warning", mode === "warning");
  elements.gpsLabel.textContent = label;
  elements.signalMessage.classList.toggle("is-good", mode === "good");
  elements.signalMessage.classList.toggle("is-warning", mode === "warning");
  elements.signalText.textContent = message;
}

async function handlePauseToggle() {
  const active = state.activeRun;
  if (!active || active.status === "locating") {
    return;
  }
  if (active.status === "running") {
    active.elapsedMilliseconds = currentElapsedMilliseconds();
    active.resumeStartedAt = null;
    active.status = "paused";
    active.segmentStart = true;
    setSignal("paused", "记录已暂停", "继续后将重新接入定位并累计数据。");
    releaseWakeLock();
  } else {
    active.resumeStartedAt = Date.now();
    active.lastSeenAt = Date.now();
    active.status = "running";
    active.segmentStart = true;
    startLocationWatch();
    setSignal("locating", "正在恢复", "正在等待新的定位点。");
    void requestWakeLock();
  }
  renderLiveRun();
  await persistActiveRun();
}

async function handleEndRun() {
  const active = state.activeRun;
  if (!active) {
    return;
  }
  if (active.status === "locating") {
    const choice = await showDialog({
      title: "还没有开始记录",
      message: "仍在等待第一个准确位置。离开后，本次未开始的跑步不会保存。",
      icon: true,
      actions: [
        { label: "继续等待", value: "wait" },
        { label: "离开", value: "leave", style: "secondary" },
      ],
    });
    if (choice === "leave") {
      await abandonUnstartedRun();
    }
    return;
  }

  const choice = await showDialog({
    title: "结束这次跑步？",
    message: `${formatDistance(active.distanceMeters)} km · ${formatDuration(currentElapsedMilliseconds())}`,
    actions: [
      { label: "结束并保存", value: "save", style: "danger" },
      { label: "继续跑步", value: "continue", style: "secondary" },
    ],
  });
  if (choice === "save") {
    await finishRun();
  }
}

async function finishRun() {
  const active = state.activeRun;
  if (!active) {
    return;
  }
  if (active.status === "running") {
    active.elapsedMilliseconds = currentElapsedMilliseconds();
    active.resumeStartedAt = null;
    active.status = "paused";
  }
  const durationMilliseconds = currentElapsedMilliseconds();
  if (durationMilliseconds < 1000) {
    await clearRunSession();
    showToast("本次没有产生可保存的记录。");
    return;
  }

  const route = Array.isArray(active.route) ? active.route : [];
  const run = {
    id: active.id,
    startedAt: active.startedAt || Date.now() - durationMilliseconds,
    endedAt: Date.now(),
    durationSeconds: Math.max(1, Math.floor(durationMilliseconds / 1000)),
    distanceMeters: Math.max(0, Number(active.distanceMeters) || 0),
    avgPaceSecondsPerKm: calculatePaceSeconds(
      active.distanceMeters,
      durationMilliseconds,
    ),
    route,
    splits: buildKilometerSplits(route),
    schemaVersion: 2,
    createdAt: active.createdAt || Date.now(),
  };

  await stopRunTracking();
  try {
    await saveRun(run);
    await clearActiveRun();
  } catch (error) {
    console.error(error);
    active.status = "paused";
    state.activeRun = active;
    showRunScreen();
    void persistActiveRun();
    await showDialog({
      title: "保存失败",
      message: "本地存储暂时不可用，跑步数据仍保留在本次页面中。",
      icon: true,
      actions: [{ label: "我知道了", value: "ok" }],
    });
    return;
  }

  state.activeRun = null;
  state.liveSplits = [];
  hideRunScreen();
  await loadData();
  const savedRun = state.runs.find((item) => item.id === run.id) || run;
  openRecord(savedRun, "home");
  showToast("跑步已保存");
}

async function abandonUnstartedRun() {
  await clearRunSession();
  showToast("本次未保存");
}

async function clearRunSession() {
  await stopRunTracking();
  state.activeRun = null;
  state.liveSplits = [];
  hideRunScreen();
  try {
    await clearActiveRun();
  } catch (error) {
    console.error(error);
  }
}

async function stopRunTracking() {
  stopLocationWatch();
  stopLiveTimer();
  releaseWakeLock();
}

async function requestWakeLock() {
  if (
    state.wakeLock ||
    !state.activeRun ||
    state.activeRun.status !== "running" ||
    document.visibilityState !== "visible" ||
    !("wakeLock" in navigator) ||
    state.wakeLockUnavailable
  ) {
    return;
  }
  try {
    const nextLock = await navigator.wakeLock.request("screen");
    state.wakeLock = nextLock;
    nextLock.addEventListener(
      "release",
      () => {
        if (state.wakeLock === nextLock) {
          state.wakeLock = null;
        }
      },
      { once: true },
    );
  } catch (error) {
    state.wakeLockUnavailable = true;
    console.warn("屏幕常亮不可用", error);
  }
}

function releaseWakeLock() {
  const currentLock = state.wakeLock;
  state.wakeLock = null;
  currentLock?.release().catch((error) => console.warn(error));
}

async function persistActiveRun() {
  if (!state.activeRun) {
    return;
  }
  state.lastPersistedAt = Date.now();
  try {
    await saveActiveRun({
      ...state.activeRun,
      elapsedMilliseconds: currentElapsedMilliseconds(),
      resumeStartedAt: null,
    });
  } catch (error) {
    console.error("无法保存活动跑步", error);
  }
}

async function restoreActiveRunIfNeeded() {
  let restored;
  try {
    restored = await getActiveRun();
  } catch (error) {
    console.error(error);
    return;
  }
  if (!restored) {
    return;
  }

  const storedElapsed = Math.max(0, Number(restored.elapsedMilliseconds) || 0);
  if (restored.status === "running" && restored.resumeStartedAt) {
    const persistedAt = Number(restored.updatedAt) || Date.now();
    restored.elapsedMilliseconds =
      storedElapsed + Math.max(0, persistedAt - Number(restored.resumeStartedAt));
  }
  restored.resumeStartedAt = null;
  restored.segmentStart = true;
  restored.status = restored.status === "running" ? "paused" : restored.status;

  if (!restored.startedAt || restored.elapsedMilliseconds < 1000) {
    await clearActiveRun();
    return;
  }

  const choice = await showDialog({
    title: "发现未结束的跑步",
    message: `${formatDistance(restored.distanceMeters)} km · ${formatDuration(restored.elapsedMilliseconds)}\n应用关闭后定位没有继续记录。`,
    icon: true,
    actions: [
      { label: "继续记录", value: "continue" },
      { label: "结束并保存", value: "save", style: "secondary" },
    ],
  });

  state.activeRun = restored;
  state.liveSplits = buildKilometerSplits(restored.route || []);
  if (choice === "continue") {
    showRunScreen();
    restored.resumeStartedAt = Date.now();
    restored.lastSeenAt = Date.now();
    restored.status = "running";
    renderLiveRun();
    setSignal("locating", "正在恢复", "正在重新接入定位。");
    startLocationWatch();
    startLiveTimer();
    void requestWakeLock();
    await persistActiveRun();
    return;
  }
  if (choice === "save") {
    await finishRun();
  } else {
    state.activeRun = null;
    state.liveSplits = [];
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2400);
}

function showDialog({ title, message, actions, icon = false }) {
  if (state.dialogResolver) {
    elements.dialog.close("dismissed");
  }
  elements.dialogTitle.textContent = title;
  elements.dialogMessage.textContent = message;
  elements.dialogIcon.classList.toggle("is-visible", Boolean(icon));
  elements.dialogActions.replaceChildren();

  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    if (action.style === "secondary") {
      button.classList.add("is-secondary");
    }
    if (action.style === "danger") {
      button.classList.add("is-danger");
    }
    button.addEventListener("click", () => elements.dialog.close(action.value));
    elements.dialogActions.append(button);
  }

  return new Promise((resolve) => {
    state.dialogResolver = resolve;
    elements.dialog.returnValue = "";
    elements.dialog.showModal();
  });
}

async function handleGoalSubmit(event) {
  event.preventDefault();
  if (!elements.goalSettingsForm.reportValidity()) {
    return;
  }
  const nextSettings = normalizeSettings(
    {
      ...state.settings,
      weeklyDistanceGoalKm: Number(elements.weeklyDistanceGoal.value),
      weeklyCountGoal: Number(elements.weeklyCountGoal.value),
    },
    Date.now(),
  );
  try {
    state.settings = await saveSettings(nextSettings);
    renderAll();
    showToast("每周目标已保存");
  } catch (error) {
    console.error(error);
    await showDialog({
      title: "保存失败",
      message: "无法写入本地目标设置，请稍后重试。",
      icon: true,
      actions: [{ label: "我知道了", value: "ok" }],
    });
  }
}

function backupFileName() {
  const date = new Date();
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return `qingpao-backup-${datePart}.json`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleExportBackup() {
  const backup = createBackup(state.runs, state.settings);
  const filename = backupFileName();
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const file = new File([blob], filename, { type: "application/json" });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        title: "轻跑数据备份",
        files: [file],
      });
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
    }
  }
  downloadBlob(blob, filename);
  showToast("备份文件已生成");
}

async function handleBackupFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    const backup = parseBackup(text);
    const preview = mergeBackupRuns(backup, state.runs);
    state.pendingImport = { backup, preview };

    const summaryParts = [
      `可导入 ${preview.newRuns.length} 条记录`,
      preview.duplicateCount > 0 ? `跳过 ${preview.duplicateCount} 条重复记录` : null,
      preview.invalidCount > 0 ? `忽略 ${preview.invalidCount} 条无效记录` : null,
    ].filter(Boolean);
    elements.importSummary.textContent = summaryParts.join("，") + "。";
    elements.importSettingsCheckbox.checked = backup.hasSettings;
    elements.importSettingsCheckbox.disabled = !backup.hasSettings;
    elements.importConfirmButton.disabled =
      preview.newRuns.length === 0 && !backup.hasSettings;
    elements.importDialog.showModal();
  } catch (error) {
    await showDialog({
      title: "无法导入备份",
      message: error.message || "备份文件读取失败。",
      icon: true,
      actions: [{ label: "我知道了", value: "ok" }],
    });
  }
}

async function confirmBackupImport() {
  const pending = state.pendingImport;
  if (!pending) {
    elements.importDialog.close();
    return;
  }
  const restoreSettings =
    elements.importSettingsCheckbox.checked &&
    pending.backup.hasSettings &&
    !elements.importSettingsCheckbox.disabled;
  if (pending.preview.newRuns.length === 0 && !restoreSettings) {
    state.pendingImport = null;
    elements.importDialog.close();
    showToast("没有可导入的数据");
    return;
  }
  try {
    if (pending.preview.newRuns.length > 0) {
      await saveRuns(pending.preview.newRuns);
    }
    if (restoreSettings) {
      state.settings = await saveSettings(pending.backup.settings);
    }
    state.pendingImport = null;
    elements.importDialog.close();
    await loadData();
    showToast(
      pending.preview.newRuns.length > 0
        ? `已导入 ${pending.preview.newRuns.length} 条记录`
        : "每周目标已恢复",
    );
  } catch (error) {
    console.error(error);
    elements.importDialog.close();
    await showDialog({
      title: "导入失败",
      message: "无法写入本地数据库，请确认存储空间充足后重试。",
      icon: true,
      actions: [{ label: "我知道了", value: "ok" }],
    });
  }
}

async function handleDeleteRun() {
  const run = state.runs.find((item) => item.id === state.currentRecordId);
  if (!run) {
    showToast("没有找到这条跑步记录。");
    return;
  }
  const choice = await showDialog({
    title: "删除这次跑步？",
    message: `${longDateFormatter.format(new Date(run.startedAt))}\n${formatDistance(run.distanceMeters)} km · ${formatDuration(runDurationMilliseconds(run))}\n删除后无法恢复。`,
    icon: true,
    actions: [
      { label: "确认删除", value: "delete", style: "danger" },
      { label: "取消", value: "cancel", style: "secondary" },
    ],
  });
  if (choice !== "delete") {
    return;
  }
  try {
    await deleteRun(run.id);
    state.currentRecordId = null;
    await loadData();
    navigateTo(state.recordReturnView);
    showToast("跑步记录已删除");
  } catch (error) {
    console.error(error);
    showToast("删除失败，请稍后重试。");
  }
}

function bindEvents() {
  elements.startButton.addEventListener("click", handleStartRun);
  elements.pauseButton.addEventListener("click", handlePauseToggle);
  elements.endButton.addEventListener("click", handleEndRun);
  elements.settingsButton.addEventListener("click", openSettings);
  elements.settingsBackButton.addEventListener("click", () => {
    navigateTo(state.settingsReturnView);
  });
  elements.recordBackButton.addEventListener("click", () => {
    navigateTo(state.recordReturnView);
  });
  elements.deleteRunButton.addEventListener("click", handleDeleteRun);
  elements.goalSettingsForm.addEventListener("submit", handleGoalSubmit);
  elements.exportBackupButton.addEventListener("click", handleExportBackup);
  elements.importBackupButton.addEventListener("click", () => {
    elements.backupFileInput.click();
  });
  elements.backupFileInput.addEventListener("change", handleBackupFile);
  elements.importConfirmButton.addEventListener("click", confirmBackupImport);
  elements.importSettingsCheckbox.addEventListener("change", () => {
    const pending = state.pendingImport;
    elements.importConfirmButton.disabled =
      !pending ||
      (pending.preview.newRuns.length === 0 &&
        (!elements.importSettingsCheckbox.checked || !pending.backup.hasSettings));
  });
  elements.importCancelButton.addEventListener("click", () => {
    state.pendingImport = null;
    elements.importDialog.close();
  });

  for (const tab of elements.tabbar.querySelectorAll("[data-tab]")) {
    tab.addEventListener("click", () => {
      const viewName = tab.dataset.tab;
      if (viewName === "history") {
        renderHistory();
      } else if (viewName === "trends") {
        renderTrends();
      } else {
        renderHome();
      }
      navigateTo(viewName);
    });
  }

  document.querySelectorAll("[data-go-history]").forEach((button) => {
    button.addEventListener("click", () => {
      renderHistory();
      navigateTo("history");
    });
  });

  elements.latestRun.addEventListener("click", (event) => {
    const button = event.target.closest("[data-run-id]");
    if (!button) {
      return;
    }
    const run = state.runs.find((item) => item.id === button.dataset.runId);
    openRecord(run, "home");
  });

  elements.historyList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-run-id]");
    if (!button) {
      return;
    }
    const run = state.runs.find((item) => item.id === button.dataset.runId);
    openRecord(run, "history");
  });

  elements.dialog.addEventListener("close", () => {
    const resolver = state.dialogResolver;
    state.dialogResolver = null;
    resolver?.(elements.dialog.returnValue || "dismissed");
  });
  elements.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    elements.dialog.close("dismissed");
  });
  elements.importDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    state.pendingImport = null;
    elements.importDialog.close();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      state.hiddenAt = Date.now();
      void persistActiveRun();
      return;
    }
    if (!state.activeRun) {
      return;
    }
    if (state.activeRun.status === "running") {
      void requestWakeLock();
      startLocationWatch();
      if (state.hiddenAt > 0) {
        setSignal(
          "warning",
          "后台中断提示",
          "页面进入过后台，期间可能没有定位。已重新尝试连接。",
        );
      }
      renderLiveRun();
    }
    state.hiddenAt = 0;
  });

  window.addEventListener("pagehide", () => {
    void persistActiveRun();
  });
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    return;
  }
  try {
    await navigator.storage.persist();
  } catch (error) {
    console.warn("持久化存储申请失败", error);
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    return;
  }
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.warn("Service Worker 注册失败", error);
  });
}

async function init() {
  bindEvents();
  renderAll();
  registerServiceWorker();
  await loadData();
  await restoreActiveRunIfNeeded();
  void requestPersistentStorage();
}

init();
