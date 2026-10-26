// Sentiment aggregation (SPEC-SENTIMENT §2): the single place the S formula lives; the frontend
// only displays what these readers return. Coverage = public publications of the day (Beijing
// calendar date of published_at, falling back to timeline_at); effective = those with a sentiment
// row. A theme may overlap: an item in two topics counts in both themes' own tallies.
import { sql } from "../db.ts";
import { beijingDate } from "@aihot/contracts/time";
import { TOPICS, topicMembership } from "./topics.ts";

export const GRADE_WEIGHTS = { S: 4, A: 3, B: 2, C: 1 } as const;
export type SentimentDir = "POS" | "NEG" | "NEU";
export type ImpactGrade = "S" | "A" | "B" | "C";
export const DIR_VALUE: Record<SentimentDir, number> = { POS: 1, NEU: 0, NEG: -1 };

export const SENTIMENT_NOTICE = {
  temp: true,
  position: "立场待确认",
  disclaimer: "情绪统计，非交易信号，不构成仓位建议",
  legend: "块色按主方向加权多数（红=利多、绿=利空、黄=中性），颜色深浅表示块内加权票总量；本站命中红与此处利多红语义不同，图例明示。",
};

export interface ScoredRow {
  dir: SentimentDir;
  conf: number;
  grade: ImpactGrade;
}

export interface SentimentStats {
  /** Weighted mean, two decimals; null when no effective rows. */
  s: number | null;
  totalWeight: number;
  counts: Record<SentimentDir, number>;
  /** Count shares, one decimal, summing to exactly 100. */
  shares: Record<SentimentDir, number>;
  dominant: SentimentDir | null;
}

export function aggregateSentiment(rows: ScoredRow[]): SentimentStats {
  const counts: Record<SentimentDir, number> = { POS: 0, NEG: 0, NEU: 0 };
  const weightByDir: Record<SentimentDir, number> = { POS: 0, NEG: 0, NEU: 0 };
  let weighted = 0;
  let totalWeight = 0;
  for (const row of rows) {
    const w = row.conf * GRADE_WEIGHTS[row.grade];
    counts[row.dir] += 1;
    weightByDir[row.dir] += w;
    weighted += DIR_VALUE[row.dir] * w;
    totalWeight += w;
  }
  const total = rows.length;
  const shares = { POS: 0, NEG: 0, NEU: 0 } as Record<SentimentDir, number>;
  if (total > 0) {
    // Largest-remainder rounding so the three shares sum to exactly 100.0.
    const raw = (Object.keys(counts) as SentimentDir[]).map((d) => ({ d, v: (counts[d] / total) * 100 }));
    const floored = raw.map((r) => ({ ...r, f: Math.floor(r.v * 10) / 10 }));
    let remainder = Math.round((100 - floored.reduce((a, r) => a + r.f, 0)) * 10);
    const order = [...floored].sort((a, b) => b.v - b.f - (a.v - a.f));
    for (const r of order) {
      if (remainder <= 0) break;
      r.f += 0.1;
      remainder -= 1;
    }
    for (const r of floored) shares[r.d] = Math.round(r.f * 10) / 10;
  }
  let dominant: SentimentDir | null = null;
  for (const d of ["POS", "NEU", "NEG"] as SentimentDir[]) {
    if (total > 0 && (dominant === null || weightByDir[d] > weightByDir[dominant])) dominant = d;
  }
  return {
    s: totalWeight > 0 ? Math.round((weighted / totalWeight) * 100) / 100 : null,
    totalWeight: Math.round(totalWeight * 100) / 100,
    counts,
    shares,
    dominant,
  };
}

export interface DayAggregate extends SentimentStats {
  date: string;
  coverage: number;
  effective: number;
  participationRate: number;
  marginal: number | null;
  insufficient: boolean;
  note: string | null;
}

interface DayRow {
  id: string;
  dir: SentimentDir | null;
  conf: number | null;
  grade: ImpactGrade | null;
}

async function loadDayRows(date: string): Promise<DayRow[]> {
  return sql<DayRow[]>`
    SELECT p.article_id AS id, s.sentiment_dir AS dir, s.sentiment_conf::float8 AS conf, s.impact_grade AS grade
      FROM publications p LEFT JOIN sentiment_scores s ON s.article_id = p.article_id
     WHERE p.visibility = 'public'
       AND to_char(timezone('Asia/Shanghai', coalesce(p.published_at, p.timeline_at)), 'YYYY-MM-DD') = ${date}`;
}

function prevDay(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
}

async function dayS(date: string): Promise<number | null> {
  const rows = await loadDayRows(date);
  const scored = rows.filter((r): r is DayRow & { dir: SentimentDir; conf: number; grade: ImpactGrade } => r.dir !== null && r.conf !== null && r.grade !== null);
  return aggregateSentiment(scored).s;
}

export async function loadDayAggregate(date: string): Promise<DayAggregate> {
  const rows = await loadDayRows(date);
  const scored = rows.filter((r): r is DayRow & { dir: SentimentDir; conf: number; grade: ImpactGrade } => r.dir !== null && r.conf !== null && r.grade !== null);
  const stats = aggregateSentiment(scored);
  const effective = scored.length;
  const prev = await dayS(prevDay(date));
  const marginal = stats.s !== null && prev !== null ? Math.round((stats.s - prev) * 100) / 100 : null;
  return {
    date,
    coverage: rows.length,
    effective,
    participationRate: rows.length > 0 ? Math.round((effective / rows.length) * 1000) / 1000 : 0,
    marginal,
    insufficient: effective < 5,
    note: effective < 5 ? "有效样本不足" : null,
    ...stats,
  };
}

export interface TopicAggregate extends SentimentStats {
  slug: string;
  name: string;
  count: number;
  effective: number;
  marginal: number | null;
  insufficient: boolean;
  note: string | null;
  /** Treemap depth tier: 3 = largest weighted votes, 1 = smallest (tertiles of the day's themes). */
  tier: 1 | 2 | 3;
}

interface ThemeRow extends DayRow {
  topics: string[];
}

export async function loadTopicAggregates(date: string): Promise<TopicAggregate[]> {
  const rows = await sql<ThemeRow[]>`
    SELECT p.article_id AS id, ${topicMembership()} AS topics, s.sentiment_dir AS dir, s.sentiment_conf::float8 AS conf, s.impact_grade AS grade
      FROM publications p LEFT JOIN sentiment_scores s ON s.article_id = p.article_id
     WHERE p.visibility = 'public'
       AND to_char(timezone('Asia/Shanghai', coalesce(p.published_at, p.timeline_at)), 'YYYY-MM-DD') = ${date}`;
  const bySlug = new Map<string, ThemeRow[]>();
  for (const row of rows) {
    for (const slug of row.topics ?? []) {
      const list = bySlug.get(slug) ?? [];
      list.push(row);
      bySlug.set(slug, list);
    }
  }
  const names = new Map(TOPICS.map((t) => [t.slug, t.name]));
  const out: TopicAggregate[] = [];
  for (const [slug, members] of bySlug) {
    const scored = members.filter((r): r is ThemeRow & { dir: SentimentDir; conf: number; grade: ImpactGrade } => r.dir !== null && r.conf !== null && r.grade !== null);
    const stats = aggregateSentiment(scored);
    const prevRows = await sql<ThemeRow[]>`
      SELECT p.article_id AS id, ${topicMembership()} AS topics, s.sentiment_dir AS dir, s.sentiment_conf::float8 AS conf, s.impact_grade AS grade
        FROM publications p LEFT JOIN sentiment_scores s ON s.article_id = p.article_id
       WHERE p.visibility = 'public'
         AND to_char(timezone('Asia/Shanghai', coalesce(p.published_at, p.timeline_at)), 'YYYY-MM-DD') = ${prevDay(date)}
         AND ${slug} = ANY(${topicMembership()})`;
    const prevScored = prevRows.filter((r): r is ThemeRow & { dir: SentimentDir; conf: number; grade: ImpactGrade } => r.dir !== null && r.conf !== null && r.grade !== null);
    const prevS = aggregateSentiment(prevScored).s;
    out.push({
      slug,
      name: names.get(slug) ?? slug,
      count: members.length,
      effective: scored.length,
      marginal: stats.s !== null && prevS !== null ? Math.round((stats.s - prevS) * 100) / 100 : null,
      insufficient: scored.length < 5,
      note: scored.length < 5 ? "有效样本不足" : null,
      tier: 1,
      ...stats,
    });
  }
  out.sort((a, b) => b.totalWeight - a.totalWeight);
  const n = out.length;
  out.forEach((t, i) => {
    t.tier = i < Math.ceil(n / 3) ? 3 : i < Math.ceil((2 * n) / 3) ? 2 : 1;
  });
  return out;
}

export interface CalendarDay {
  date: string;
  hasData: boolean;
  count: number;
  dominant: SentimentDir | null;
  arrow: "↑" | "↓" | "→" | null;
  shares: Record<SentimentDir, number>;
  note: string | null;
}

export async function loadCalendar(month: string): Promise<CalendarDay[]> {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y!, m!, 0).getDate();
  const rows = await sql<{ date: string; dir: SentimentDir | null; conf: number | null; grade: ImpactGrade | null }[]>`
    SELECT to_char(timezone('Asia/Shanghai', coalesce(p.published_at, p.timeline_at)), 'YYYY-MM-DD') AS date,
           s.sentiment_dir AS dir, s.sentiment_conf::float8 AS conf, s.impact_grade AS grade
      FROM publications p LEFT JOIN sentiment_scores s ON s.article_id = p.article_id
     WHERE p.visibility = 'public'
       AND to_char(timezone('Asia/Shanghai', coalesce(p.published_at, p.timeline_at)), 'YYYY-MM') = ${month}`;
  const byDate = new Map<string, ScoredRow[]>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.date, (counts.get(row.date) ?? 0) + 1);
    if (row.dir !== null && row.conf !== null && row.grade !== null) {
      const list = byDate.get(row.date) ?? [];
      list.push({ dir: row.dir, conf: row.conf, grade: row.grade });
      byDate.set(row.date, list);
    }
  }
  const arrow = (d: SentimentDir | null): "↑" | "↓" | "→" | null => (d === "POS" ? "↑" : d === "NEG" ? "↓" : d === "NEU" ? "→" : null);
  const days: CalendarDay[] = [];
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const count = counts.get(date) ?? 0;
    const stats = aggregateSentiment(byDate.get(date) ?? []);
    days.push({
      date,
      hasData: count > 0,
      count,
      dominant: stats.dominant,
      arrow: arrow(stats.dominant),
      shares: stats.shares,
      note: count === 0 ? "暂无数据" : null,
    });
  }
  return days;
}

export function todayBeijing(): string {
  return beijingDate(new Date());
}
