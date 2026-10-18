export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=45, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { chain = 'robinhood', source = 'trending' } = req.query || {};

  const networkMap = {
    robinhood: 'robinhood',
    bsc: 'bsc',
    eth: 'eth',
    ethereum: 'eth',
    base: 'base'
  };

  const net = networkMap[chain.toLowerCase()] || 'robinhood';
  const endpoint = source === 'new' ? 'new_pools' : 'trending_pools';
  const url = `https://api.geckoterminal.com/api/v2/networks/${net}/${endpoint}?include=base_token`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json;version=20230302',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    clearTimeout(timeout);

    if (!r.ok) {
      return res.status(200).json({ ok: false, error: 'upstream_error', items: [] });
    }

    const data = await r.json();
    const pools = data.data || [];
    const included = data.included || [];

    const tokenMap = {};
    for (const item of included) {
      if (item.type === 'token' && item.attributes) {
        tokenMap[item.id] = item.attributes;
        if (item.attributes.address) {
          tokenMap[item.attributes.address.toLowerCase()] = item.attributes;
        }
      }
    }

    const items = pools.map((p, index) => {
      const attr = p.attributes || {};
      const baseRef = p.relationships?.base_token?.data?.id;
      const tokenAttr = (baseRef && tokenMap[baseRef]) || {};

      const price = parseFloat(attr.base_token_price_usd) || null;
      const mcap = parseFloat(attr.market_cap_usd) || null;
      const fdv = parseFloat(attr.fdv_usd) || null;
      const liq = parseFloat(attr.reserve_in_usd) || null;

      const pc = attr.price_change_percentage || {};
      const vol = attr.volume_usd || {};
      const tx = attr.transactions || {};

      const parseNum = (v) => {
        if (v == null || v === '') return null;
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
      };

      const calcTx = (sub) => {
        if (!sub) return 0;
        return (sub.buys || 0) + (sub.sells || 0);
      };

      return {
        rank: index + 1,
        ca: (tokenAttr.address || attr.address || '').toLowerCase(),
        symbol: tokenAttr.symbol || '?',
        name: tokenAttr.name || tokenAttr.symbol || 'Unknown Token',
        image: tokenAttr.image_url || null,
        pair: attr.name || '',
        priceUsd: price,
        marketCap: mcap,
        fdv: fdv,
        liquidityUsd: liq,
        createdAt: attr.pool_created_at || null,
        change: {
          m5: parseNum(pc.m5),
          h1: parseNum(pc.h1),
          h6: parseNum(pc.h6),
          h24: parseNum(pc.h24)
        },
        volume: {
          m5: parseNum(vol.m5),
          h1: parseNum(vol.h1),
          h6: parseNum(vol.h6),
          h24: parseNum(vol.h24)
        },
        txns: {
          m5: calcTx(tx.m5),
          h1: calcTx(tx.h1),
          h6: calcTx(tx.h6),
          h24: calcTx(tx.h24)
        }
      };
    }).filter(i => i.ca && i.ca.startsWith('0x'));

    return res.status(200).json({
      ok: true,
      chain: net,
      source,
      items
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: err.name === 'AbortError' ? 'timeout' : 'internal_error',
      items: []
    });
  }
}
