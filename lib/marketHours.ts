// US equity market hours (NYSE / Nasdaq) — regular session.
// 9:30 AM – 4:00 PM ET, Monday through Friday.
// Holidays are NOT modeled here; v1 ignores them.

const ET_OPEN_MIN = 9 * 60 + 30; // 09:30 -> 570
const ET_CLOSE_MIN = 16 * 60; // 16:00 -> 960
const DAY_MIN = 24 * 60;

const DAYS_ORDERED = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type Weekday = (typeof DAYS_ORDERED)[number];

function isWeekday(d: Weekday): boolean {
  return d !== "Sat" && d !== "Sun";
}

function nextDay(d: Weekday): Weekday {
  const i = DAYS_ORDERED.indexOf(d);
  return DAYS_ORDERED[(i + 1) % 7];
}

type EtParts = {
  weekday: Weekday;
  hour: number;
  minute: number;
};

function getEtParts(now: Date): EtParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value as Weekday;
  const hourRaw = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  // `hour12: false` can return "24" for midnight in some locales.
  const hour = Number(hourRaw) % 24;
  return { weekday, hour, minute };
}

export type MarketStatus = {
  open: boolean;
  minutesUntilChange: number;
  nextOpenWeekday: Weekday | null;
};

export function getMarketStatus(now: Date = new Date()): MarketStatus {
  const { weekday, hour, minute } = getEtParts(now);
  const mins = hour * 60 + minute;

  if (isWeekday(weekday) && mins >= ET_OPEN_MIN && mins < ET_CLOSE_MIN) {
    return {
      open: true,
      minutesUntilChange: ET_CLOSE_MIN - mins,
      nextOpenWeekday: null,
    };
  }

  // Closed.
  // Case A: same weekday, pre-9:30 → opens this morning.
  if (isWeekday(weekday) && mins < ET_OPEN_MIN) {
    return {
      open: false,
      minutesUntilChange: ET_OPEN_MIN - mins,
      nextOpenWeekday: weekday,
    };
  }

  // Case B: rolled past close OR weekend → walk forward.
  let until = DAY_MIN - mins; // minutes from now to end of "today" (ET)
  let cursor = nextDay(weekday);
  while (!isWeekday(cursor)) {
    until += DAY_MIN;
    cursor = nextDay(cursor);
  }
  until += ET_OPEN_MIN; // minutes from start of that weekday to 9:30
  return {
    open: false,
    minutesUntilChange: until,
    nextOpenWeekday: cursor,
  };
}

const WEEKDAY_LONG: Record<Weekday, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

export function formatOpenCountdown(status: MarketStatus): string {
  if (status.open) {
    // Show time until close: "Closes in 2h 15m"
    const m = status.minutesUntilChange;
    return `Closes in ${formatDuration(m)}`;
  }
  const m = status.minutesUntilChange;
  if (m < 24 * 60) {
    return `Opens in ${formatDuration(m)}`;
  }
  // Multi-day wait — show the weekday name instead of a long "in 64h".
  const day = status.nextOpenWeekday
    ? WEEKDAY_LONG[status.nextOpenWeekday]
    : "soon";
  return `Opens ${day} 9:30 ET`;
}

function formatDuration(totalMinutes: number): string {
  if (totalMinutes < 1) return "<1m";
  if (totalMinutes < 60) return `${Math.round(totalMinutes)}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
