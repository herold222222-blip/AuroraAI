import { useMemo, useState, type ReactNode } from 'react';
import type { AdminStats, AdminStatsSeriesPoint } from '../../api/authApi';

type ChartMode = 'day' | 'month' | 'year';

function formatMoney(n: number) {
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shortLabel(date: string, mode: ChartMode) {
  if (mode === 'year') return date;
  if (mode === 'month') {
    const [, m] = date.split('-');
    return `${Number(m)}月`;
  }
  const parts = date.split('-');
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

function modeTotalHint(mode: ChartMode) {
  if (mode === 'day') return '近20日合计';
  if (mode === 'month') return '近12月合计';
  return '近5年合计';
}

function pickSeries(
  mode: ChartMode,
  daily: AdminStatsSeriesPoint[],
  monthly: AdminStatsSeriesPoint[],
  yearly: AdminStatsSeriesPoint[] | undefined,
) {
  if (mode === 'day') return daily;
  if (mode === 'month') return monthly;
  return yearly || [];
}

function BarChart({
  title,
  subtitle,
  series,
  mode,
  unit = 'count',
  toolbar,
}: {
  title: string;
  subtitle?: string;
  series: AdminStatsSeriesPoint[];
  mode: ChartMode;
  unit?: 'count' | 'money';
  toolbar?: ReactNode;
}) {
  const max = Math.max(1, ...series.map((p) => p.value));
  const total = series.reduce((s, p) => s + p.value, 0);
  const [hover, setHover] = useState<AdminStatsSeriesPoint | null>(null);

  return (
    <section className="admin-chart-card">
      <header className="admin-chart-head">
        <div className="admin-chart-head-main">
          <div className="admin-chart-title-row">
            <h3>{title}</h3>
            {toolbar}
          </div>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="admin-chart-total">
          {unit === 'money' ? `¥${formatMoney(total)}` : `${total}`}
          <span>{modeTotalHint(mode)}</span>
        </div>
      </header>
      <div
        className={`admin-chart-bars${mode === 'day' ? ' is-daily' : ''}`}
        role="img"
        aria-label={title}
      >
        {series.map((p) => {
          const h = Math.max(2, Math.round((p.value / max) * 100));
          return (
            <button
              key={p.date}
              type="button"
              className={`admin-chart-bar${hover?.date === p.date ? ' is-hot' : ''}`}
              style={{ height: `${h}%` }}
              title={`${p.date}: ${unit === 'money' ? `¥${formatMoney(p.value)}` : p.value}`}
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(p)}
              onBlur={() => setHover(null)}
            >
              <span className="admin-chart-bar-label">
                {shortLabel(p.date, mode)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="admin-chart-tip">
        {hover
          ? `${hover.date} · ${
              unit === 'money' ? `¥${formatMoney(hover.value)}` : `${hover.value}`
            }`
          : '悬停柱条查看明细'}
      </div>
    </section>
  );
}

function ModeSeg({
  mode,
  onChange,
  dayLabel,
  monthLabel,
  yearLabel,
}: {
  mode: ChartMode;
  onChange: (m: ChartMode) => void;
  dayLabel: string;
  monthLabel: string;
  yearLabel: string;
}) {
  return (
    <div className="admin-seg">
      <button
        type="button"
        className={mode === 'day' ? 'active' : ''}
        onClick={() => onChange('day')}
      >
        {dayLabel}
      </button>
      <button
        type="button"
        className={mode === 'month' ? 'active' : ''}
        onClick={() => onChange('month')}
      >
        {monthLabel}
      </button>
      <button
        type="button"
        className={mode === 'year' ? 'active' : ''}
        onClick={() => onChange('year')}
      >
        {yearLabel}
      </button>
    </div>
  );
}

export function AdminStatsPanel({ stats }: { stats: AdminStats }) {
  const [regMode, setRegMode] = useState<ChartMode>('day');
  const [actMode, setActMode] = useState<ChartMode>('day');
  const [payMode, setPayMode] = useState<ChartMode>('day');

  const cards = useMemo(
    () => [
      {
        label: '今日注册',
        value: String(stats.todayRegistrations),
        hint: stats.todayKey,
      },
      {
        label: '总用户数',
        value: String(stats.totalUsers),
        hint: '含管理员',
      },
      {
        label: '日活跃 (DAU)',
        value: String(stats.dau),
        hint: '今日有登录/使用',
      },
      {
        label: '月活跃 (MAU)',
        value: String(stats.mau),
        hint: '近 30 日有活跃',
      },
      {
        label: '打赏总额',
        value: `¥${formatMoney(stats.sponsorshipTotal)}`,
        hint: `${stats.sponsorshipCount} 笔`,
      },
    ],
    [stats],
  );

  const actTitle =
    actMode === 'day'
      ? '日活跃用户'
      : actMode === 'month'
        ? '月活跃用户'
        : '年活跃用户';

  return (
    <div className="admin-stats">
      <div className="admin-stat-cards">
        {cards.map((c) => (
          <div key={c.label} className="admin-stat-card">
            <span>{c.label}</span>
            <strong>{c.value}</strong>
            <em>{c.hint}</em>
          </div>
        ))}
      </div>

      <div className="admin-chart-grid">
        <BarChart
          title="注册人数增长"
          subtitle={
            regMode === 'day'
              ? '近 20 日每日新增注册'
              : regMode === 'month'
                ? '近 12 个月每月新增注册'
                : '近 5 年每年新增注册'
          }
          series={pickSeries(
            regMode,
            stats.registrationDaily,
            stats.registrationMonthly,
            stats.registrationYearly,
          )}
          mode={regMode}
          toolbar={
            <ModeSeg
              mode={regMode}
              onChange={setRegMode}
              dayLabel="按日"
              monthLabel="按月"
              yearLabel="按年"
            />
          }
        />
        <BarChart
          title={actTitle}
          subtitle={
            actMode === 'day'
              ? '按最后活跃日落在该日统计'
              : actMode === 'month'
                ? '按最后活跃月统计'
                : '按最后活跃年统计'
          }
          series={pickSeries(
            actMode,
            stats.activeDaily,
            stats.activeMonthly,
            stats.activeYearly,
          )}
          mode={actMode}
          toolbar={
            <ModeSeg
              mode={actMode}
              onChange={setActMode}
              dayLabel="日活跃"
              monthLabel="月活跃"
              yearLabel="年活跃"
            />
          }
        />
        <BarChart
          title="打赏金额增长"
          subtitle={
            payMode === 'day'
              ? '近 20 日打赏金额'
              : payMode === 'month'
                ? '近 12 个月打赏金额'
                : '近 5 年打赏金额'
          }
          series={pickSeries(
            payMode,
            stats.sponsorshipDaily,
            stats.sponsorshipMonthly,
            stats.sponsorshipYearly,
          )}
          mode={payMode}
          unit="money"
          toolbar={
            <ModeSeg
              mode={payMode}
              onChange={setPayMode}
              dayLabel="按日"
              monthLabel="按月"
              yearLabel="按年"
            />
          }
        />
      </div>
    </div>
  );
}
