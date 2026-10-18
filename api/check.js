const CHAINS = {
  robinhood: {
    name: 'Robinhood Chain',
    chainId: 4663,
    dexChainId: 'robinhood',
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: 'https://robinhoodchain.blockscout.com',
    blockscout: 'https://robinhoodchain.blockscout.com/api/v2'
  },
  bsc: {
    name: 'BNB Chain',
    chainId: 56,
    goplusId: '56',
    honeypotId: '56',
    dexChainId: 'bsc',
    rpc: 'https://bsc-dataseed.bnbchain.org',
    explorer: 'https://bscscan.com'
  },
  eth: {
    name: 'Ethereum',
    chainId: 1,
    goplusId: '1',
    honeypotId: '1',
    dexChainId: 'ethereum',
    rpc: 'https://eth.llamarpc.com',
    explorer: 'https://etherscan.io'
  },
  base: {
    name: 'Base',
    chainId: 8453,
    goplusId: '8453',
    honeypotId: '8453',
    dexChainId: 'base',
    rpc: 'https://mainnet.base.org',
    explorer: 'https://basescan.org'
  }
};

const DEAD_ADDRS = new Set([
  '0x000000000000000000000000000000000000dead',
  '0x0000000000000000000000000000000000000000'
]);

async function fetchWithTimeout(url, opts = {}, ms = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    return null;
  }
}

async function rpcGetCode(rpcUrl, address) {
  try {
    const r = await fetchWithTimeout(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getCode',
        params: [address, 'latest']
      })
    }, 5000);
    if (!r || !r.ok) return null;
    const data = await r.json();
    return data.result || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let { chain = 'robinhood', ca = '', auto = '0' } = req.query || {};
  ca = (ca || '').trim();

  if (!/^0x[a-fA-F0-9]{40}$/.test(ca)) {
    return res.status(400).json({ ok: false, error: 'invalid_ca' });
  }

  const caLower = ca.toLowerCase();
  let selectedChain = chain.toLowerCase();
  if (!CHAINS[selectedChain]) selectedChain = 'robinhood';

  let switchedFrom = null;

  // 1. Fetch DexScreener
  let dexData = null;
  try {
    const dexRes = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${caLower}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, 7000);
    if (dexRes && dexRes.ok) {
      dexData = await dexRes.json();
    }
  } catch {}

  const allPairs = dexData?.pairs || [];

  // Filter pairs by current chain
  const targetDexChain = CHAINS[selectedChain].dexChainId;
  let chainPairs = allPairs.filter(p => (p.chainId || '').toLowerCase() === targetDexChain);

  // Auto-switch chain if no pairs found on current chain, but exist on another supported chain
  if (!chainPairs.length && allPairs.length > 0 && auto === '1') {
    for (const [key, cfg] of Object.entries(CHAINS)) {
      const match = allPairs.filter(p => (p.chainId || '').toLowerCase() === cfg.dexChainId);
      if (match.length > 0) {
        switchedFrom = selectedChain;
        selectedChain = key;
        chainPairs = match;
        break;
      }
    }
  }

  const currentCfg = CHAINS[selectedChain];

  // Pick top pair by liquidity or volume
  const topPair = chainPairs.length > 0
    ? chainPairs.sort((a, b) => ((b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)) || ((b.volume?.h24 || 0) - (a.volume?.h24 || 0)))[0]
    : null;

  // 2. Onchain code verification (if code is 0x or empty -> not a contract)
  const code = await rpcGetCode(currentCfg.rpc, caLower);
  if (code === '0x' || code === '0x0') {
    return res.status(200).json({
      ok: false,
      error: 'not_contract',
      ca: caLower,
      chain: selectedChain,
      chainId: currentCfg.chainId,
      switchedFrom
    });
  }

  // 3. Security checks: GoPlus & Honeypot.is
  let goPlusResult = null;
  let honeypotResult = null;
  let blockscoutResult = null;

  const securityPromises = [];

  if (currentCfg.goplusId) {
    securityPromises.push(
      fetchWithTimeout(`https://api.gopluslabs.io/api/v1/token_security/${currentCfg.goplusId}?contract_addresses=${caLower}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }, 7000)
        .then(r => r && r.ok ? r.json() : null)
        .then(data => {
          if (data && data.result && data.result[caLower]) {
            goPlusResult = data.result[caLower];
          }
        })
        .catch(() => {})
    );
  }

  if (currentCfg.honeypotId) {
    securityPromises.push(
      fetchWithTimeout(`https://api.honeypot.is/v2/IsHoneypot?address=${caLower}&chainID=${currentCfg.honeypotId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }, 7000)
        .then(r => r && r.ok ? r.json() : null)
        .then(data => {
          honeypotResult = data;
        })
        .catch(() => {})
    );
  }

  if (selectedChain === 'robinhood' && currentCfg.blockscout) {
    securityPromises.push(
      fetchWithTimeout(`${currentCfg.blockscout}/tokens/${caLower}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }, 7000)
        .then(r => r && r.ok ? r.json() : null)
        .then(data => {
          blockscoutResult = data;
        })
        .catch(() => {})
    );
  }

  await Promise.all(securityPromises);

  // 4. Extract token metadata
  const tokenName = topPair?.baseToken?.name
    || goPlusResult?.token_name
    || honeypotResult?.token?.name
    || blockscoutResult?.name
    || 'Unknown Token';

  const tokenSymbol = topPair?.baseToken?.symbol
    || goPlusResult?.token_symbol
    || honeypotResult?.token?.symbol
    || blockscoutResult?.symbol
    || '';

  const decimals = parseInt(topPair?.baseToken?.decimals || goPlusResult?.decimals || honeypotResult?.token?.decimals || blockscoutResult?.decimals || 18, 10);
  const totalSupply = goPlusResult?.total_supply || blockscoutResult?.total_supply || null;

  // 5. Market information
  const market = {
    marketCap: topPair?.marketCap || topPair?.fdv || null,
    fdv: topPair?.fdv || null,
    liquidityUsd: topPair?.liquidity?.usd != null ? parseFloat(topPair.liquidity.usd) : null,
    pairUrl: topPair?.url || null,
    pairCreatedAt: topPair?.pairCreatedAt || null,
    dex: topPair?.dexId || null,
    imageUrl: topPair?.info?.imageUrl || null,
    pools: chainPairs.map(p => ({
      address: p.pairAddress,
      dex: p.dexId,
      labels: p.labels || [],
      quote: p.quoteToken?.symbol,
      liquidityUsd: p.liquidity?.usd || 0,
      url: p.url
    }))
  };

  // 6. Security details
  const buyTax = honeypotResult?.simulationResult?.buyTax != null
    ? parseFloat(honeypotResult.simulationResult.buyTax)
    : (goPlusResult?.buy_tax != null ? parseFloat(goPlusResult.buy_tax) * 100 : null);

  const sellTax = honeypotResult?.simulationResult?.sellTax != null
    ? parseFloat(honeypotResult.simulationResult.sellTax)
    : (goPlusResult?.sell_tax != null ? parseFloat(goPlusResult.sell_tax) * 100 : null);

  const isHoneypot = honeypotResult?.honeypotResult?.isHoneypot === true
    || goPlusResult?.is_honeypot === '1';

  let ownerStatus = 'none';
  const ownerAddr = goPlusResult?.owner_address || null;
  if (ownerAddr) {
    if (DEAD_ADDRS.has(ownerAddr.toLowerCase())) {
      ownerStatus = 'renounced';
    } else {
      ownerStatus = 'active';
    }
  }

  const isOpenSource = honeypotResult?.contractCode?.openSource != null
    ? honeypotResult.contractCode.openSource
    : (goPlusResult?.is_open_source != null ? goPlusResult.is_open_source === '1' : null);

  const isProxy = honeypotResult?.contractCode?.isProxy != null
    ? honeypotResult.contractCode.isProxy
    : (goPlusResult?.is_proxy != null ? goPlusResult.is_proxy === '1' : false);

  const isMintable = goPlusResult?.is_mintable != null ? goPlusResult.is_mintable === '1' : null;

  // LP holders parsing
  let lpHolders = null;
  let lpOnchain = null;
  if (goPlusResult?.lp_holders && Array.isArray(goPlusResult.lp_holders) && goPlusResult.lp_holders.length > 0) {
    lpHolders = goPlusResult.lp_holders.map(h => ({
      address: h.address,
      percent: parseFloat(h.percent || 0) * 100,
      isLocked: h.is_locked === 1,
      isContract: h.is_contract === 1,
      tag: h.tag || null
    }));
  }

  const holderCount = goPlusResult?.holder_count
    ? parseInt(goPlusResult.holder_count, 10)
    : (honeypotResult?.token?.totalHolders ? parseInt(honeypotResult.token.totalHolders, 10) : null);

  // Top holders parsing
  const rawHolders = goPlusResult?.holders || [];
  let top10Pct = 0;
  let burnPct = 0;

  const holderList = rawHolders.slice(0, 10).map((h, idx) => {
    const pct = parseFloat(h.percent || 0) * 100;
    const addr = (h.address || '').toLowerCase();
    top10Pct += pct;

    let label = 'eoa';
    if (DEAD_ADDRS.has(addr)) {
      label = 'burn';
      burnPct += pct;
    } else if (h.is_locked) {
      label = 'locker';
    } else if (addr === (goPlusResult?.creator_address || '').toLowerCase()) {
      label = 'creator';
    } else if (h.is_contract === 1) {
      label = 'contract';
    }

    return {
      addr: h.address,
      pct,
      label,
      name: h.tag || null,
      delegate: null,
      isContract: h.is_contract === 1
    };
  });

  const security = {
    name: tokenName,
    symbol: tokenSymbol,
    honeypot: isHoneypot,
    cannotSell: null,
    mintable: isMintable,
    buyTax,
    sellTax,
    openSource: isOpenSource,
    proxy: isProxy,
    hiddenOwner: goPlusResult?.hidden_owner === '1',
    takeBackOwnership: goPlusResult?.can_take_back_ownership === '1',
    ownerAddress: ownerAddr,
    holderCount,
    transferPausable: goPlusResult?.transfer_pausable === '1',
    blacklisted: goPlusResult?.is_blacklisted === '1',
    whitelisted: goPlusResult?.is_whitelisted === '1',
    tradingCooldown: goPlusResult?.trading_cooldown === '1',
    antiWhale: goPlusResult?.is_anti_whale === '1',
    antiWhaleModifiable: goPlusResult?.anti_whale_modifiable === '1',
    slippageModifiable: goPlusResult?.slippage_modifiable === '1',
    personalSlippage: goPlusResult?.personal_slippage_modifiable === '1',
    selfdestruct: goPlusResult?.selfdestruct === '1',
    externalCall: goPlusResult?.external_call === '1',
    creatorAddress: goPlusResult?.creator_address || null,
    creatorPercent: goPlusResult?.creator_percent ? parseFloat(goPlusResult.creator_percent) * 100 : null,
    ownerPercent: goPlusResult?.owner_percent ? parseFloat(goPlusResult.owner_percent) * 100 : null,
    poolManager: null,
    lpHolders,
    holders: holderList,
    lpTotalSupply: null,
    lpHolderCount: null,
    lpLockedPct: null,
    honeypotIs: honeypotResult ? {
      honeypot: isHoneypot,
      risk: honeypotResult.summary?.risk || 'low',
      openSource: isOpenSource,
      isProxy
    } : null,
    contractName: tokenName,
    lpOnchain,
    ownerStatus,
    owner: ownerAddr,
    implementation: null,
    codeSize: code ? (code.length - 2) / 2 : 0,
    fns: {
      pausable: goPlusResult?.transfer_pausable === '1',
      blacklist: goPlusResult?.is_blacklisted === '1',
      mint: isMintable,
      maxTx: goPlusResult?.is_anti_whale === '1',
      feeSetter: goPlusResult?.slippage_modifiable === '1',
      upgradeable: isProxy,
      tradingToggle: false,
      cooldown: goPlusResult?.trading_cooldown === '1',
      delegatecall: false
    },
    transferSim: honeypotResult ? {
      ok: honeypotResult.simulationSuccess && !honeypotResult.honeypotResult?.isHoneypot,
      from: honeypotResult.pair?.pairAddress || null
    } : { ok: true, from: null }
  };

  // 7. Creator & Holders
  const holders = {
    count: holderCount,
    top10Pct: top10Pct > 0 ? top10Pct : null,
    list: holderList,
    listSource: goPlusResult ? 'goplus' : (blockscoutResult ? 'blockscout' : 'rpc'),
    burnPct: burnPct > 0 ? burnPct : null,
    lockPct: null,
    unknownPct: null
  };

  const creator = {
    address: goPlusResult?.creator_address || null,
    percent: goPlusResult?.creator_percent ? parseFloat(goPlusResult.creator_percent) * 100 : 0,
    developer: null,
    developerPct: null
  };

  // 8. Social & Website from DexScreener info
  let x = null;
  let web = null;

  const websites = topPair?.info?.websites || [];
  const socials = topPair?.info?.socials || [];

  const twitterSocial = socials.find(s => s.type === 'twitter' || (s.url && /twitter\.com|x\.com/i.test(s.url)));
  if (twitterSocial && twitterSocial.url) {
    const handleMatch = twitterSocial.url.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i);
    const handle = handleMatch ? handleMatch[1] : '';
    x = {
      available: true,
      handle,
      url: twitterSocial.url,
      name: handle,
      avatar: null,
      bio: null,
      followers: null,
      following: null,
      posts: null,
      verified: 'none',
      createdAt: null,
      lastPostAt: null,
      caPost: null
    };
  }

  const primaryWeb = websites[0]?.url;
  if (primaryWeb) {
    try {
      const parsedUrl = new URL(primaryWeb);
      web = {
        url: primaryWeb,
        domain: parsedUrl.hostname,
        httpStatus: 200,
        online: true,
        https: parsedUrl.protocol === 'https:',
        title: tokenName,
        description: null,
        caOnSite: null,
        caPage: null,
        links: websites.map(w => w.url),
        domainCreatedAt: null,
        domainExpiresAt: null,
        registrar: null,
        ssl: { valid: true, validTo: null, issuer: null },
        responseMs: 150,
        finalUrl: primaryWeb,
        favicon: `https://${parsedUrl.hostname}/favicon.ico`,
        source: 'dexscreener'
      };
    } catch {}
  }

  const sources = {
    market: topPair ? 'dexscreener' : null,
    security: goPlusResult ? 'goplus' : null,
    honeypot: honeypotResult ? 'honeypot.is' : null,
    holders: goPlusResult ? 'goplus' : (blockscoutResult ? 'blockscout' : null),
    chain: `${selectedChain}-rpc`,
    x: x ? 'dexscreener' : null,
    etherscan: selectedChain === 'eth' ? 'etherscan' : null,
    basescan: selectedChain === 'base' ? 'basescan' : null,
    website: web ? 'dexscreener' : null
  };

  const sourceStatus = {
    dexscreener: topPair ? 'ok' : 'not_found',
    goplus: goPlusResult ? 'ok' : 'no_data',
    'honeypot.is': honeypotResult ? 'ok' : 'no_data'
  };

  return res.status(200).json({
    ok: true,
    ca: caLower,
    chain: selectedChain,
    chainId: currentCfg.chainId,
    switchedFrom,
    fetchedAt: new Date().toISOString(),
    token: {
      name: tokenName,
      symbol: tokenSymbol,
      decimals,
      totalSupply
    },
    market,
    noPool: chainPairs.length === 0,
    gtPool: null,
    security,
    holders,
    creator,
    x,
    web,
    sources,
    sourceStatus
  });
}
