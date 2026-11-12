import { GPS_GAP_SECONDS, isUsablePoint } from "./geo.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

export function projectRoute(points, width, height, padding = 24) {
  const usable = points.filter(isUsablePoint);
  if (usable.length === 0) {
    return { segments: [], start: null, end: null };
  }

  const averageLatitude =
    usable.reduce((sum, point) => sum + point.latitude, 0) / usable.length;
  const longitudeScale = Math.cos((averageLatitude * Math.PI) / 180);
  const projected = usable.map((point) => ({
    ...point,
    x: point.longitude * longitudeScale,
    y: -point.latitude,
  }));

  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xSpan = Math.max(maxX - minX, 1e-10);
  const ySpan = Math.max(maxY - minY, 1e-10);
  const innerWidth = Math.max(width - padding * 2, 1);
  const innerHeight = Math.max(height - padding * 2, 1);
  const scale = Math.min(innerWidth / xSpan, innerHeight / ySpan);
  const offsetX = (width - xSpan * scale) / 2;
  const offsetY = (height - ySpan * scale) / 2;

  const screenPoints = projected.map((point) => ({
    ...point,
    screenX: offsetX + (point.x - minX) * scale,
    screenY: offsetY + (point.y - minY) * scale,
  }));

  const segments = [];
  let current = [];
  for (const point of screenPoints) {
    const previous = current.at(-1);
    if (
      previous &&
      (point.segmentStart || point.timestamp - previous.timestamp > GPS_GAP_SECONDS * 1000)
    ) {
      if (current.length > 0) {
        segments.push(current);
      }
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) {
    segments.push(current);
  }

  return {
    segments,
    start: screenPoints[0],
    end: screenPoints.at(-1),
  };
}

function appendEmptyState(container, message, live) {
  const empty = document.createElement("div");
  empty.className = live ? "live-route-empty" : "route-empty";

  if (!live) {
    const icon = svgElement("svg", { class: "icon", "aria-hidden": "true" });
    const use = svgElement("use", { href: "#i-route" });
    icon.append(use);
    empty.append(icon);
  }

  const text = document.createElement("p");
  text.textContent = message;
  empty.append(text);
  container.append(empty);
}

export function renderRouteSvg(container, points, options = {}) {
  const {
    emptyMessage = "轨迹点不足，暂未生成路线。",
    live = false,
    width = 340,
    height = live ? 150 : 212,
  } = options;

  container.replaceChildren();
  if (!Array.isArray(points) || points.length < 2) {
    appendEmptyState(container, emptyMessage, live);
    return;
  }

  const geometry = projectRoute(points, width, height);
  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": "跑步路线",
  });

  for (const segment of geometry.segments) {
    if (segment.length < 2) {
      continue;
    }

    const path = svgElement("path", {
      d: segment
        .map(
          (point, index) =>
            `${index === 0 ? "M" : "L"} ${point.screenX.toFixed(2)} ${point.screenY.toFixed(2)}`,
        )
        .join(" "),
      class: live ? "route-path route-path-live" : "route-path route-path-detail",
      pathLength: 1,
      fill: "none",
      stroke: live ? "#f46343" : "#17865a",
      "stroke-width": live ? 4 : 5,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
    svg.append(path);
  }

  if (geometry.start) {
    svg.append(
      svgElement("circle", {
        cx: geometry.start.screenX,
        cy: geometry.start.screenY,
        r: live ? 4 : 5,
        fill: "#ffffff",
        stroke: "#17865a",
        "stroke-width": 3,
      }),
    );
  }

  if (geometry.end && geometry.segments.length > 0 && geometry.end !== geometry.start) {
    svg.append(
      svgElement("circle", {
        cx: geometry.end.screenX,
        cy: geometry.end.screenY,
        r: live ? 5 : 6,
        fill: "#f46343",
        stroke: "#ffffff",
        "stroke-width": 3,
      }),
    );
  }

  container.append(svg);
}
