import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Download, MoreHorizontal } from 'lucide-react';
import { useFormat, useSettings } from '@/app/context';
import { useImageOwners, useLedger } from '@/app/data';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, KeyValue, Section, Stat } from '@/components/ui/card';
import { Menu } from '@/components/ui/segmented';
import { Select } from '@/components/ui/field';
import { MoneyTone, PROJECT_TYPE_LABEL } from '@/components/ui/badge';
import { BarList, MonthlyColumns } from '@/components/charts/charts';
import { buildReport, inventorySnapshot } from '@/lib/stats';
import { saleNet } from '@/lib/calc';
import { csvBlob } from '@/lib/csv';
import { formatMonth, inRange, PERIOD_LABELS, periodRange, today, type PeriodKey } from '@/lib/dates';
import { downloadBlob, titleCase } from '@/lib/utils';
import type { ProjectType } from '@/db/schema';

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const period = (params.get('period') as PeriodKey) || '12m';
  const data = useLedger();
  const owners = useImageOwners();
  const settings = useSettings();
  const f = useFormat();
  const [showTable, setShowTable] = useState(false);
  const range = useMemo(() => periodRange(period), [period]);
  const platformName = useCallback(
    (id: string) => settings.platforms.find((p) => p.id === id)?.name ?? id,
    [settings.platforms],
  );

  const report = useMemo(
    () => (data ? buildReport(data.ds, data.ledger, range, platformName) : null),
    [data, range, platformName],
  );
  const snap = useMemo(
    () => (data && owners ? inventorySnapshot(data.ds, data.ledger, settings, owners) : null),
    [data, owners, settings],
  );

  if (!data || !report || !snap) return null;

  const exportSales = () => {
    const items = new Map(data.ds.items.map((i) => [i.id, i]));
    const rows = data.ds.sales
      .filter((s) => inRange(s.date, range.from, range.to))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => {
        const it = items.get(s.itemId);
        const n = saleNet(s);
        const cogs = (data.ledger.items.get(s.itemId)?.unitCost ?? 0) * s.quantity;
        return [
          s.date,
          it?.code,
          it?.name,
          it?.category,
          platformName(s.platform),
          s.quantity,
          s.price,
          s.shippingCharged,
          s.fees,
          s.shippingCost,
          n.net,
          cogs.toFixed(2),
          (n.net - cogs).toFixed(2),
          s.buyer,
        ];
      });
    downloadBlob(
      csvBlob(
        [
          'Date',
          'Item ID',
          'Item',
          'Category',
          'Platform',
          'Qty',
          'Price',
          'Shipping charged',
          'Fees',
          'Shipping cost',
          'Net proceeds',
          'Cost of goods',
          'Profit',
          'Buyer',
        ],
        rows,
      ),
      `flipper-sales-${range.from}-to-${range.to === '9999-12-31' ? today() : range.to}.csv`,
    );
  };

  const exportExpenses = () => {
    const rows = data.ds.expenses
      .filter((e) => inRange(e.date, range.from, range.to))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => {
        const owner =
          e.ownerType === 'item'
            ? data.ds.items.find((i) => i.id === e.ownerId)?.code
            : e.ownerType === 'project'
              ? data.ds.projects.find((p) => p.id === e.ownerId)?.code
              : 'General';
        return [e.date, e.label, titleCase(e.category), e.amount, owner ?? '', e.notes];
      });
    downloadBlob(
      csvBlob(['Date', 'Description', 'Category', 'Amount', 'For', 'Notes'], rows),
      `flipper-expenses-${today()}.csv`,
    );
  };

  const exportPnl = () => {
    const rows: (string | number)[][] = [
      [
        'Period',
        `${PERIOD_LABELS[period]} (${range.from} – ${range.to === '9999-12-31' ? today() : range.to})`,
      ],
      ['Currency', settings.currency],
      ['Revenue', report.revenue],
      ['Selling costs (fees + postage)', -report.sellingCosts],
      ['Cost of goods sold', -report.cogs],
      ['Gross profit', report.grossProfit],
      ['Business expenses', -report.generalExpenses],
      ['Write-offs', -report.writeOffs],
      ['Net profit', report.netProfit],
      ['Stock purchased in period', report.purchases],
    ];
    downloadBlob(csvBlob(['Line', 'Amount'], rows), `flipper-pnl-${today()}.csv`);
  };

  const chartData = report.monthly.slice(-24);

  return (
    <>
      <PageHeader
        title="Stats & reports"
        subtitle={PERIOD_LABELS[period]}
        actions={
          <Menu
            trigger={(t) => (
              <Button variant="ghost" size="icon" aria-label="Export" onClick={t}>
                <MoreHorizontal className="size-5" />
              </Button>
            )}
            items={[
              { label: 'Export sales (CSV)', icon: <Download />, onClick: exportSales },
              { label: 'Export expenses (CSV)', icon: <Download />, onClick: exportExpenses },
              { label: 'Export P&L summary (CSV)', icon: <Download />, onClick: exportPnl },
            ]}
          />
        }
      />
      <Page>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={period}
            onChange={(e) => setParams({ period: e.target.value }, { replace: true })}
            className="w-auto"
            aria-label="Period"
          >
            {Object.entries(PERIOD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Net profit"
            value={f.money(report.netProfit)}
            tone={report.netProfit >= 0 ? 'profit' : 'loss'}
            sub={`Margin ${f.pct(report.margin)}`}
            className="col-span-2 lg:col-span-1"
          />
          <Stat
            label="Revenue"
            value={f.money(report.revenue)}
            sub={`${report.salesCount} sales · ${report.unitsSold} units`}
          />
          <Stat label="Gross profit" value={f.money(report.grossProfit)} sub={`ROI ${f.pct(report.roi)}`} />
          <Stat
            label="Avg profit / sale"
            value={f.money(report.avgProfitPerSale)}
            sub={`Avg sale ${f.money(report.avgSale)}`}
          />
          <Stat label="Avg days to sell" value={report.avgDaysToSell ?? '—'} />
          <Stat label="Sell-through" value={f.pct(report.sellThrough)} sub="Units sold vs. sold + in stock" />
          <Stat label="Stock at cost" value={f.money(snap.costValue)} sub={`${snap.units} units`} />
          <Stat
            label="Stock potential profit"
            value={f.money(snap.potentialProfit)}
            tone={snap.potentialProfit >= 0 ? 'profit' : 'loss'}
            sub={`Est. value ${f.money(snap.estimatedValue)}`}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
          <Section
            title="Revenue and net profit by month"
            action={
              <Button size="sm" variant="ghost" onClick={() => setShowTable((s) => !s)}>
                {showTable ? 'Hide table' : 'Show table'}
              </Button>
            }
          >
            <MonthlyColumns
              data={chartData}
              series={[
                { key: 'revenue', label: 'Revenue', color: 'var(--series-1)' },
                { key: 'netProfit', label: 'Net profit', color: 'var(--series-2)' },
              ]}
            />
            {showTable && (
              <div className="mt-4 overflow-x-auto">
                <table className="tabular w-full text-sm">
                  <thead className="text-left text-xs text-subtle">
                    <tr>
                      <th className="py-1.5">Month</th>
                      <th className="py-1.5 text-right">Revenue</th>
                      <th className="py-1.5 text-right">Gross profit</th>
                      <th className="py-1.5 text-right">Expenses</th>
                      <th className="py-1.5 text-right">Net profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {chartData.map((m) => (
                      <tr key={m.month}>
                        <td className="py-1.5">{formatMonth(m.month, f.locale)}</td>
                        <td className="py-1.5 text-right">{f.money(m.revenue)}</td>
                        <td className="py-1.5 text-right">{f.money(m.grossProfit)}</td>
                        <td className="py-1.5 text-right">{f.money(m.expenses)}</td>
                        <td className="py-1.5 text-right">
                          <MoneyTone value={m.netProfit}>{f.money(m.netProfit)}</MoneyTone>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Profit & loss">
            <div className="divide-y divide-border">
              <KeyValue label="Revenue" value={f.money(report.revenue)} />
              <KeyValue label="Fees & postage" value={f.money(-report.sellingCosts)} />
              <KeyValue label="Cost of goods sold" value={f.money(-report.cogs)} />
              <KeyValue
                label={<b className="text-fg">Gross profit</b>}
                value={<b>{f.money(report.grossProfit)}</b>}
              />
              <KeyValue
                label={
                  <Link to="/expenses" className="hover:text-accent">
                    Business expenses
                  </Link>
                }
                value={f.money(-report.generalExpenses)}
              />
              <KeyValue label="Write-offs" value={f.money(-report.writeOffs)} />
              <KeyValue
                label={<b className="text-fg">Net profit</b>}
                value={
                  <MoneyTone value={report.netProfit} className="font-semibold">
                    {f.money(report.netProfit)}
                  </MoneyTone>
                }
              />
            </div>
            <p className="mt-3 text-xs text-subtle">
              Stock bought in this period: {f.money(report.purchases)}. Profit counts an item's cost when it
              sells (cost of goods sold), not when you buy it.
            </p>
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section title="Profit by category">
            <BarList
              rows={report.byCategory.map((b) => ({
                label: b.name,
                value: b.profit,
                sub: `${b.units} sold · ${f.money(b.revenue)} revenue`,
              }))}
              format={(n) => f.money(n)}
            />
          </Section>
          <Section title="Revenue by platform">
            <BarList
              rows={report.byPlatform.map((b) => ({
                label: b.name,
                value: b.revenue,
                sub: `${b.count} sales · profit ${f.money(b.profit)}`,
              }))}
              format={(n) => f.money(n)}
            />
          </Section>
          <Section title="Profit by project type">
            <BarList
              rows={report.byProjectType.map((b) => ({
                label:
                  b.name === 'standalone'
                    ? 'Standalone items'
                    : (PROJECT_TYPE_LABEL[b.name as ProjectType] ?? b.name),
                value: b.profit,
                sub: `${b.units} sold`,
              }))}
              format={(n) => f.money(n)}
            />
          </Section>
          <Section title="Business expenses by category">
            <BarList
              rows={report.expensesByCategory.map((e) => ({ label: titleCase(e.name), value: e.amount }))}
              format={(n) => f.money(n)}
              emptyText="No business expenses in this period"
            />
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section title="Best performers">
            <RankList rows={report.topItems} />
          </Section>
          <Section title="Losses">
            <RankList rows={report.worstItems} empty="No loss-making sales in this period 🎉" />
          </Section>
        </div>

        <Card className="p-4 text-xs text-subtle">
          Figures use {settings.currency}. Revenue includes shipping paid by buyers. Costs include purchase
          price, extra costs, repair parts and each item's share of project costs.
        </Card>
      </Page>
    </>
  );
}

function RankList({
  rows,
  empty = 'No sales in this period',
}: {
  rows: { item: { id: string; code: string; name: string }; profit: number; revenue: number }[];
  empty?: string;
}) {
  const f = useFormat();
  if (!rows.length) return <p className="py-6 text-center text-sm text-subtle">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.item.id}>
          <Link to={`/items/${r.item.id}`} className="flex items-center gap-3 py-2 text-sm hover:text-accent">
            <span className="tabular w-20 shrink-0 text-xs text-subtle">{r.item.code}</span>
            <span className="min-w-0 flex-1 truncate">{r.item.name}</span>
            <span className="tabular text-xs text-subtle">{f.money(r.revenue)}</span>
            <MoneyTone value={r.profit} className="w-24 text-right">
              {f.money(r.profit, { signed: true })}
            </MoneyTone>
          </Link>
        </li>
      ))}
    </ul>
  );
}
