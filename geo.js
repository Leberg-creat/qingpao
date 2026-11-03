export const GPS_ACCURACY_LIMIT_METERS = 50;
export const GPS_MIN_DISTANCE_METERS = 2;
export const GPS_MAX_SPEED_METERS_PER_SECOND = 12;
export const GPS_GAP_SECONDS = 60;
export const MIN_PACE_DISTANCE_METERS = 20;

const EARTH_RADIUS_METERS = 6_371_008.8;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function haversineDistanceMeters(first, second) {
  const lat1 = toRadians(first.latitude);
  const lat2 = toRadians(second.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(second.longitude - first.longitude);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function pointFromPosition(position) {
  return {
    latitude: Number(position.coords.latitude),
    longitude: Number(position.coords.longitude),
    accuracyMeters: Number(position.coords.accuracy),
    timestamp: Number(position.timestamp) || Date.now(),
  };
}

export function isUsablePoint(point) {
  return (
    Number.isFinite(point?.latitude) &&
    Number.isFinite(point?.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180 &&
    Number.isFinite(point?.accuracyMeters) &&
    point.accuracyMeters >= 0 &&
    point.accuracyMeters <= GPS_ACCURACY_LIMIT_METERS &&
    Number.isFinite(point?.timestamp)
  );
}

export function evaluateRoutePoint(previousPoint, nextPoint) {
  if (!isUsablePoint(nextPoint)) {
    return { accepted: false, distanceMeters: 0, reason: "accuracy" };
  }

  if (!previousPoint) {
    return { accepted: true, distanceMeters: 0, reason: "start" };
  }

  const seconds = (nextPoint.timestamp - previousPoint.timestamp) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { accepted: false, distanceMeters: 0, reason: "timestamp" };
  }

  const distance = haversineDistanceMeters(previousPoint, nextPoint);
  if (seconds > GPS_GAP_SECONDS) {
    return { accepted: true, distanceMeters: 0, reason: "gap" };
  }

  if (distance / seconds > GPS_MAX_SPEED_METERS_PER_SECOND) {
    return { accepted: false, distanceMeters: 0, reason: "jump" };
  }

  if (distance < GPS_MIN_DISTANCE_METERS) {
    return { accepted: false, distanceMeters: 0, reason: "noise" };
  }

  return { accepted: true, distanceMeters: distance, reason: "ok" };
}

export function calculatePaceSeconds(distanceMeters, durationMilliseconds) {
  if (
    !Number.isFinite(distanceMeters) ||
    !Number.isFinite(durationMilliseconds) ||
    distanceMeters < MIN_PACE_DISTANCE_METERS ||
    durationMilliseconds <= 0
  ) {
    return null;
  }

  return durationMilliseconds / 1000 / (distanceMeters / 1000);
}

export function formatDistance(meters, decimals = 2) {
  const safeMeters = Number.isFinite(meters) ? Math.max(0, meters) : 0;
  return (safeMeters / 1000).toFixed(decimals);
}

export function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatDurationCompact(milliseconds) {
  const totalMinutes = Math.round((Number(milliseconds) || 0) / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes} 分`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分`;
}

export function formatPace(secondsPerKilometer) {
  if (!Number.isFinite(secondsPerKilometer) || secondsPerKilometer <= 0) {
    return "--'--\"";
  }

  const rounded = Math.round(secondsPerKilometer);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${String(minutes).padStart(2, "0")}'${String(seconds).padStart(2, "0")}"`;
}

export function startOfWeek(date = new Date()) {
  const result = new Date(date);
  const day = result.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + offset);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function weekRangeLabel(now = new Date()) {
  const start = startOfWeek(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const format = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });
  return `${format.format(start)} - ${format.format(end)}`;
}

export function weeklyStats(runs, now = new Date()) {
  const start = startOfWeek(now).getTime();
  const activeRuns = runs.filter((run) => Number(run.startedAt) >= start);
  const distanceMeters = activeRuns.reduce(
    (sum, run) => sum + (Number(run.distanceMeters) || 0),
    0,
  );
  const durationMilliseconds = activeRuns.reduce(
    (sum, run) => sum + (Number(run.durationSeconds) || 0) * 1000,
    0,
  );

  return {
    count: activeRuns.length,
    distanceMeters,
    durationMilliseconds,
    paceSeconds: calculatePaceSeconds(distanceMeters, durationMilliseconds),
  };
}

export function totalStats(runs) {
  return runs.reduce(
    (result, run) => {
      result.distanceMeters += Number(run.distanceMeters) || 0;
      result.count += 1;
      return result;
    },
    { distanceMeters: 0, count: 0 },
  );
}
