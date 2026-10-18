export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { chain = 'robinhood', pair = '' } = req.query || {};
  if (!pair) {
    return res.status(400).json({ ok: false, error: 'missing_pair' });
  }

  const chainMap = {
    robinhood: 'robinhood',
    bsc: 'bsc',
    eth: 'ethereum',
    ethereum: 'ethereum',
    base: 'base'
  };

  const dexChain = chainMap[chain.toLowerCase()] || chain.toLowerCase();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${dexChain}/${pair}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    clearTimeout(timeout);

    if (!r.ok) {
      return res.status(200).json({ ok: false, error: 'upstream_error' });
    }

    const data = await r.json();
    const p = data.pairs?.[0] || data.pair;

    if (!p) {
      return res.status(200).json({ ok: false, error: 'not_found' });
    }

    const QUOTES = new Set([
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
      '0x4200000000000000000000000000000000000006', // WETH on Base
      '0x0bd7d308f8e1639fab988df18a8011f41eacad73', // WETH on Robinhood
      '0x5fc5360d0400a0fd4f2af552add042d716f1d168', // USDG on Robinhood
      '0x55d398326f99059ff775485246999027b3197955', // USDT BSC
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC BSC
      '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT ETH
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC ETH
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC Base
      '0x0000000000000000000000000000000000000000'
    ]);

    const baseAddr = (p.baseToken?.address || '').toLowerCase();
    const quoteAddr = (p.quoteToken?.address || '').toLowerCase();

    let targetCA = p.baseToken?.address;
    if (QUOTES.has(baseAddr) && !QUOTES.has(quoteAddr)) {
      targetCA = p.quoteToken?.address;
    }

    return res.status(200).json({
      ok: true,
      ca: targetCA,
      chain: p.chainId === 'ethereum' ? 'eth' : (p.chainId || chain)
    });
  } catch (err) {
    return res.status(200).json({ ok: false, error: 'resolve_failed' });
  }
}
