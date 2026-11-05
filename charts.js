import { formatDistance, formatPace } from "./geo.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function appendEmpty(container, message) {
  const empty = document.createElement("div");
  empty.className = "chart-empty";
  empty.textContent = message;
  container.append(empty);
}

export function renderWeeklyChart(container, buckets, goalKilometers = 20) {
  container.replaceChildren();
  const values = buckets.map((bucket) => bucket.distanceMeters / 1000);
  const maximum = Math.max(goalKilometers, ...values, 1);
  if (values.every((value) => value === 0)) {
    appendEmpty(container, "完成跑步后，这里会出现每周跑量。");
    return;
  }

  const width = 340;
  const height = 190;
  const padding = { top: 12, right: 8, bottom: 34, left: 30 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const slotWidth = chartWidth / buckets.length;
  const barWidth = Math.min(24, slotWidth * 0.55);
  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": "最近八周跑步距离柱状图",
  });

  for (let line = 0; line <= 2; line += 1) {
    const value = (maximum / 2) * line;
    const y = padding.top + chartHeight - (value / maximum) * chartHeight;
    svg.append(
      svgElement("line", {
        x1: padding.left,
        x2: width - padding.right,
        y1: y,
        y2: y,
        stroke: "#dce4dd",
        "stroke-width": 1,
      }),
    );
    const label = svgElement("text", {
      x: padding.left - 6,
      y: y + 3,
      "text-anchor": "end",
      fill: "#7a857d",
      "font-size": 9,
    });
    label.textContent = value.toFixed(value < 10 ? 1 : 0);
    svg.append(label);
  }

  const goalY =
    padding.top + chartHeight - (Math.min(goalKilometers, maximum) / maximum) * chartHeight;
  svg.append(
    svgElement("line", {
      x1: padding.left,
      x2: width - padding.right,
      y1: goalY,
      y2: goalY,
      stroke: "#f46343",
      "stroke-width": 1.5,
      "stroke-dasharray": "5 5",
      opacity: 0.7,
    }),
  );

  buckets.forEach((bucket, index) => {
    const value = bucket.distanceMeters / 1000;
    const barHeight = Math.max(2, (value / maximum) * chartHeight);
    const x = padding.left + index * slotWidth + (slotWidth - barWidth) / 2;
    const y = padding.top + chartHeight - barHeight;
    svg.append(
      svgElement("rect", {
        x,
        y,
        width: barWidth,
        height: barHeight,
        rx: 4,
        fill: bucket.isCurrent ? "#f46343" : "#18784d",
        opacity: bucket.isCurrent ? 1 : 0.72,
      }),
    );
    const label = svgElement("text", {
      x: x + barWidth / 2,
      y: height - 13,
      "text-anchor": "middle",
      fill: bucket.isCurrent ? "#d84b2d" : "#7a857d",
      "font-size": 9,
      "font-weight": bucket.isCurrent ? 700 : 500,
    });
    label.textContent = bucket.label;
    svg.append(label);
  });

  container.append(svg);
}

export function renderSplitChart(container, splits) {
  container.replaceChildren();
  if (!Array.isArray(splits) || splits.length === 0) {
    appendEmpty(container, "本条记录没有可用的公里分段。");
    return;
  }

  const valid = splits.filter(
    (split) =>
      Number(split.distanceMeters) > 0 &&
      Number(split.paceSecondsPerKilometer) > 0,
  );
  if (valid.length === 0) {
    appendEmpty(container, "本条记录没有可用的公里分段。");
    return;
  }

  const fastest = valid.reduce((best, split) =>
    split.paceSecondsPerKilometer < best.paceSecondsPerKilometer ? split : best,
  );
  const list = document.createElement("div");
  list.className = "split-bars";

  for (const split of valid) {
    const row = document.createElement("div");
    row.className = "split-row";
    if (split === fastest) {
      row.classList.add("is-fastest");
    }
    const label = document.createElement("span");
    label.className = "split-label";
    label.textContent =
      Number(split.distanceMeters) >= 999
        ? String(split.index)
        : formatDistance(split.distanceMeters);
    const track = document.createElement("span");
    track.className = "split-track";
    const fill = document.createElement("span");
    track.append(fill);
    const pace = document.createElement("strong");
    pace.textContent = formatPace(split.paceSecondsPerKilometer);
    const widthPercent = Math.max(
      12,
      (fastest.paceSecondsPerKilometer / split.paceSecondsPerKilometer) * 100,
    );
    fill.style.width = `${widthPercent}%`;
    row.append(label, track, pace);
    list.append(row);
  }

  container.append(list);
}
