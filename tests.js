import {
  calculatePaceSeconds,
  evaluateRoutePoint,
  formatDistance,
  formatDuration,
  formatPace,
  haversineDistanceMeters,
  isUsablePoint,
  totalStats,
  weeklyStats,
} from "./geo.js";
import { openDatabase } from "./db.js";
import {
  buildKilometerSplits,
  buildWeeklyBuckets,
  consecutiveCompletedWeeks,
  goalProgress,
  groupRunsByMonth,
  personalRecords,
  rollingPaceSeconds,
} from "./analytics.js";
import {
  createBackup,
  mergeBackupRuns,
  normalizeRunRecord,
  parseBackup,
} from "./data-model.js";
import {
  calendarMonth,
  calculateAchievements,
  newlyUnlockedAchievements,
  yearSummary,
} from "./achievements.js";
import { renderSplitChart, renderWeeklyChart } from "./charts.js";
import { projectRoute, renderRouteSvg } from "./route-view.js";

const results = [];
const resultsElement = document.getElementById("results");
const summaryElement = document.getElementById("summary");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertClose(actual, expected, tolerance, message) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message}：期望 ${expected}，实际 ${actual}`,
  );
}

function point(latitude, longitude, seconds, accuracyMeters = 5) {
  return {
    latitude,
    longitude,
    accuracyMeters,
    timestamp: 1_700_000_000_000 + seconds * 1000,
  };
}

function makeRun(id, startedAt, overrides = {}) {
  return {
    id,
    startedAt,
    endedAt: startedAt + 1_800_000,
    durationSeconds: 1800,
    distanceMeters: 5000,
    avgPaceSecondsPerKm: 360,
    route: [],
    splits: [],
    schemaVersion: 2,
    createdAt: startedAt,
    ...overrides,
  };
}

async function test(name, callback) {
  try {
    await callback();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, message: error.message });
  }
}

await test("Haversine 距离计算", () => {
  const distance = haversineDistanceMeters(point(31.23, 121.47, 0), point(31.231, 121.47, 1));
  assertClose(distance, 111.2, 0.2, "纬度 0.001 度");
});

await test("首个定位点和精度过滤", () => {
  assert(evaluateRoutePoint(null, point(31.23, 121.47, 0)).accepted, "首个点应被接受");
  assert(!isUsablePoint(point(31.23, 121.47, 0, 75)), "75 米精度应被拒绝");
  assert(
    evaluateRoutePoint(point(31.23, 121.47, 0), point(31.23, 121.47, 1, 80)).reason ===
      "accuracy",
    "低精度点不应参与计算",
  );
});

await test("正常移动、噪点和瞬移过滤", () => {
  const origin = point(31.23, 121.47, 0);
  const moving = evaluateRoutePoint(origin, point(31.23003, 121.47, 1));
  const noise = evaluateRoutePoint(origin, point(31.230001, 121.47, 1));
  const jump = evaluateRoutePoint(origin, point(31.231, 121.47, 1));
  assert(moving.accepted, "正常移动应被接受");
  assert(noise.reason === "noise", "小于 2 米应视为噪点");
  assert(jump.reason === "jump", "异常瞬移应被拒绝");
});

await test("定位间隔过长时断开距离", () => {
  const result = evaluateRoutePoint(point(31.23, 121.47, 0), point(31.231, 121.47, 120));
  assert(result.accepted, "间隔后的点应作为新轨迹段起点");
  assert(result.distanceMeters === 0, "长间隔不能补算距离");
});

await test("配速与格式", () => {
  assertClose(calculatePaceSeconds(1000, 360_000), 360, 0.01, "每公里配速");
  assert(calculatePaceSeconds(10, 10_000) === null, "距离不足时不计算配速");
  assert(formatDistance(1234) === "1.23", "距离格式");
  assert(formatDuration(3_723_000) === "1:02:03", "时长格式");
  assert(formatPace(359.6) === "06'00\"", "配速格式");
});

await test("周统计与累计统计", () => {
  const monday = new Date(2026, 10, 2, 8, 0, 0).getTime();
  const runs = [
    { startedAt: monday, distanceMeters: 1000, durationSeconds: 360 },
    { startedAt: monday + 86_400_000, distanceMeters: 2000, durationSeconds: 720 },
    { startedAt: monday - 7 * 86_400_000, distanceMeters: 3000, durationSeconds: 1080 },
  ];
  const week = weeklyStats(runs, new Date(2026, 10, 3, 12, 0, 0));
  const total = totalStats(runs);
  assert(week.count === 2, "本周次数");
  assert(week.distanceMeters === 3000, "本周距离");
  assert(total.distanceMeters === 6000, "累计距离");
  assert(total.count === 3, "累计次数");
});

await test("双周目标进度", () => {
  const progress = goalProgress(
    { count: 2, distanceMeters: 3000, durationMilliseconds: 1_080_000 },
    { weeklyDistanceGoalKm: 20, weeklyCountGoal: 3 },
  );
  assert(progress.distanceRatio === 0.15, "距离进度");
  assertClose(progress.countRatio, 0.6667, 0.001, "次数进度");
  assert(progress.remainingDistanceMeters === 17_000, "剩余距离");
  assert(progress.remainingCount === 1, "剩余次数");
  assert(!progress.complete, "双目标未完成");
});

await test("连续达标周与八周数据", () => {
  const currentMonday = new Date(2026, 10, 2, 8, 0, 0).getTime();
  const runs = [];
  for (let week = 0; week < 2; week += 1) {
    for (let runIndex = 0; runIndex < 3; runIndex += 1) {
      runs.push(
        makeRun(`streak-${week}-${runIndex}`, currentMonday - week * 7 * 86_400_000 + runIndex * 3_600_000, {
          distanceMeters: 7000,
        }),
      );
    }
  }
  const streak = consecutiveCompletedWeeks(
    runs,
    { weeklyDistanceGoalKm: 20, weeklyCountGoal: 3 },
    new Date(2026, 10, 4, 12, 0, 0),
  );
  const buckets = buildWeeklyBuckets(runs, new Date(2026, 10, 4, 12, 0, 0), 8);
  assert(streak === 2, "连续两周达标");
  assert(buckets.length === 8, "应生成八周柱状数据");
  assert(buckets.at(-1).distanceMeters === 21_000, "本周跑量");
});

await test("公里分段插值", () => {
  const route = [];
  for (let index = 0; index <= 10; index += 1) {
    route.push({
      latitude: 31.23 + index * 0.001,
      longitude: 121.47,
      accuracyMeters: 5,
      timestamp: 1_700_000_000_000 + index * 30_000,
      elapsedMilliseconds: index * 30_000,
    });
  }
  const splits = buildKilometerSplits(route);
  assert(splits.length >= 1, "应生成至少一公里分段");
  assertClose(splits[0].distanceMeters, 1000, 1, "首个完整公里");
  assertClose(splits[0].paceSecondsPerKilometer, 269.8, 2, "分段配速");
});

await test("暂停断段与滚动配速", () => {
  const route = [];
  for (let index = 0; index <= 4; index += 1) {
    route.push({
      latitude: 31.23 + index * 0.0004,
      longitude: 121.47,
      accuracyMeters: 5,
      timestamp: 1_700_000_000_000 + index * 10_000,
      elapsedMilliseconds: index * 10_000,
      ...(index === 3 ? { segmentStart: true } : {}),
    });
  }
  const splits = buildKilometerSplits(route);
  const rolling = rollingPaceSeconds(route);
  assert(
    splits.every((split) => split.distanceMeters < 999),
    "断段前不足一公里不生成完整分段",
  );
  assertClose(rolling, 224.6, 2, "断段后只使用恢复后的配速窗口");
});

await test("个人纪录与月度分组", () => {
  const base = new Date(2026, 10, 2, 8, 0, 0).getTime();
  const runs = [
    makeRun("r1", base, { distanceMeters: 3000, avgPaceSecondsPerKm: 420 }),
    makeRun("r2", base + 86_400_000, {
      distanceMeters: 6200,
      avgPaceSecondsPerKm: 350,
      splits: [
        {
          index: 1,
          distanceMeters: 1000,
          durationSeconds: 330,
          paceSecondsPerKilometer: 330,
        },
      ],
    }),
  ];
  const records = personalRecords(runs);
  const groups = groupRunsByMonth(runs);
  assert(records.longest.value === 6200, "最远距离");
  assert(records.bestAveragePace.value === 350, "最佳平均配速");
  assert(records.fastestKilometer.value === 330, "最快公里");
  assert(groups.length === 1 && groups[0].count === 2, "月度分组");
});

await test("路线投影按时间断点分段", () => {
  const route = [
    point(31.23, 121.47, 0),
    point(31.23003, 121.47001, 2),
    point(31.23009, 121.47003, 120),
  ];
  const geometry = projectRoute(route, 340, 212);
  assert(geometry.segments.length === 2, "长间隔应绘制为两段");
  assert(geometry.start && geometry.end, "起终点应存在");
});

await test("路线 SVG 与空状态渲染", () => {
  const container = document.createElement("div");
  renderRouteSvg(container, [
    point(31.23, 121.47, 0),
    point(31.23003, 121.47001, 2),
  ]);
  assert(Boolean(container.querySelector("svg")), "有效路线应输出 SVG");
  assert(Boolean(container.querySelector("path")), "有效路线应输出路径");
  renderRouteSvg(container, [point(31.23, 121.47, 0)]);
  assert(Boolean(container.querySelector(".route-empty")), "单点应显示空状态");
});

await test("IndexedDB 数据结构", async () => {
  const database = await openDatabase();
  assert(database.objectStoreNames.contains("runs"), "应包含 runs");
  assert(database.objectStoreNames.contains("active"), "应包含 active");
  assert(database.objectStoreNames.contains("settings"), "应包含 settings");
  const transaction = database.transaction("runs", "readonly");
  assert(
    transaction.objectStore("runs").indexNames.contains("startedAt"),
    "应包含 startedAt 索引",
  );
});

await test("旧记录兼容与备份合并", () => {
  const oldRun = normalizeRunRecord({
    id: "legacy",
    startedAt: 1_700_000_000_000,
    durationSeconds: 600,
    distanceMeters: 2000,
    route: [],
  });
  assert(oldRun && oldRun.schemaVersion === 1, "旧记录应补全版本");
  const backup = createBackup(
    [makeRun("same", 1_700_000_000_000), makeRun("new", 1_700_100_000_000)],
    { weeklyDistanceGoalKm: 25, weeklyCountGoal: 4 },
  );
  const parsed = parseBackup(JSON.stringify(backup));
  const merged = mergeBackupRuns(parsed, [makeRun("same", 1_700_000_000_000)]);
  assert(parsed.settings.weeklyDistanceGoalKm === 25, "备份目标");
  assert(merged.newRuns.length === 1, "只新增不同 ID");
  assert(merged.duplicateCount === 1, "重复记录应跳过");
});

await test("损坏备份拒绝", () => {
  let rejected = false;
  try {
    parseBackup('{"not":"a backup"}');
  } catch {
    rejected = true;
  }
  assert(rejected, "非轻跑备份应被拒绝");
});

await test("六枚里程碑追溯计算", () => {
  const monday = new Date(2026, 9, 5, 8, 0, 0).getTime();
  const runs = [];
  for (let week = 0; week < 4; week += 1) {
    for (let index = 0; index < 2; index += 1) {
      runs.push(
        makeRun(`milestone-${week}-${index}`, monday + week * 7 * 86_400_000 + index * 3_600_000, {
          distanceMeters: 5000,
        }),
      );
    }
  }
  runs.push(
    makeRun("milestone-extra-1", monday + 7 * 3_600_000, { distanceMeters: 5000 }),
    makeRun("milestone-extra-2", monday + 8 * 3_600_000, { distanceMeters: 5000 }),
  );
  const achievements = calculateAchievements(runs);
  assert(achievements.length === 6, "应有六枚里程碑");
  assert(achievements.every((achievement) => achievement.unlocked), "十次五公里应全部解锁");
  assert(
    achievements.find((achievement) => achievement.id === "four-week-rhythm").unlocked,
    "连续四周应解锁",
  );
});

await test("里程碑进度与新增解锁", () => {
  const before = [
    makeRun("only-one", new Date(2026, 10, 2, 8, 0, 0).getTime(), {
      distanceMeters: 3000,
    }),
  ];
  const after = [
    ...before,
    ...Array.from({ length: 9 }, (_, index) =>
      makeRun(`next-${index}`, new Date(2026, 10, 3 + index, 8, 0, 0).getTime(), {
        distanceMeters: 6000,
      }),
    ),
  ];
  const progress = calculateAchievements(before);
  const fresh = newlyUnlockedAchievements(before, after);
  assert(progress.find((item) => item.id === "first-run").unlocked, "首跑应解锁");
  assert(
    progress.find((item) => item.id === "five-kilometers").current === 3000,
    "单次距离进度",
  );
  assert(fresh.some((item) => item.id === "ten-runs"), "新增十次成就");
  assert(fresh.some((item) => item.id === "fifty-kilometers"), "新增累计距离成就");
  assert(!fresh.some((item) => item.id === "first-run"), "旧成就不能重复通知");
});

await test("年度汇总与月历边界", () => {
  const runs = [
    makeRun("year-a", new Date(2026, 1, 2, 8, 0, 0).getTime(), {
      distanceMeters: 4000,
    }),
    makeRun("year-b", new Date(2026, 1, 8, 8, 0, 0).getTime(), {
      distanceMeters: 6000,
    }),
    makeRun("old-year", new Date(2025, 11, 31, 8, 0, 0).getTime(), {
      distanceMeters: 9000,
    }),
  ];
  const summary = yearSummary(runs, new Date(2026, 2, 1, 12, 0, 0));
  const february = calendarMonth(runs, 2026, 1);
  assert(summary.year === 2026, "年度");
  assert(summary.activeDays === 2, "跑步天数");
  assert(summary.distanceMeters === 10_000, "年度距离");
  assert(february.days.length === 28, "平年二月天数");
  assert(february.summary.count === 2, "月跑步次数");
  assert(
    february.days.find((day) => day.day === 2).hasRuns,
    "跑步日应被标记",
  );
});

await test("趋势与分段图表渲染", () => {
  const weeklyContainer = document.createElement("div");
  renderWeeklyChart(
    weeklyContainer,
    buildWeeklyBuckets(
      [makeRun("chart", Date.now(), { distanceMeters: 5000 })],
      new Date(),
      8,
    ),
    20,
  );
  assert(Boolean(weeklyContainer.querySelector("svg")), "周趋势应输出 SVG");

  const splitContainer = document.createElement("div");
  renderSplitChart(splitContainer, [
    {
      index: 1,
      distanceMeters: 1000,
      durationSeconds: 330,
      paceSecondsPerKilometer: 330,
    },
  ]);
  assert(Boolean(splitContainer.querySelector(".split-bars")), "分段图应输出");
});

await test("Manifest 与 Service Worker 资源", async () => {
  const [manifestResponse, serviceWorkerResponse] = await Promise.all([
    fetch("./manifest.webmanifest"),
    fetch("./sw.js"),
  ]);
  assert(manifestResponse.ok, "Manifest 应可读取");
  assert(serviceWorkerResponse.ok, "Service Worker 应可读取");
  const manifest = await manifestResponse.json();
  assert(manifest.name === "轻跑", "Manifest 名称");
  assert(manifest.display === "standalone", "应使用独立窗口模式");
  assert(manifest.icons.length >= 2, "应包含应用图标");
});

for (const result of results) {
  const item = document.createElement("li");
  item.className = result.passed ? "pass" : "fail";
  item.textContent = `${result.passed ? "通过" : "失败"} · ${result.name}${result.passed ? "" : `：${result.message}`}`;
  resultsElement.append(item);
}

const failures = results.filter((result) => !result.passed);
summaryElement.textContent = `${results.length - failures.length}/${results.length} 项通过`;
summaryElement.classList.toggle("failure", failures.length > 0);
document.title = `${failures.length === 0 ? "通过" : "失败"} - 轻跑测试`;
document.documentElement.dataset.testStatus = failures.length === 0 ? "passed" : "failed";
