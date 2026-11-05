import {
  GPS_GAP_SECONDS,
  calculatePaceSeconds,
  haversineDistanceMeters,
  isUsablePoint,
  startOfWeek,
} from "./geo.js";

const WEEK_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const MAX_STREAK_WEEKS = 104;

export function runDurationMilliseconds(run) {
  return Math.max(0, Number(run?.durationSeconds) || 0) * 1000;
}

export function runPaceSeconds(run) {
  if (Number.isFinite(run?.avgPaceSecondsPerKm) && run.avgPaceSecondsPerKm > 0) {
    return run.avgPaceSecondsPerKm;
  }
  return calculatePaceSeconds(
    Number(run?.distanceMeters) || 0,
    runDurationMilliseconds(run),
  );
}

export function runsBetween(runs, startTime, endTime) {
  return runs.filter((run) => {
    const startedAt = Number(run.startedAt);
    return startedAt >= startTime && startedAt < endTime;
  });
}

export function statsForRuns(runs) {
  const distanceMeters = runs.reduce(
    (sum, run) => sum + Math.max(0, Number(run.distanceMeters) || 0),
    0,
  );
  const durationMilliseconds = runs.reduce(
    (sum, run) => sum + runDurationMilliseconds(run),
    0,
  );
  return {
    count: runs.length,
    distanceMeters,
    durationMilliseconds,
    paceSeconds: calculatePaceSeconds(distanceMeters, durationMilliseconds),
  };
}

export function goalProgress(weekStats, settings) {
  const distanceGoalMeters = Math.max(1, Number(settings.weeklyDistanceGoalKm) || 20) * 1000;
  const countGoal = Math.max(1, Number(settings.weeklyCountGoal) || 3);
  const distanceRatio = Math.min(1, weekStats.distanceMeters / distanceGoalMeters);
  const countRatio = Math.min(1, weekStats.count / countGoal);
  const remainingDistanceMeters = Math.max(0, distanceGoalMeters - weekStats.distanceMeters);
  const remainingCount = Math.max(0, countGoal - weekStats.count);
  return {
    distanceGoalMeters,
    countGoal,
    distanceRatio,
    countRatio,
    remainingDistanceMeters,
    remainingCount,
    distanceComplete: remainingDistanceMeters === 0,
    countComplete: remainingCount === 0,
    complete: remainingDistanceMeters === 0 && remainingCount === 0,
  };
}

export function consecutiveCompletedWeeks(runs, settings, now = new Date()) {
  let cursor = startOfWeek(now);
  const currentStart = cursor.getTime();
  const currentStats = statsForRuns(
    runsBetween(runs, currentStart, currentStart + WEEK_MILLISECONDS),
  );
  if (!goalProgress(currentStats, settings).complete) {
    cursor = new Date(currentStart - WEEK_MILLISECONDS);
  }

  let streak = 0;
  while (streak < MAX_STREAK_WEEKS) {
    const start = cursor.getTime();
    const stats = statsForRuns(runsBetween(runs, start, start + WEEK_MILLISECONDS));
    if (!goalProgress(stats, settings).complete) {
      break;
    }
    streak += 1;
    cursor = new Date(start - WEEK_MILLISECONDS);
  }
  return streak;
}

export function monthStats(runs, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return statsForRuns(runsBetween(runs, start.getTime(), end.getTime()));
}

export function buildWeeklyBuckets(runs, now = new Date(), weeks = 8) {
  const currentWeekStart = startOfWeek(now).getTime();
  const buckets = [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const start = currentWeekStart - index * WEEK_MILLISECONDS;
    const end = start + WEEK_MILLISECONDS;
    const stats = statsForRuns(runsBetween(runs, start, end));
    const date = new Date(start);
    buckets.push({
      start,
      end,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      isCurrent: index === 0,
      ...stats,
    });
  }
  return buckets;
}

export function groupRunsByMonth(runs) {
  const groups = new Map();
  for (const run of runs) {
    const date = new Date(run.startedAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`,
        runs: [],
      });
    }
    groups.get(key).runs.push(run);
  }

  return Array.from(groups.values()).map((group) => {
    const stats = statsForRuns(group.runs);
    return { ...group, ...stats };
  });
}

export function buildKilometerSplits(route) {
  if (!Array.isArray(route) || route.length < 2) {
    return [];
  }

  const splits = [];
  let segmentDistance = 0;
  let segmentDuration = 0;

  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const current = route[index];
    if (!isUsablePoint(previous) || !isUsablePoint(current)) {
      continue;
    }
    if (current.segmentStart) {
      continue;
    }

    const previousElapsed = Number(previous.elapsedMilliseconds);
    const currentElapsed = Number(current.elapsedMilliseconds);
    if (
      !Number.isFinite(previousElapsed) ||
      !Number.isFinite(currentElapsed) ||
      currentElapsed <= previousElapsed
    ) {
      continue;
    }

    const gapSeconds = (current.timestamp - previous.timestamp) / 1000;
    if (!Number.isFinite(gapSeconds) || gapSeconds <= 0 || gapSeconds > GPS_GAP_SECONDS) {
      continue;
    }

    let distanceRemaining = haversineDistanceMeters(previous, current);
    let durationRemaining = (currentElapsed - previousElapsed) / 1000;
    if (distanceRemaining <= 0 || durationRemaining <= 0) {
      continue;
    }

    while (distanceRemaining > 0.001) {
      const distanceToBoundary = 1000 - segmentDistance;
      if (distanceRemaining >= distanceToBoundary) {
        const fraction = distanceToBoundary / distanceRemaining;
        const durationUsed = durationRemaining * fraction;
        segmentDuration += durationUsed;
        splits.push({
          index: splits.length + 1,
          distanceMeters: 1000,
          durationSeconds: segmentDuration,
          paceSecondsPerKilometer: segmentDuration,
        });
        distanceRemaining -= distanceToBoundary;
        durationRemaining -= durationUsed;
        segmentDistance = 0;
        segmentDuration = 0;
      } else {
        segmentDistance += distanceRemaining;
        segmentDuration += durationRemaining;
        distanceRemaining = 0;
      }
    }
  }

  if (segmentDistance >= 1) {
    splits.push({
      index: splits.length + 1,
      distanceMeters: segmentDistance,
      durationSeconds: segmentDuration,
      paceSecondsPerKilometer: segmentDuration / (segmentDistance / 1000),
    });
  }

  return splits;
}

export function rollingPaceSeconds(route, windowMilliseconds = 30_000) {
  if (!Array.isArray(route) || route.length < 2) {
    return null;
  }

  const last = route.at(-1);
  const lastElapsed = Number(last?.elapsedMilliseconds);
  if (!Number.isFinite(lastElapsed)) {
    return null;
  }

  let index = route.length - 1;
  while (index > 0) {
    const point = route[index - 1];
    if (
      !Number.isFinite(Number(point?.elapsedMilliseconds)) ||
      lastElapsed - Number(point.elapsedMilliseconds) > windowMilliseconds
    ) {
      break;
    }
    index -= 1;
  }

  if (index >= route.length - 1) {
    return null;
  }

  let distanceMeters = 0;
  let durationMilliseconds = 0;
  for (let cursor = index + 1; cursor < route.length; cursor += 1) {
    const previous = route[cursor - 1];
    const current = route[cursor];
    if (!isUsablePoint(previous) || !isUsablePoint(current)) {
      continue;
    }
    if (current.segmentStart) {
      continue;
    }
    const realGapSeconds = (current.timestamp - previous.timestamp) / 1000;
    const elapsedGapMilliseconds =
      Number(current.elapsedMilliseconds) - Number(previous.elapsedMilliseconds);
    if (
      !Number.isFinite(realGapSeconds) ||
      realGapSeconds <= 0 ||
      realGapSeconds > 20 ||
      !Number.isFinite(elapsedGapMilliseconds) ||
      elapsedGapMilliseconds <= 0
    ) {
      continue;
    }
    distanceMeters += haversineDistanceMeters(previous, current);
    durationMilliseconds += elapsedGapMilliseconds;
  }

  if (distanceMeters < 10 || durationMilliseconds < 8000) {
    return null;
  }
  return durationMilliseconds / 1000 / (distanceMeters / 1000);
}

export function personalRecords(runs) {
  let longest = null;
  let bestAveragePace = null;
  let fastestKilometer = null;

  for (const run of runs) {
    const distanceMeters = Math.max(0, Number(run.distanceMeters) || 0);
    if (!longest || distanceMeters > longest.value) {
      longest = { value: distanceMeters, run };
    }

    const pace = runPaceSeconds(run);
    if (distanceMeters >= 1000 && Number.isFinite(pace) && pace > 0) {
      if (!bestAveragePace || pace < bestAveragePace.value) {
        bestAveragePace = { value: pace, run };
      }
    }

    for (const split of run.splits || []) {
      if (
        Number(split.distanceMeters) >= 999 &&
        Number.isFinite(split.paceSecondsPerKilometer) &&
        split.paceSecondsPerKilometer > 0
      ) {
        if (
          !fastestKilometer ||
          split.paceSecondsPerKilometer < fastestKilometer.value
        ) {
          fastestKilometer = {
            value: split.paceSecondsPerKilometer,
            run,
            split,
          };
        }
      }
    }
  }

  return { longest, bestAveragePace, fastestKilometer };
}

export function fastestFullSplit(run) {
  const splits = Array.isArray(run?.splits) ? run.splits : [];
  let fastest = null;
  for (const split of splits) {
    if (
      Number(split.distanceMeters) >= 999 &&
      Number.isFinite(split.paceSecondsPerKilometer) &&
      split.paceSecondsPerKilometer > 0
    ) {
      if (!fastest || split.paceSecondsPerKilometer < fastest.paceSecondsPerKilometer) {
        fastest = split;
      }
    }
  }
  return fastest;
}
