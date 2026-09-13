// Public, keyless endpoint: U.S. Treasury foreign holders of Treasury
// securities, plus a computed 12-month net flow per country (positive =
// net buying, negative = net selling). Source: U.S. Treasury / TIC
// "Major Foreign Holders of Treasury Securities" historical series
// (https://ticdata.treasury.gov/.../mfhhis01.txt), no API key required.
// Ported from the RISCO Monitor Macro (WW3) Python pipeline's
// fetch_foreign_holders() + compute_treasury_flow() logic.
export const config = { runtime: 'edge' };

const TIC_URL = 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/mfhhis01.txt';

const MONTH_MAP = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

const NON_COUNTRY_LABELS = new Set([
  'for. official', 'grand total', 'of which', 'treasury bills',
  't-bonds & notes', 'oil exporters', 'carib bnkng ctrs', 'all other',
]);

function unquote(s) {
  s = s.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return s;
}

function normalizeCountry(raw) {
  return unquote(raw).replace(/\s*\d+\/\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}

function parseTicText(text) {
  const lines = text.split(/\r?\n/);
  const countryLineIdx = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('Country\t')) countryLineIdx.push(i);
  }

  const rows = [];
  for (let b = 0; b < countryLineIdx.length; b++) {
    const idx = countryLineIdx[b];
    const yearLine = lines[idx];
    const monthLine = lines[idx - 1];
    const dataStart = idx + 2;
    const dataEnd = b + 1 < countryLineIdx.length ? countryLineIdx[b + 1] - 2 : lines.length;

    const months = monthLine.split('\t').map((s) => s.trim()).filter(Boolean);
    const years = yearLine.split('\t').slice(1).map((s) => s.trim()).filter(Boolean);
    const periods = months.map((m, i2) => `${years[i2]}-${MONTH_MAP[m] || '00'}`);

    for (let li = dataStart; li < dataEnd; li++) {
      const line = lines[li];
      if (!line || !line.trim()) continue;
      const parts = line.split('\t');
      const countryRaw = parts[0];
      if (!countryRaw || !countryRaw.trim()) continue;
      const key = unquote(countryRaw).toLowerCase().replace(/\s*\d+\/\s*$/, '').trim();
      if (NON_COUNTRY_LABELS.has(key)) continue;
      const country = normalizeCountry(countryRaw);
      for (let c = 0; c < periods.length; c++) {
        const raw = (parts[c + 1] || '').trim();
        if (!raw || raw.toUpperCase() === 'N/A') continue;
        const val = parseFloat(raw.replace(/,/g, ''));
        if (Number.isNaN(val)) continue;
        rows.push({ country, period: periods[c], holdingsBillion: val });
      }
    }
  }
  return rows;
}

function computeFlow(rows, topN) {
  const byCountry = new Map();
  for (const r of rows) {
    if (!byCountry.has(r.country)) byCountry.set(r.country, []);
    byCountry.get(r.country).push(r);
  }
  for (const arr of byCountry.values()) arr.sort((a, b) => a.period.localeCompare(b.period));

  const flowByKey = new Map();
  const historyByCountry = new Map();
  for (const [country, arr] of byCountry) {
    const hist = [];
    for (let i = 0; i < arr.length; i++) {
      const flow = i >= 12 ? Math.round((arr[i].holdingsBillion - arr[i - 12].holdingsBillion) * 10) / 10 : null;
      if (flow !== null) flowByKey.set(`${country}|${arr[i].period}`, flow);
      hist.push({ period: arr[i].period, holdingsBillion: arr[i].holdingsBillion, flowYoYBillion: flow });
    }
    historyByCountry.set(country, hist);
  }

  const latestPeriod = rows.reduce((m, r) => (r.period > m ? r.period : m), '0000-00');
  const topCountries = [...rows.filter((r) => r.period === latestPeriod)]
    .sort((a, b) => b.holdingsBillion - a.holdingsBillion)
    .slice(0, topN)
    .map((r) => r.country);

  const latest = topCountries.map((country) => ({
    country,
    holdingsBillion: rows.find((r) => r.country === country && r.period === latestPeriod).holdingsBillion,
    flowYoYBillion: flowByKey.get(`${country}|${latestPeriod}`) ?? null,
  }));

  const history = Object.fromEntries(topCountries.map((c) => [c, historyByCountry.get(c)]));

  return { latestPeriod, topHolders: latest, history };
}

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const url = new URL(req.url);
  const topN = Math.min(Math.max(parseInt(url.searchParams.get('top') || '15', 10) || 15, 1), 30);

  try {
    const res = await fetch(TIC_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GeovixBot/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`TIC upstream returned ${res.status}`);
    }
    const text = await res.text();
    const rows = parseTicText(text);
    if (rows.length === 0) {
      throw new Error('Parsed zero rows from TIC source');
    }
    const result = computeFlow(rows, topN);

    return new Response(JSON.stringify({
      source: 'U.S. Treasury / TIC — Major Foreign Holders of Treasury Securities',
      sourceUrl: TIC_URL,
      unit: 'USD billions',
      ...result,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
        ...corsHeaders,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch/parse Treasury TIC data', detail: String(err?.message || err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
