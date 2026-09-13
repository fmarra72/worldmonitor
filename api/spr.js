// Public endpoint: U.S. Strategic Petroleum Reserve level, weekly, via the
// EIA (Energy Information Administration) open API. Requires EIA_API_KEY
// (already configured in this project's environment variables).
// Series: WCSSTUS1 — "U.S. Ending Stocks of Crude Oil in SPR (Thousand
// Barrels)". Ported from the RISCO Monitor Macro (WW3) Python pipeline.
export const config = { runtime: 'edge' }; // env refresh

const EIA_SERIES = 'WCSSTUS1';

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

  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'EIA_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const url = new URL(req.url);
  const years = Math.min(Math.max(parseInt(url.searchParams.get('years') || '20', 10) || 20, 1), 30);
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - years);
  const start = startDate.toISOString().slice(0, 10);

  const eiaUrl = new URL('https://api.eia.gov/v2/petroleum/stoc/wstk/data/');
  eiaUrl.searchParams.set('api_key', apiKey);
  eiaUrl.searchParams.set('frequency', 'weekly');
  eiaUrl.searchParams.set('data[0]', 'value');
  eiaUrl.searchParams.set('facets[series][]', EIA_SERIES);
  eiaUrl.searchParams.set('start', start);
  eiaUrl.searchParams.set('sort[0][column]', 'period');
  eiaUrl.searchParams.set('sort[0][direction]', 'asc');
  eiaUrl.searchParams.set('length', '5000');

  try {
    const res = await fetch(eiaUrl.toString(), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      throw new Error(`EIA upstream returned ${res.status}`);
    }
    const json = await res.json();
    const rows = json?.response?.data ?? [];
    if (rows.length === 0) {
      throw new Error('EIA returned zero rows');
    }

    const weeks = rows.map((r) => ({
      period: r.period,
      thousandBarrels: Number(r.value),
    }));

    const latest = weeks[weeks.length - 1];
    const yearAgoIdx = Math.max(0, weeks.length - 53);
    const yearAgo = weeks[yearAgoIdx];
    const changeYoYThousandBarrels = Math.round(latest.thousandBarrels - yearAgo.thousandBarrels);

    return new Response(JSON.stringify({
      source: 'EIA — U.S. Ending Stocks of Crude Oil in SPR',
      sourceUrl: 'https://www.eia.gov/petroleum/data.php',
      series: EIA_SERIES,
      unit: 'thousand barrels',
      latestPeriod: latest.period,
      latestThousandBarrels: latest.thousandBarrels,
      changeYoYThousandBarrels,
      weeks,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=3600',
        ...corsHeaders,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch SPR data from EIA', detail: String(err?.message || err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
