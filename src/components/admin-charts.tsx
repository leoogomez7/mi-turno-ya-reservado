import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";

type ChartEntry = { name: string; value: number; subtitle?: string };

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gold/30 bg-slate-950/95 p-3 text-white shadow-xl">
      <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      {payload.map((entry) => (
        <div key={entry.name as string} className="flex items-center justify-between gap-4 text-sm leading-none">
          <span className="text-white leading-none">{entry.name}</span>
          <span className="font-semibold text-gold leading-none">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ChartCard({ title, data }: { title: string; data: ChartEntry[] }) {
  const colors = ["#F59E0B", "#60A5FA", "#34D399", "#A855F7", "#F97316", "#22C55E"];
  const isProfessionalChart = title.includes("profesionales");
  const hasData = data.length > 0 && data.some((entry) => entry.value > 0);

  const dataList = (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.map((entry, index) => (
        <div key={`${entry.name}-${index}`} className="flex items-center justify-between rounded-2xl border border-border/80 bg-muted p-3">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
            <div>
              <div className="text-sm font-medium text-foreground">{entry.name}</div>
              {entry.subtitle && <div className="text-xs text-muted-foreground">{entry.subtitle}</div>}
            </div>
          </div>
          <div className="text-sm font-semibold text-foreground">{entry.value}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="h-full rounded-2xl border border-gold/30 bg-card p-4 sm:p-5">
      <h3 className="mb-3 flex min-h-7 items-center font-display text-lg font-semibold">{title}</h3>
      {!hasData ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Sin datos aún.</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="45%"
                outerRadius={90}
                innerRadius={52}
                paddingAngle={4}
                cornerRadius={8}
                stroke="transparent"
              >
                {data.map((entry, index) => (
                  <Cell key={`${entry.name}-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} cursor={false} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-6">{dataList}</div>
        </>
      )}
    </div>
  );
}

type MonthlyChartEntry = { month: string; label: string; turns: number; services: number; revenue: number };

function MonthlyChartTooltip({ active, payload, label, currency }: TooltipProps<number, string> & { currency?: boolean }) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0]?.value ?? 0);
  const formattedValue = currency ? `$${value.toLocaleString("es-AR", { maximumFractionDigits: 0 })}` : value.toLocaleString("es-AR");

  return (
    <div className="rounded-xl border border-gold/30 bg-slate-950/95 px-3 py-2.5 text-sm text-white shadow-xl">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold text-gold">{formattedValue} {currency ? "ingresados" : "turnos"}</p>
    </div>
  );
}

export function MonthlyComparisonChart({
  title,
  data,
  dataKey,
  color,
  currency = false,
}: {
  title: string;
  data: MonthlyChartEntry[];
  dataKey: "turns" | "revenue";
  color: string;
  currency?: boolean;
}) {
  const hasData = data.some((entry) => entry[dataKey] > 0);
  const formatAxisValue = (value: number) => {
    if (!currency) return value.toLocaleString("es-AR");
    if (value >= 1_000_000) return `$${(value / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`;
    if (value >= 1_000) return `$${Math.round(value / 1_000)} mil`;
    return `$${value}`;
  };

  return (
    <section className="min-w-0 rounded-2xl border border-gold/30 bg-background/50 p-4 sm:p-5">
      <div className="mb-2">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">Comparación mes a mes según el rango elegido.</p>
      </div>
      {!hasData ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Todavía no hay datos para este período.</p>
      ) : (
        <ResponsiveContainer width="100%" height={290}>
          <BarChart data={data} margin={{ top: 14, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
            <YAxis tickFormatter={formatAxisValue} tick={{ fill: "#a1a1aa", fontSize: 11 }} tickLine={false} axisLine={false} width={currency ? 70 : 42} allowDecimals={false} />
            <Tooltip content={<MonthlyChartTooltip currency={currency} />} cursor={{ fill: "rgba(245,158,11,0.08)" }} />
            <Bar dataKey={dataKey} name={title} fill={color} radius={[7, 7, 0, 0]} maxBarSize={54} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
