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
  const transaction = database.transaction("runs", "readonly");
  assert(
    transaction.objectStore("runs").indexNames.contains("startedAt"),
    "应包含 startedAt 索引",
  );
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
