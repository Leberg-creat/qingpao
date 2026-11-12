import { startOfWeek } from "./geo.js";

const WEEK_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, "0");
}

export function localDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function weekSerial(dateLike) {
  const monday = startOfWeek(new Date(dateLike));
  return Math.floor(
    Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()) /
      WEEK_MILLISECONDS,
  );
}

function sortedRuns(runs) {
  return [...runs].sort(
    (first, second) => Number(first.startedAt) - Number(second.startedAt),
  );
}

function longestActiveWeekRun(runs) {
  const weeks = new Set(runs.map((run) => weekSerial(run.startedAt)));
  const serials = [...weeks].sort((first, second) => first - second);
  let longest = 0;
  let current = 0;
  let previous = null;
  for (const serial of serials) {
    current = previous !== null && serial === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = serial;
  }
  return longest;
}

export function yearSummary(runs, now = new Date()) {
  const year = now.getFullYear();
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  const yearRuns = runs.filter((run) => {
    const startedAt = Number(run.startedAt);
    return startedAt >= start && startedAt < end;
  });
  const activeDays = new Set(yearRuns.map((run) => localDateKey(run.startedAt)));
  return {
    year,
    runs: yearRuns.length,
    activeDays: activeDays.size,
    distanceMeters: yearRuns.reduce(
      (sum, run) => sum + Math.max(0, Number(run.distanceMeters) || 0),
      0,
    ),
    longestWeekRun: longestActiveWeekRun(yearRuns),
  };
}

export function calendarMonth(runs, year, month) {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 1);
  const monthRuns = runs
    .filter((run) => {
      const startedAt = Number(run.startedAt);
      return startedAt >= monthStart.getTime() && startedAt < monthEnd.getTime();
    })
    .sort((first, second) => first.startedAt - second.startedAt);
  const runsByDay = new Map();
  for (const run of monthRuns) {
    const key = localDateKey(run.startedAt);
    if (!runsByDay.has(key)) {
      runsByDay.set(key, []);
    }
    runsByDay.get(key).push(run);
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekdayOffset = (monthStart.getDay() + 6) % 7;
  const days = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const key = localDateKey(date);
    const dayRuns = runsByDay.get(key) || [];
    days.push({
      day,
      dateKey: key,
      runs: dayRuns,
      count: dayRuns.length,
      distanceMeters: dayRuns.reduce(
        (sum, run) => sum + Math.max(0, Number(run.distanceMeters) || 0),
        0,
      ),
      hasRuns: dayRuns.length > 0,
    });
  }

  const activeDays = days.filter((day) => day.hasRuns);
  return {
    year,
    month,
    firstWeekdayOffset,
    days,
    summary: {
      activeDays: activeDays.length,
      count: monthRuns.length,
      distanceMeters: monthRuns.reduce(
        (sum, run) => sum + Math.max(0, Number(run.distanceMeters) || 0),
        0,
      ),
    },
  };
}

export function calendarMonthBounds(runs, now = new Date()) {
  const sorted = sortedRuns(runs);
  if (sorted.length === 0) {
    return {
      earliest: { year: now.getFullYear(), month: now.getMonth() },
      latest: { year: now.getFullYear(), month: now.getMonth() },
    };
  }
  const first = new Date(sorted[0].startedAt);
  return {
    earliest: { year: first.getFullYear(), month: first.getMonth() },
    latest: { year: now.getFullYear(), month: now.getMonth() },
  };
}

function findRunByCount(runs, count) {
  return runs.length >= count ? runs[count - 1] : null;
}

function findFirstSingleDistance(runs, targetMeters) {
  return runs.find((run) => Number(run.distanceMeters) >= targetMeters) || null;
}

function findCumulativeDistance(runs, targetMeters) {
  let total = 0;
  for (const run of runs) {
    total += Math.max(0, Number(run.distanceMeters) || 0);
    if (total >= targetMeters) {
      return { run, total };
    }
  }
  return { run: null, total };
}

function weeklyRunGroups(runs) {
  const groups = new Map();
  for (const run of runs) {
    const serial = weekSerial(run.startedAt);
    if (!groups.has(serial)) {
      groups.set(serial, []);
    }
    groups.get(serial).push(run);
  }
  return [...groups.entries()]
    .sort(([first], [second]) => first - second)
    .map(([serial, weekRuns]) => ({ serial, runs: weekRuns }));
}

function weeklyCountMilestone(runs, minimumRuns) {
  let maximum = 0;
  let trigger = null;
  for (const week of weeklyRunGroups(runs)) {
    maximum = Math.max(maximum, week.runs.length);
    if (!trigger && week.runs.length >= minimumRuns) {
      trigger = week.runs[minimumRuns - 1];
    }
  }
  return { current: maximum, trigger };
}

function weeklySequenceMilestone(runs, weekCount, runsPerWeek) {
  let best = 0;
  let current = 0;
  let previousSerial = null;
  let trigger = null;
  for (const week of weeklyRunGroups(runs)) {
    const qualifies = week.runs.length >= runsPerWeek;
    if (!qualifies) {
      current = 0;
      previousSerial = week.serial;
      continue;
    }
    current = previousSerial !== null && week.serial === previousSerial + 1 ? current + 1 : 1;
    best = Math.max(best, current);
    previousSerial = week.serial;
    if (!trigger && current >= weekCount) {
      trigger = week.runs[runsPerWeek - 1];
    }
  }
  return { current: best, trigger };
}

function buildAchievement(definition, current, target, triggerRun) {
  return {
    ...definition,
    current,
    target,
    progressRatio: Math.min(1, target > 0 ? current / target : 0),
    unlocked: Boolean(triggerRun),
    unlockedAt: triggerRun ? Number(triggerRun.startedAt) : null,
    runId: triggerRun?.id || null,
  };
}

export function calculateAchievements(runs) {
  const sorted = sortedRuns(runs);
  const runCount = sorted.length;
  const totalDistance = sorted.reduce(
    (sum, run) => sum + Math.max(0, Number(run.distanceMeters) || 0),
    0,
  );
  const maximumDistance = sorted.reduce(
    (maximum, run) => Math.max(maximum, Number(run.distanceMeters) || 0),
    0,
  );
  const weeklyThree = weeklyCountMilestone(sorted, 3);
  const weeklySequence = weeklySequenceMilestone(sorted, 4, 2);
  const cumulativeFifty = findCumulativeDistance(sorted, 50_000);

  return [
    buildAchievement(
      {
        id: "first-run",
        title: "初次起跑",
        description: "完成第 1 次跑步",
        category: "start",
        icon: "i-play",
        unit: "次",
      },
      Math.min(runCount, 1),
      1,
      findRunByCount(sorted, 1),
    ),
    buildAchievement(
      {
        id: "ten-runs",
        title: "十次出发",
        description: "累计完成 10 次跑步",
        category: "count",
        icon: "i-route",
        unit: "次",
      },
      Math.min(runCount, 10),
      10,
      findRunByCount(sorted, 10),
    ),
    buildAchievement(
      {
        id: "five-kilometers",
        title: "五公里突破",
        description: "单次跑步达到 5 公里",
        category: "distance",
        icon: "i-navigation",
        unit: "km",
      },
      Math.min(maximumDistance, 5000),
      5000,
      findFirstSingleDistance(sorted, 5000),
    ),
    buildAchievement(
      {
        id: "fifty-kilometers",
        title: "五十公里",
        description: "累计跑步达到 50 公里",
        category: "distance",
        icon: "i-trophy",
        unit: "km",
      },
      Math.min(totalDistance, 50_000),
      50_000,
      cumulativeFifty.run,
    ),
    buildAchievement(
      {
        id: "three-run-week",
        title: "一周三跑",
        description: "同一自然周完成 3 次跑步",
        category: "rhythm",
        icon: "i-calendar",
        unit: "次",
      },
      Math.min(weeklyThree.current, 3),
      3,
      weeklyThree.trigger,
    ),
    buildAchievement(
      {
        id: "four-week-rhythm",
        title: "四周节奏",
        description: "连续 4 周每周至少跑步 2 次",
        category: "rhythm",
        icon: "i-target",
        unit: "周",
      },
      Math.min(weeklySequence.current, 4),
      4,
      weeklySequence.trigger,
    ),
  ];
}

export function newlyUnlockedAchievements(beforeRuns, afterRuns) {
  const beforeIds = new Set(
    calculateAchievements(beforeRuns)
      .filter((achievement) => achievement.unlocked)
      .map((achievement) => achievement.id),
  );
  return calculateAchievements(afterRuns).filter(
    (achievement) => achievement.unlocked && !beforeIds.has(achievement.id),
  );
}

export function achievementDateLabel(value) {
  if (!Number.isFinite(Number(value))) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(Number(value)));
}

