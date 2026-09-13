// Entry script for treasury-flow.html — fetches the two new public,
// keyless GEOVIX endpoints (Treasury foreign-holders flow + EIA SPR
// level) and renders them without any framework dependency, matching the
// standalone style of mcp-grant-main.ts / embed-main.ts.

interface TreasuryHolder {
  country: string;
  holdingsBillion: number;
  flowYoYBillion: number | null;
}

interface TreasuryResponse {
  latestPeriod: string;
  topHolders: TreasuryHolder[];
  error?: string;
}

interface SprResponse {
  latestPeriod: string;
  latestThousandBarrels: number;
  changeYoYThousandBarrels: number;
  error?: string;
}

function fmtBillion(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}bi`;
}

function fmtMonthLabel(period: string): string {
  const parts = period.split('-');
  const y = parts[0] ?? period;
  const m = parts[1] ?? '';
  const months = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${months[parseInt(m, 10)] ?? m}/${y}`;
}

async function renderTreasury(): Promise<void> {
  const el = document.getElementById('treasury-content');
  if (!el) return;
  try {
    const res = await fetch('/api/treasury-flow?top=15');
    const data: TreasuryResponse = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

    const withFlow = data.topHolders.filter((h) => h.flowYoYBillion !== null);
    const maxAbsFlow = Math.max(1, ...withFlow.map((h) => Math.abs(h.flowYoYBillion as number)));
    const sorted = [...withFlow].sort((a, b) => (a.flowYoYBillion as number) - (b.flowYoYBillion as number));

    const rows = sorted.map((h) => {
      const flow = h.flowYoYBillion as number;
      const isPos = flow > 0;
      const widthPct = (Math.abs(flow) / maxAbsFlow) * 50;
      return `
        <div class="bar-row">
          <span class="bar-country">${escapeHtml(h.country)}</span>
          <div class="bar-track">
            <div class="bar-center"></div>
            <div class="bar-fill ${isPos ? 'pos' : 'neg'}" style="width:${widthPct.toFixed(1)}%"></div>
          </div>
          <span class="bar-value">${fmtBillion(flow)}</span>
          <span class="bar-holdings">$${h.holdingsBillion.toFixed(0)}bi</span>
        </div>`;
    }).join('');

    el.className = '';
    el.innerHTML = `
      <div class="legend">
        <span><span class="dot pos"></span>comprando (12m)</span>
        <span><span class="dot neg"></span>vendendo (12m)</span>
        <span>período: ${escapeHtml(fmtMonthLabel(data.latestPeriod))}</span>
      </div>
      ${rows}
    `;
  } catch (err) {
    el.className = 'error';
    el.textContent = `Não foi possível carregar os dados do Tesouro agora. (${err instanceof Error ? err.message : String(err)})`;
  }
}

async function renderSpr(): Promise<void> {
  const el = document.getElementById('spr-content');
  if (!el) return;
  try {
    const res = await fetch('/api/spr?years=5');
    const data: SprResponse = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

    const millionBarrels = data.latestThousandBarrels / 1000;
    const changeMillionBarrels = data.changeYoYThousandBarrels / 1000;
    const isPos = changeMillionBarrels > 0;

    el.className = '';
    el.innerHTML = `
      <div class="summary-row">
        <div class="summary-card">
          <div class="summary-label">Nível atual</div>
          <div class="summary-value">${millionBarrels.toFixed(1)}M barris</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Variação 12 meses</div>
          <div class="summary-value ${isPos ? 'pos' : 'neg'}">${isPos ? '+' : ''}${changeMillionBarrels.toFixed(1)}M barris</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Última atualização</div>
          <div class="summary-value">${escapeHtml(data.latestPeriod)}</div>
        </div>
      </div>
    `;
  } catch (err) {
    el.className = 'error';
    el.textContent = `Não foi possível carregar os dados da SPR agora. (${err instanceof Error ? err.message : String(err)})`;
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

renderTreasury();
renderSpr();
