import { calculatePaceSeconds, isUsablePoint } from "./geo.js";

export const BACKUP_FORMAT = "qingpao-backup";
export const SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS = Object.freeze({
  weeklyDistanceGoalKm: 20,
  weeklyCountGoal: 3,
});

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeSettings(input = {}, now = Date.now()) {
  return {
    weeklyDistanceGoalKm: Math.min(
      500,
      Math.max(1, Math.round(finiteNumber(input.weeklyDistanceGoalKm, 20))),
    ),
    weeklyCountGoal: Math.min(
      14,
      Math.max(1, Math.round(finiteNumber(input.weeklyCountGoal, 3))),
    ),
    createdAt: Math.max(0, finiteNumber(input.createdAt, now)),
    updatedAt: Math.max(0, finiteNumber(input.updatedAt, now)),
  };
}

function normalizeSplit(split, index) {
  const distanceMeters = finiteNumber(split?.distanceMeters, 0);
  const durationSeconds = finiteNumber(split?.durationSeconds, 0);
  if (distanceMeters <= 0 || durationSeconds <= 0) {
    return null;
  }
  return {
    index: Number.isInteger(split.index) ? split.index : index + 1,
    distanceMeters,
    durationSeconds,
    paceSecondsPerKilometer:
      finiteNumber(split.paceSecondsPerKilometer, 0) ||
      durationSeconds / (distanceMeters / 1000),
  };
}

export function normalizeRunRecord(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const id = typeof input.id === "string" ? input.id.trim() : "";
  const startedAt = finiteNumber(input.startedAt, 0);
  const durationSeconds = finiteNumber(input.durationSeconds, 0);
  const distanceMeters = finiteNumber(input.distanceMeters, 0);
  if (!id || startedAt <= 0 || durationSeconds < 0 || distanceMeters < 0) {
    return null;
  }

  const route = (Array.isArray(input.route) ? input.route : [])
    .filter(isUsablePoint)
    .map((point) => ({
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      accuracyMeters: Number(point.accuracyMeters),
      timestamp: Number(point.timestamp),
      ...(Number.isFinite(Number(point.elapsedMilliseconds))
        ? { elapsedMilliseconds: Math.max(0, Number(point.elapsedMilliseconds)) }
        : {}),
      ...(point.segmentStart ? { segmentStart: true } : {}),
    }))
    .sort((first, second) => first.timestamp - second.timestamp);

  const splits = (Array.isArray(input.splits) ? input.splits : [])
    .map(normalizeSplit)
    .filter(Boolean);

  const avgPaceSecondsPerKm =
    Number.isFinite(Number(input.avgPaceSecondsPerKm)) &&
    Number(input.avgPaceSecondsPerKm) > 0
      ? Number(input.avgPaceSecondsPerKm)
      : calculatePaceSeconds(distanceMeters, durationSeconds * 1000);

  return {
    id,
    startedAt,
    endedAt: Math.max(startedAt, finiteNumber(input.endedAt, startedAt)),
    durationSeconds,
    distanceMeters,
    avgPaceSecondsPerKm,
    route,
    splits,
    schemaVersion: finiteNumber(input.schemaVersion, 1),
    createdAt: Math.max(startedAt, finiteNumber(input.createdAt, startedAt)),
  };
}

export function createBackup(runs, settings, now = Date.now()) {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    settings: normalizeSettings(settings, now),
    runs: runs.map(normalizeRunRecord).filter(Boolean),
  };
}

export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("备份文件不是有效的 JSON。");
  }

  if (!parsed || parsed.format !== BACKUP_FORMAT) {
    throw new Error("这不是轻跑的备份文件。");
  }
  const schemaVersion = finiteNumber(parsed.schemaVersion, 0);
  if (schemaVersion < 1 || schemaVersion > SCHEMA_VERSION) {
    throw new Error("备份版本过新，请升级轻跑后再导入。");
  }
  if (!Array.isArray(parsed.runs)) {
    throw new Error("备份中缺少跑步记录。");
  }

  const runs = [];
  let invalidCount = 0;
  for (const item of parsed.runs) {
    const run = normalizeRunRecord(item);
    if (run) {
      runs.push(run);
    } else {
      invalidCount += 1;
    }
  }

  return {
    schemaVersion,
    exportedAt: finiteNumber(parsed.exportedAt, 0),
    settings: normalizeSettings(parsed.settings || {}),
    hasSettings: Boolean(parsed.settings),
    runs,
    invalidCount,
  };
}

export function mergeBackupRuns(backup, existingRuns) {
  const existingIds = new Set(existingRuns.map((run) => run.id));
  const newRuns = [];
  let duplicateCount = 0;
  for (const run of backup.runs) {
    if (existingIds.has(run.id)) {
      duplicateCount += 1;
    } else {
      newRuns.push(run);
      existingIds.add(run.id);
    }
  }
  return {
    newRuns,
    duplicateCount,
    invalidCount: backup.invalidCount,
  };
}
