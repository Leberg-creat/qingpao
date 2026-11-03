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
  clearActiveRun,
  getAllRuns,
  getActiveRun,
  saveActiveRun,
  saveRun,
} from "./db.js";
import { renderRouteSvg } from "./route-view.js";

const elements = {
  appShell: document.querySelector(".app-shell"),
  topbar: document.getElementById("topbar"),
  todayLabel: document.getElementById("today-label"),
  mainContent: document.getElementById("main-content"),
  tabbar: document.getElementById("tabbar"),
  homeView: document.getElementById("home-view"),
  historyView: document.getElementById("history-view"),
  recordView: document.getElementById("record-view"),
  weekDistance: document.getElementById("week-distance"),
  weekCount: document.getElementById("week-count"),
  weekDuration: document.getElementById("week-duration"),
  weekPace: document.getElementById("week-pace"),
  weekRange: document.getElementById("week-range"),
  latestRun: document.getElementById("latest-run"),
  totalDistance: document.getElementById("total-distance"),
  totalCount: document.getElementById("total-count"),
  historyList: document.getElementById("history-list"),
  startButton: document.getElementById("start-run-button"),
  recordBackButton: document.getElementById("record-back-button"),
  recordDate: document.getElementById("record-date"),
  recordDistance: document.getElementById("record-distance"),
  recordDuration: document.getElementById("record-duration"),
  recordPace: document.getElementById("record-pace"),
  recordRoute: document.getElementById("record-route"),
  recordNote: document.getElementById("record-note"),
  runView: document.getElementById("run-view"),
  runKicker: document.getElementById("run-kicker"),
  runTitle: document.getElementById("run-title"),
  gpsBadge: document.getElementById("gps-badge"),
  gpsLabel: document.getElementById("gps-label"),
  liveDistance: document.getElementById("live-distance"),
  liveDuration: document.getElementById("live-duration"),
  livePace: document.getElementById("live-pace"),
  liveRoute: document.getElementById("live-route"),
  signalMessage: document.getElementById("signal-message"),
  signalText: document.getElementById("signal-text"),
  pauseButton: document.getElementById("pause-button"),
  endButton: document.getElementById("end-button"),
  dialog: document.getElementById("app-dialog"),
  dialogIcon: document.getElementById("dialog-icon"),
  dialogTitle: document.getElementById("dialog-title"),
  dialogMessage: document.getElementById("dialog-message"),
  dialogActions: document.getElementById("dialog-actions"),
  toast: document.getElementById("toast"),
};

const state = {
  runs: [],
  currentView: "home",
  recordReturnView: "home",
  activeRun: null,
  watchId: null,
  timerId: null,
  wakeLock: null,
  wakeLockUnavailable: false,
  dialogResolver: null,
  toastTimer: null,
  lastPersistedAt: 0,
  hiddenAt: 0,
  permissionDialogShown: false,
  signalMode: "",
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
});

const weekdayFormatter = new Intl.DateTimeFormat("zh-CN", {
  weekday: "short",
});

const recordDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
});

function createId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function runDurationMilliseconds(run) {
  return Math.max(0, Number(run.durationSeconds) || 0) * 1000;
}

function runPace(run) {
  if (Number.isFinite(run.avgPaceSecondsPerKm)) {
    return run.avgPaceSecondsPerKm;
  }
  return calculatePaceSeconds(
    Number(run.distanceMeters) || 0,
    runDurationMilliseconds(run),
  );
}

function renderHome() {
  const stats = weeklyStats(state.runs);
  const total = totalStats(state.runs);
  elements.todayLabel.textContent = `${dateFormatter.format(new Date())} ${weekdayFormatter.format(new Date())}`;
  elements.weekRange.textContent = weekRangeLabel();
  elements.weekDistance.textContent = formatDistance(stats.distanceMeters);
  elements.weekCount.textContent = String(stats.count);
  elements.weekDuration.textContent = formatDurationCompact(stats.durationMilliseconds);
  elements.weekPace.textContent = formatPace(stats.paceSeconds);
  elements.totalDistance.textContent = `${formatDistance(total.distanceMeters)} km`;
  elements.totalCount.textContent = `${total.count} 次`;

  elements.latestRun.replaceChildren();
  if (state.runs.length === 0) {
    elements.latestRun.append(
      createEmptyState("还没有跑步记录", "完成第一次跑步后，记录会出现在这里。"),
    );
    return;
  }

  elements.latestRun.append(createLatestRunButton(state.runs[0]));
}

function createEmptyState(title, description) {
  const container = document.createElement("div");
  container.className = "empty-block";

  const icon = document.createElement("span");
  icon.className = "empty-icon";
  icon.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-route"></use></svg>';

  const heading = document.createElement("h3");
  heading.textContent = title;
  const text = document.createElement("p");
  text.textContent = description;
  container.append(icon, heading, text);
  return container;
}

function createLatestRunButton(run) {
  const button = document.createElement("button");
  button.className = "recent-item";
  button.type = "button";
  button.dataset.runId = run.id;

  const main = document.createElement("span");
  const date = document.createElement("span");
  date.className = "run-item-date";
  date.textContent = `${dateFormatter.format(new Date(run.startedAt))} ${weekdayFormatter.format(new Date(run.startedAt))}`;
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
    document.createTextNode(`${formatPace(runPace(run))} /km`),
  );

  button.append(main, details);
  return button;
}

function renderHistory() {
  elements.historyList.replaceChildren();
  if (state.runs.length === 0) {
    elements.historyList.append(
      createEmptyState("还没有历史记录", "你的跑步轨迹、距离和配速会保存在这台设备上。"),
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const run of state.runs) {
    const started = new Date(run.startedAt);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-button";
    button.dataset.runId = run.id;
    button.setAttribute(
      "aria-label",
      `${recordDateFormatter.format(started)}，${formatDistance(run.distanceMeters)} 公里`,
    );

    const tile = document.createElement("span");
    tile.className = "date-tile";
    const day = document.createElement("strong");
    day.textContent = String(started.getDate()).padStart(2, "0");
    const month = document.createElement("span");
    month.textContent = `${started.getMonth() + 1} 月`;
    tile.append(day, month);

    const main = document.createElement("span");
    main.className = "history-main";
    const distance = document.createElement("strong");
    distance.textContent = `${formatDistance(run.distanceMeters)} km`;
    const details = document.createElement("span");
    details.textContent = `${formatDuration(runDurationMilliseconds(run))} · ${formatPace(runPace(run))} /km`;
    main.append(distance, details);

    const arrow = document.createElement("span");
    arrow.className = "history-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";
    button.append(tile, main, arrow);
    fragment.append(button);
  }
  elements.historyList.append(fragment);
}

function renderRecord(run) {
  const durationMilliseconds = runDurationMilliseconds(run);
  elements.recordDate.textContent = recordDateFormatter.format(new Date(run.startedAt));
  elements.recordDistance.textContent = formatDistance(run.distanceMeters);
  elements.recordDuration.textContent = formatDuration(durationMilliseconds);
  elements.recordPace.textContent = formatPace(runPace(run));
  renderRouteSvg(elements.recordRoute, run.route || []);
  state.currentRecord = run;

  if (Array.isArray(run.route) && run.route.length >= 2) {
    elements.recordNote.textContent = "数据与轨迹仅保存在当前设备。";
  } else {
    elements.recordNote.textContent = "本次没有记录到可用轨迹，距离与配速数据可能不完整。";
  }
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

function navigateTo(viewName) {
  state.currentView = viewName;
  const isRecord = viewName === "record";
  elements.homeView.classList.toggle("is-active", viewName === "home");
  elements.historyView.classList.toggle("is-active", viewName === "history");
  elements.recordView.classList.toggle("is-active", isRecord);
  elements.topbar.hidden = isRecord;
  elements.tabbar.hidden = isRecord;

  for (const tab of elements.tabbar.querySelectorAll("[data-tab]")) {
    const active = tab.dataset.tab === viewName;
    tab.classList.toggle("is-active", active);
    if (active) {
      tab.setAttribute("aria-current", "page");
    } else {
      tab.removeAttribute("aria-current");
    }
  }

  window.scrollTo({ top: 0, behavior: "instant" });
}

async function loadRuns() {
  try {
    state.runs = await getAllRuns();
  } catch (error) {
    console.error(error);
    state.runs = [];
    showToast("无法读取本地跑步记录。");
  }
  renderHome();
  renderHistory();
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
        "iPhone 定位只能在 HTTPS 地址下使用。请将轻跑部署到 HTTPS 网站，或在本机 localhost 中测试。",
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
  active.lastSeenAt = Date.now();

  if (!isUsablePoint(point)) {
    setSignal(
      "warning",
      "信号较弱",
      Number.isFinite(point.accuracyMeters)
        ? `当前定位精度约 ${Math.round(point.accuracyMeters)} 米，请移动到开阔区域。`
        : "暂时无法获得可靠位置，正在等待新的定位点。",
    );
    renderLiveRun();
    return;
  }

  active.lastAccuracy = point.accuracyMeters;

  if (active.status === "paused") {
    setSignal("paused", "记录已暂停", "继续后将重新接入定位并累计数据。");
    renderLiveRun();
    return;
  }

  if (active.status === "locating") {
    active.status = "running";
    active.startedAt = Date.now();
    active.resumeStartedAt = Date.now();
    active.route.push(point);
    active.lastAcceptedAt = Date.now();
    elements.pauseButton.disabled = false;
    void requestWakeLock();
  } else {
    const previousPoint = active.route.at(-1);
    const result = evaluateRoutePoint(previousPoint, point);
    if (result.accepted) {
      active.route.push(point);
      active.distanceMeters += result.distanceMeters;
      active.lastAcceptedAt = Date.now();
    }
  }

  setSignal(
    "good",
    "GPS 已连接",
    `定位精度约 ${Math.round(point.accuracyMeters)} 米，保持页面在前台可减少记录中断。`,
  );
  elements.pauseButton.disabled = false;
  elements.endButton.disabled = false;
  renderLiveRun();
  renderLiveRoute();
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
          "请在 iPhone 的“设置 > 隐私与安全性 > 定位服务”中允许 Safari 网站使用精确位置。完成设置后，返回轻跑重新开始。",
        icon: true,
        actions: [
          { label: "我知道了", value: "ok" },
          { label: "返回首页", value: "home", style: "secondary" },
        ],
      }).then((choice) => {
        if (choice === "home") {
          abandonUnstartedRun();
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
  renderLiveRun();
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
    if (Date.now() - state.lastPersistedAt > 5_000) {
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
  elements.livePace.textContent = formatPace(
    calculatePaceSeconds(active.distanceMeters, elapsed),
  );
}

function renderLiveRoute() {
  const active = state.activeRun;
  if (!active) {
    return;
  }
  renderRouteSvg(elements.liveRoute, active.route || [], {
    live: true,
    height: 150,
    emptyMessage: "路线将在这里逐渐显现",
  });
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
    setSignal("paused", "记录已暂停", "继续后将重新接入定位并累计数据。");
  } else {
    active.resumeStartedAt = Date.now();
    active.lastSeenAt = Date.now();
    active.status = "running";
    startLocationWatch();
    setSignal("locating", "正在恢复", "正在等待新的定位点。");
  }

  renderLiveRun();
  void releaseWakeLock();
  if (active.status === "running") {
    void requestWakeLock();
  }
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
      abandonUnstartedRun();
    }
    return;
  }

  const elapsed = currentElapsedMilliseconds();
  const choice = await showDialog({
    title: "结束这次跑步？",
    message: `${formatDistance(active.distanceMeters)} km · ${formatDuration(elapsed)}`,
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
    route: Array.isArray(active.route) ? active.route : [],
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
      message: "本地存储暂时不可用，跑步数据仍保留在本次页面中。请关闭其他轻跑页面后再试。",
      icon: true,
      actions: [{ label: "我知道了", value: "ok" }],
    });
    return;
  }

  state.activeRun = null;
  hideRunScreen();
  await loadRuns();
  const savedRun = state.runs.find((item) => item.id === run.id) || run;
  openRecord(savedRun, "home");
  showToast("跑步已保存");
}

async function abandonUnstartedRun() {
  if (!state.activeRun) {
    return;
  }
  await clearRunSession();
  showToast("本次未保存");
}

async function clearRunSession() {
  await stopRunTracking();
  state.activeRun = null;
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
  await releaseWakeLock();
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
  if (!currentLock) {
    return;
  }
  currentLock.release().catch((error) => console.warn(error));
}

async function persistActiveRun() {
  if (!state.activeRun) {
    return;
  }
  state.lastPersistedAt = Date.now();
  try {
    await saveActiveRun({ ...state.activeRun });
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
  restored.status = restored.status === "running" ? "paused" : restored.status;

  if (!restored.startedAt || restored.elapsedMilliseconds < 1000) {
    const choice = await showDialog({
      title: "上次跑步未开始",
      message: "没有记录到有效时长。可以清除这次未完成的准备。",
      icon: true,
      actions: [{ label: "返回首页", value: "clear" }],
    });
    if (choice === "clear") {
      await clearActiveRun();
    }
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

  await finishRun();
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
    button.addEventListener("click", () => {
      elements.dialog.close(action.value);
    });
    elements.dialogActions.append(button);
  }

  return new Promise((resolve) => {
    state.dialogResolver = resolve;
    elements.dialog.returnValue = "";
    elements.dialog.showModal();
  });
}

function bindEvents() {
  elements.startButton.addEventListener("click", handleStartRun);
  elements.pauseButton.addEventListener("click", handlePauseToggle);
  elements.endButton.addEventListener("click", handleEndRun);

  for (const tab of elements.tabbar.querySelectorAll("[data-tab]")) {
    tab.addEventListener("click", () => {
      navigateTo(tab.dataset.tab);
      if (tab.dataset.tab === "history") {
        renderHistory();
      } else {
        renderHome();
      }
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

  elements.recordBackButton.addEventListener("click", () => {
    navigateTo(state.recordReturnView);
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
          "页面进入过后台，期间可能没有定位。已重新尝试连接，请以本次距离为准。",
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
  renderHome();
  renderHistory();
  registerServiceWorker();
  await loadRuns();
  await restoreActiveRunIfNeeded();
  void requestPersistentStorage();
}

init();
