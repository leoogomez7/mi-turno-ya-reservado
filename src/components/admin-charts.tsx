import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipProps } from "recharts";

type ChartEntry = { name: string; value: number };

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
  const hasData = data.length > 0 && (!isProfessionalChart || data.some((entry) => entry.value > 0));

  const dataList = (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.map((entry, index) => (
        <div key={entry.name} className="flex items-center justify-between rounded-2xl border border-border/80 bg-muted p-3">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
            <div>
              <div className="text-sm font-medium text-foreground">{entry.name}</div>
              <div className="text-xs text-muted-foreground">{isProfessionalChart ? "Profesional" : "Servicio"}</div>
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
      ) : isProfessionalChart ? (
        dataList
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
                  <Cell key={entry.name} fill={colors[index % colors.length]} />
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
