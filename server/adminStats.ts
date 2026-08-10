import { todayKey } from './usageDay';
import { listUsers } from './userStore';

export type SeriesPoint = {
  date: string;
  value: number;
};

export type AdminStats = {
  generatedAt: number;
  todayKey: string;
  totalUsers: number;
  todayRegistrations: number;
  dau: number;
  mau: number;
  sponsorshipTotal: number;
  sponsorshipCount: number;
  /** Last 20 days registration counts by day */
  registrationDaily: SeriesPoint[];
  /** Last 12 months registration counts by month (YYYY-MM) */
  registrationMonthly: SeriesPoint[];
  /** Last 5 years registration counts by year (YYYY) */
  registrationYearly: SeriesPoint[];
  /** Last 20 days active users (by lastActiveAt/lastLoginAt) */
  activeDaily: SeriesPoint[];
  /** Last 12 months active users */
  activeMonthly: SeriesPoint[];
  /** Last 5 years active users */
  activeYearly: SeriesPoint[];
  /** Last 20 days sponsorship amount by day */
  sponsorshipDaily: SeriesPoint[];
  /** Last 12 months sponsorship amount by month */
  sponsorshipMonthly: SeriesPoint[];
  /** Last 5 years sponsorship amount by year */
  sponsorshipYearly: SeriesPoint[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse YYYY-MM-DD (CST calendar key) to UTC ms at local CST midnight approx. */
function dayKeyToStartMs(key: string): number {
  // Treat as CST (+8): Date.parse of 'YYYY-MM-DDT00:00:00+08:00'
  return Date.parse(`${key}T00:00:00+08:00`);
}

function addDaysKey(key: string, delta: number): string {
  const t = dayKeyToStartMs(key) + delta * DAY_MS;
  return todayKey(t);
}

function monthKeyFromDay(day: string): string {
  return day.slice(0, 7);
}

function yearKeyFromDay(day: string): string {
  return day.slice(0, 4);
}

function addMonthsKey(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

function addYearsKey(year: string, delta: number): string {
  return String(Number(year) + delta);
}

function dayKeyFromTs(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return '';
  return todayKey(ts);
}

function emptySeriesDaily(endDay: string, days: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push({ date: addDaysKey(endDay, -i), value: 0 });
  }
  return out;
}

function emptySeriesMonthly(endMonth: string, months: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    out.push({ date: addMonthsKey(endMonth, -i), value: 0 });
  }
  return out;
}

function emptySeriesYearly(endYear: string, years: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = years - 1; i >= 0; i--) {
    out.push({ date: addYearsKey(endYear, -i), value: 0 });
  }
  return out;
}

function bump(map: Map<string, number>, key: string, by = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + by);
}

function fillSeries(
  empty: SeriesPoint[],
  map: Map<string, number>,
): SeriesPoint[] {
  return empty.map((p) => ({ date: p.date, value: map.get(p.date) || 0 }));
}

/**
 * Aggregate admin dashboard metrics from the user store.
 * Activity uses lastActiveAt (preferred) or lastLoginAt.
 */
export async function buildAdminStats(): Promise<AdminStats> {
  const users = await listUsers();
  const day = todayKey();
  const month = monthKeyFromDay(day);
  const year = yearKeyFromDay(day);
  const dayStart = dayKeyToStartMs(day);
  // Approx end of rolling 30d / MAU window
  const dauStart = dayStart;
  const mauStart = dayStart - 29 * DAY_MS;

  let todayRegistrations = 0;
  let dau = 0;
  let mau = 0;
  let sponsorshipTotal = 0;
  let sponsorshipCount = 0;

  const regDay = new Map<string, number>();
  const regMonth = new Map<string, number>();
  const regYear = new Map<string, number>();
  const actDay = new Map<string, number>();
  const actMonth = new Map<string, number>();
  const actYear = new Map<string, number>();
  const payDay = new Map<string, number>();
  const payMonth = new Map<string, number>();
  const payYear = new Map<string, number>();

  // For DAU/MAU unique users we only need set membership in windows;
  // for series we count unique users per bucket via Sets.
  const actDaySets = new Map<string, Set<string>>();
  const actMonthSets = new Map<string, Set<string>>();
  const actYearSets = new Map<string, Set<string>>();

  const ensureSet = (map: Map<string, Set<string>>, key: string) => {
    let s = map.get(key);
    if (!s) {
      s = new Set();
      map.set(key, s);
    }
    return s;
  };

  for (const u of users) {
    const createdDay = dayKeyFromTs(u.createdAt);
    if (createdDay === day) todayRegistrations += 1;
    bump(regDay, createdDay);
    if (createdDay) {
      bump(regMonth, monthKeyFromDay(createdDay));
      bump(regYear, yearKeyFromDay(createdDay));
    }

    const activeAt = Number(u.lastActiveAt) || Number(u.lastLoginAt) || 0;
    if (activeAt >= dauStart) dau += 1;
    if (activeAt >= mauStart) mau += 1;

    if (activeAt > 0) {
      const ad = dayKeyFromTs(activeAt);
      const am = monthKeyFromDay(ad);
      const ay = yearKeyFromDay(ad);
      ensureSet(actDaySets, ad).add(u.id);
      ensureSet(actMonthSets, am).add(u.id);
      ensureSet(actYearSets, ay).add(u.id);
    }

    for (const s of u.sponsorships || []) {
      const amt = Number(s.amount) || 0;
      if (amt <= 0) continue;
      sponsorshipTotal += amt;
      sponsorshipCount += 1;
      const sd = dayKeyFromTs(s.createdAt);
      bump(payDay, sd, amt);
      if (sd) {
        bump(payMonth, monthKeyFromDay(sd), amt);
        bump(payYear, yearKeyFromDay(sd), amt);
      }
    }
  }

  for (const [k, set] of actDaySets) actDay.set(k, set.size);
  for (const [k, set] of actMonthSets) actMonth.set(k, set.size);
  for (const [k, set] of actYearSets) actYear.set(k, set.size);

  // Round money to 2 decimals
  sponsorshipTotal = Math.round(sponsorshipTotal * 100) / 100;
  for (const [k, v] of payDay) payDay.set(k, Math.round(v * 100) / 100);
  for (const [k, v] of payMonth) payMonth.set(k, Math.round(v * 100) / 100);
  for (const [k, v] of payYear) payYear.set(k, Math.round(v * 100) / 100);

  return {
    generatedAt: Date.now(),
    todayKey: day,
    totalUsers: users.length,
    todayRegistrations,
    dau,
    mau,
    sponsorshipTotal,
    sponsorshipCount,
    registrationDaily: fillSeries(emptySeriesDaily(day, 20), regDay),
    registrationMonthly: fillSeries(emptySeriesMonthly(month, 12), regMonth),
    registrationYearly: fillSeries(emptySeriesYearly(year, 5), regYear),
    activeDaily: fillSeries(emptySeriesDaily(day, 20), actDay),
    activeMonthly: fillSeries(emptySeriesMonthly(month, 12), actMonth),
    activeYearly: fillSeries(emptySeriesYearly(year, 5), actYear),
    sponsorshipDaily: fillSeries(emptySeriesDaily(day, 20), payDay),
    sponsorshipMonthly: fillSeries(emptySeriesMonthly(month, 12), payMonth),
    sponsorshipYearly: fillSeries(emptySeriesYearly(year, 5), payYear),
  };
}
