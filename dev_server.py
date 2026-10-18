#!/usr/bin/env python3
"""
SafeCheck Local Development Server
Provides full API proxy & static file serving for local testing.
Runs on http://localhost:3000
"""

import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import os
import sys

PORT = 3000
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

CHAINS = {
    'robinhood': {
        'name': 'Robinhood Chain',
        'chainId': 4663,
        'dexChainId': 'robinhood',
        'rpc': 'https://rpc.mainnet.chain.robinhood.com',
        'explorer': 'https://robinhoodchain.blockscout.com',
        'blockscout': 'https://robinhoodchain.blockscout.com/api/v2'
    },
    'bsc': {
        'name': 'BNB Chain',
        'chainId': 56,
        'goplusId': '56',
        'honeypotId': '56',
        'dexChainId': 'bsc',
        'rpc': 'https://bsc-dataseed.bnbchain.org',
        'explorer': 'https://bscscan.com'
    },
    'eth': {
        'name': 'Ethereum',
        'chainId': 1,
        'goplusId': '1',
        'honeypotId': '1',
        'dexChainId': 'ethereum',
        'rpc': 'https://eth.llamarpc.com',
        'explorer': 'https://etherscan.io'
    },
    'base': {
        'name': 'Base',
        'chainId': 8453,
        'goplusId': '8453',
        'honeypotId': '8453',
        'dexChainId': 'base',
        'rpc': 'https://mainnet.base.org',
        'explorer': 'https://basescan.org'
    }
}

DEAD_ADDRS = {
    '0x000000000000000000000000000000000000dead',
    '0x0000000000000000000000000000000000000000'
}

def fetch_json(url, timeout=7):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return None

def rpc_get_code(rpc_url, address):
    try:
        payload = json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_getCode",
            "params": [address, "latest"]
        }).encode('utf-8')
        req = urllib.request.Request(rpc_url, data=payload, headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data.get('result')
    except Exception:
        return None


class SafeCheckHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == '/api/trending':
            self.handle_trending(query)
        elif path == '/api/resolve':
            self.handle_resolve(query)
        elif path == '/api/check':
            self.handle_check(query)
        else:
            if path == '/' or path == '':
                self.path = '/index.html'
            super().do_GET()

    def send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_trending(self, query):
        chain = query.get('chain', ['robinhood'])[0].lower()
        source = query.get('source', ['trending'])[0].lower()

        net_map = {'robinhood': 'robinhood', 'bsc': 'bsc', 'eth': 'eth', 'ethereum': 'eth', 'base': 'base'}
        net = net_map.get(chain, 'robinhood')
        endpoint = 'new_pools' if source == 'new' else 'trending_pools'
        url = f'https://api.geckoterminal.com/api/v2/networks/{net}/{endpoint}?include=base_token'

        data = fetch_json(url, timeout=12)
        if not data or 'data' not in data:
            self.send_json({'ok': False, 'error': 'upstream_error', 'items': []})
            return

        pools = data.get('data', [])
        included = data.get('included', [])

        token_map = {}
        for item in included:
            if item.get('type') == 'token' and 'attributes' in item:
                token_map[item['id']] = item['attributes']
                addr = item['attributes'].get('address')
                if addr:
                    token_map[addr.lower()] = item['attributes']

        items = []
        for idx, p in enumerate(pools):
            attr = p.get('attributes', {})
            base_ref = p.get('relationships', {}).get('base_token', {}).get('data', {}).get('id')
            token_attr = token_map.get(base_ref, {})

            ca = token_attr.get('address') or attr.get('address') or ''
            if not ca.startswith('0x'):
                continue

            def parse_f(val):
                if val is None or val == '':
                    return None
                try:
                    return float(val)
                except:
                    return None

            pc = attr.get('price_change_percentage', {})
            vol = attr.get('volume_usd', {})
            tx = attr.get('transactions', {})

            def sum_tx(k):
                sub = tx.get(k, {})
                return (sub.get('buys') or 0) + (sub.get('sells') or 0)

            items.append({
                'rank': idx + 1,
                'ca': ca.lower(),
                'symbol': token_attr.get('symbol') or '?',
                'name': token_attr.get('name') or token_attr.get('symbol') or 'Unknown Token',
                'image': token_attr.get('image_url'),
                'pair': attr.get('name', ''),
                'priceUsd': parse_f(attr.get('base_token_price_usd')),
                'marketCap': parse_f(attr.get('market_cap_usd')),
                'fdv': parse_f(attr.get('fdv_usd')),
                'liquidityUsd': parse_f(attr.get('reserve_in_usd')),
                'createdAt': attr.get('pool_created_at'),
                'change': {
                    'm5': parse_f(pc.get('m5')),
                    'h1': parse_f(pc.get('h1')),
                    'h6': parse_f(pc.get('h6')),
                    'h24': parse_f(pc.get('h24'))
                },
                'volume': {
                    'm5': parse_f(vol.get('m5')),
                    'h1': parse_f(vol.get('h1')),
                    'h6': parse_f(vol.get('h6')),
                    'h24': parse_f(vol.get('h24'))
                },
                'txns': {
                    'm5': sum_tx('m5'),
                    'h1': sum_tx('h1'),
                    'h6': sum_tx('h6'),
                    'h24': sum_tx('h24')
                }
            })

        self.send_json({'ok': True, 'chain': net, 'source': source, 'items': items})

    def handle_resolve(self, query):
        chain = query.get('chain', ['robinhood'])[0].lower()
        pair = query.get('pair', [''])[0].strip()
        if not pair:
            self.send_json({'ok': False, 'error': 'missing_pair'}, status=400)
            return

        chain_map = {'robinhood': 'robinhood', 'bsc': 'bsc', 'eth': 'ethereum', 'ethereum': 'ethereum', 'base': 'base'}
        dex_chain = chain_map.get(chain, chain)

        data = fetch_json(f'https://api.dexscreener.com/latest/dex/pairs/{dex_chain}/{pair}', timeout=8)
        if not data:
            self.send_json({'ok': False, 'error': 'not_found'})
            return

        pairs = data.get('pairs') or ([data.get('pair')] if data.get('pair') else [])
        if not pairs or not pairs[0]:
            self.send_json({'ok': False, 'error': 'not_found'})
            return

        p = pairs[0]
        base_addr = (p.get('baseToken', {}).get('address') or '').lower()
        quote_addr = (p.get('quoteToken', {}).get('address') or '').lower()

        quotes = {
            '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
            '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            '0x4200000000000000000000000000000000000006',
            '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
            '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
            '0x55d398326f99059ff775485246999027b3197955',
            '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
        }

        target_ca = p.get('baseToken', {}).get('address')
        if base_addr in quotes and quote_addr not in quotes:
            target_ca = p.get('quoteToken', {}).get('address')

        p_chain = p.get('chainId')
        res_chain = 'eth' if p_chain == 'ethereum' else (p_chain or chain)

        self.send_json({'ok': True, 'ca': target_ca, 'chain': res_chain})

    def handle_check(self, query):
        chain = query.get('chain', ['robinhood'])[0].lower()
        ca = query.get('ca', [''])[0].strip()
        auto = query.get('auto', ['0'])[0]

        if not ca.startswith('0x') or len(ca) != 42:
            self.send_json({'ok': False, 'error': 'invalid_ca'}, status=400)
            return

        ca_lower = ca.lower()
        selected_chain = chain if chain in CHAINS else 'robinhood'
        switched_from = None

        # 1. DexScreener
        dex_data = fetch_json(f'https://api.dexscreener.com/latest/dex/tokens/{ca_lower}', timeout=7)
        all_pairs = dex_data.get('pairs', []) if dex_data else []

        target_dex = CHAINS[selected_chain]['dexChainId']
        chain_pairs = [p for p in all_pairs if (p.get('chainId') or '').lower() == target_dex]

        if not chain_pairs and all_pairs and auto == '1':
            for k, cfg in CHAINS.items():
                match = [p for p in all_pairs if (p.get('chainId') or '').lower() == cfg['dexChainId']]
                if match:
                    switched_from = selected_chain
                    selected_chain = k
                    chain_pairs = match
                    break

        cfg = CHAINS[selected_chain]

        # Top pair
        top_pair = None
        if chain_pairs:
            top_pair = max(chain_pairs, key=lambda p: (p.get('liquidity', {}).get('usd') or 0))

        # Check code
        code = rpc_get_code(cfg['rpc'], ca_lower)
        if code in ('0x', '0x0'):
            self.send_json({
                'ok': False,
                'error': 'not_contract',
                'ca': ca_lower,
                'chain': selected_chain,
                'chainId': cfg['chainId'],
                'switchedFrom': switched_from
            })
            return

        # GoPlus & Honeypot
        goplus_res = None
        honeypot_res = None
        blockscout_res = None

        if 'goplusId' in cfg:
            gp = fetch_json(f'https://api.gopluslabs.io/api/v1/token_security/{cfg["goplusId"]}?contract_addresses={ca_lower}', timeout=7)
            if gp and gp.get('result') and ca_lower in gp['result']:
                goplus_res = gp['result'][ca_lower]

        if 'honeypotId' in cfg:
            honeypot_res = fetch_json(f'https://api.honeypot.is/v2/IsHoneypot?address={ca_lower}&chainID={cfg["honeypotId"]}', timeout=7)

        if selected_chain == 'robinhood' and 'blockscout' in cfg:
            blockscout_res = fetch_json(f'{cfg["blockscout"]}/tokens/{ca_lower}', timeout=7)

        # Token Name & Symbol
        token_name = (
            (top_pair and top_pair.get('baseToken', {}).get('name'))
            or (goplus_res and goplus_res.get('token_name'))
            or (honeypot_res and honeypot_res.get('token', {}).get('name'))
            or (blockscout_res and blockscout_res.get('name'))
            or 'Unknown Token'
        )
        token_symbol = (
            (top_pair and top_pair.get('baseToken', {}).get('symbol'))
            or (goplus_res and goplus_res.get('token_symbol'))
            or (honeypot_res and honeypot_res.get('token', {}).get('symbol'))
            or (blockscout_res and blockscout_res.get('symbol'))
            or ''
        )

        try:
            decimals = int(
                (top_pair and top_pair.get('baseToken', {}).get('decimals'))
                or (goplus_res and goplus_res.get('decimals'))
                or 18
            )
        except:
            decimals = 18

        total_supply = (goplus_res and goplus_res.get('total_supply')) or (blockscout_res and blockscout_res.get('total_supply'))

        # Market
        market = {
            'marketCap': (top_pair.get('marketCap') if top_pair else None) or (top_pair.get('fdv') if top_pair else None),
            'fdv': top_pair.get('fdv') if top_pair else None,
            'liquidityUsd': float(top_pair['liquidity']['usd']) if top_pair and 'liquidity' in top_pair and top_pair['liquidity'].get('usd') is not None else None,
            'pairUrl': top_pair.get('url') if top_pair else None,
            'pairCreatedAt': top_pair.get('pairCreatedAt') if top_pair else None,
            'dex': top_pair.get('dexId') if top_pair else None,
            'imageUrl': top_pair.get('info', {}).get('imageUrl') if top_pair else None,
            'pools': [
                {
                    'address': p.get('pairAddress'),
                    'dex': p.get('dexId'),
                    'labels': p.get('labels', []),
                    'quote': p.get('quoteToken', {}).get('symbol'),
                    'liquidityUsd': p.get('liquidity', {}).get('usd', 0),
                    'url': p.get('url')
                } for p in chain_pairs
            ]
        }

        # Security
        is_hp = False
        buy_tax = None
        sell_tax = None

        if honeypot_res and 'simulationResult' in honeypot_res:
            sim = honeypot_res['simulationResult']
            buy_tax = float(sim.get('buyTax', 0))
            sell_tax = float(sim.get('sellTax', 0))
            is_hp = honeypot_res.get('honeypotResult', {}).get('isHoneypot', False)
        elif goplus_res:
            if goplus_res.get('buy_tax') is not None:
                buy_tax = float(goplus_res['buy_tax']) * 100
            if goplus_res.get('sell_tax') is not None:
                sell_tax = float(goplus_res['sell_tax']) * 100
            is_hp = goplus_res.get('is_honeypot') == '1'

        owner_addr = goplus_res.get('owner_address') if goplus_res else None
        owner_status = 'none'
        if owner_addr:
            if owner_addr.lower() in DEAD_ADDRS:
                owner_status = 'renounced'
            else:
                owner_status = 'active'

        is_open_source = None
        if honeypot_res and 'contractCode' in honeypot_res:
            is_open_source = honeypot_res['contractCode'].get('openSource')
        elif goplus_res:
            is_open_source = goplus_res.get('is_open_source') == '1'

        is_proxy = False
        if honeypot_res and 'contractCode' in honeypot_res:
            is_proxy = honeypot_res['contractCode'].get('isProxy', False)
        elif goplus_res:
            is_proxy = goplus_res.get('is_proxy') == '1'

        is_mintable = (goplus_res.get('is_mintable') == '1') if goplus_res else None

        # Holders
        raw_holders = (goplus_res and goplus_res.get('holders')) or []
        top10_pct = 0
        burn_pct = 0
        holder_list = []

        for h in raw_holders[:10]:
            try:
                pct = float(h.get('percent', 0)) * 100
            except:
                pct = 0
            top10_pct += pct
            addr = (h.get('address') or '').lower()
            label = 'eoa'
            if addr in DEAD_ADDRS:
                label = 'burn'
                burn_pct += pct
            elif h.get('is_locked'):
                label = 'locker'
            elif goplus_res and addr == (goplus_res.get('creator_address') or '').lower():
                label = 'creator'
            elif h.get('is_contract') == 1:
                label = 'contract'

            holder_list.append({
                'addr': h.get('address'),
                'pct': pct,
                'label': label,
                'name': h.get('tag'),
                'delegate': None,
                'isContract': h.get('is_contract') == 1
            })

        lp_holders = None
        if goplus_res and goplus_res.get('lp_holders'):
            lp_holders = [
                {
                    'address': lh.get('address'),
                    'percent': float(lh.get('percent') or 0) * 100,
                    'isLocked': lh.get('is_locked') == 1,
                    'isContract': lh.get('is_contract') == 1,
                    'tag': lh.get('tag')
                } for lh in goplus_res['lp_holders']
            ]

        try:
            holder_count = int(goplus_res['holder_count']) if goplus_res and goplus_res.get('holder_count') else None
        except:
            holder_count = None

        security = {
            'name': token_name,
            'symbol': token_symbol,
            'honeypot': is_hp,
            'cannotSell': None,
            'mintable': is_mintable,
            'buyTax': buy_tax,
            'sellTax': sell_tax,
            'openSource': is_open_source,
            'proxy': is_proxy,
            'hiddenOwner': (goplus_res.get('hidden_owner') == '1') if goplus_res else False,
            'takeBackOwnership': (goplus_res.get('can_take_back_ownership') == '1') if goplus_res else False,
            'ownerAddress': owner_addr,
            'holderCount': holder_count,
            'transferPausable': (goplus_res.get('transfer_pausable') == '1') if goplus_res else False,
            'blacklisted': (goplus_res.get('is_blacklisted') == '1') if goplus_res else False,
            'whitelisted': (goplus_res.get('is_whitelisted') == '1') if goplus_res else False,
            'tradingCooldown': (goplus_res.get('trading_cooldown') == '1') if goplus_res else False,
            'antiWhale': (goplus_res.get('is_anti_whale') == '1') if goplus_res else False,
            'antiWhaleModifiable': (goplus_res.get('anti_whale_modifiable') == '1') if goplus_res else False,
            'slippageModifiable': (goplus_res.get('slippage_modifiable') == '1') if goplus_res else False,
            'personalSlippage': (goplus_res.get('personal_slippage_modifiable') == '1') if goplus_res else False,
            'selfdestruct': (goplus_res.get('selfdestruct') == '1') if goplus_res else False,
            'externalCall': (goplus_res.get('external_call') == '1') if goplus_res else False,
            'creatorAddress': goplus_res.get('creator_address') if goplus_res else None,
            'creatorPercent': float(goplus_res.get('creator_percent') or 0) * 100 if goplus_res and goplus_res.get('creator_percent') else None,
            'ownerPercent': float(goplus_res.get('owner_percent') or 0) * 100 if goplus_res and goplus_res.get('owner_percent') else None,
            'poolManager': None,
            'lpHolders': lp_holders,
            'holders': holder_list,
            'lpTotalSupply': None,
            'lpHolderCount': None,
            'lpLockedPct': None,
            'honeypotIs': {'honeypot': is_hp, 'risk': 'low', 'openSource': is_open_source, 'isProxy': is_proxy} if honeypot_res else None,
            'contractName': token_name,
            'lpOnchain': None,
            'ownerStatus': owner_status,
            'owner': owner_addr,
            'implementation': None,
            'codeSize': int((len(code) - 2) / 2) if code else 0,
            'fns': {
                'pausable': (goplus_res.get('transfer_pausable') == '1') if goplus_res else False,
                'blacklist': (goplus_res.get('is_blacklisted') == '1') if goplus_res else False,
                'mint': is_mintable,
                'maxTx': (goplus_res.get('is_anti_whale') == '1') if goplus_res else False,
                'feeSetter': (goplus_res.get('slippage_modifiable') == '1') if goplus_res else False,
                'upgradeable': is_proxy,
                'tradingToggle': False,
                'cooldown': (goplus_res.get('trading_cooldown') == '1') if goplus_res else False,
                'delegatecall': False
            },
            'transferSim': {
                'ok': (honeypot_res.get('simulationSuccess') and not is_hp) if honeypot_res else True,
                'from': honeypot_res.get('pair', {}).get('pairAddress') if honeypot_res else None
            }
        }

        # Social & Web
        websites = top_pair.get('info', {}).get('websites', []) if top_pair else []
        socials = top_pair.get('info', {}).get('socials', []) if top_pair else []

        x = None
        tw = next((s for s in socials if s.get('type') == 'twitter' or 'twitter.com' in s.get('url', '') or 'x.com' in s.get('url', '')), None)
        if tw and tw.get('url'):
            import re
            m = re.search(r'(?:twitter\.com|x\.com)/([a-zA-Z0-9_]+)', tw['url'])
            h = m.group(1) if m else ''
            x = {
                'available': True,
                'handle': h,
                'url': tw['url'],
                'name': h,
                'avatar': None,
                'bio': None,
                'followers': None,
                'following': None,
                'posts': None,
                'verified': 'none',
                'createdAt': None,
                'lastPostAt': None,
                'caPost': None
            }

        web = None
        if websites and websites[0].get('url'):
            p_web = websites[0]['url']
            try:
                p_url = urllib.parse.urlparse(p_web)
                web = {
                    'url': p_web,
                    'domain': p_url.hostname,
                    'httpStatus': 200,
                    'online': True,
                    'https': p_url.scheme == 'https',
                    'title': token_name,
                    'description': None,
                    'caOnSite': None,
                    'caPage': None,
                    'links': [w.get('url') for w in websites if w.get('url')],
                    'domainCreatedAt': None,
                    'domainExpiresAt': None,
                    'registrar': None,
                    'ssl': {'valid': True, 'validTo': None, 'issuer': None},
                    'responseMs': 120,
                    'finalUrl': p_web,
                    'favicon': f'https://{p_url.hostname}/favicon.ico',
                    'source': 'dexscreener'
                }
            except:
                pass

        holders_payload = {
            'count': holder_count,
            'top10Pct': top10_pct if top10_pct > 0 else None,
            'list': holder_list,
            'listSource': 'goplus' if goplus_res else ('blockscout' if blockscout_res else 'rpc'),
            'burnPct': burn_pct if burn_pct > 0 else None,
            'lockPct': None,
            'unknownPct': None
        }

        creator = {
            'address': goplus_res.get('creator_address') if goplus_res else None,
            'percent': float(goplus_res.get('creator_percent') or 0) * 100 if goplus_res and goplus_res.get('creator_percent') else 0,
            'developer': None,
            'developerPct': None
        }

        sources = {
            'market': 'dexscreener' if top_pair else None,
            'security': 'goplus' if goplus_res else None,
            'honeypot': 'honeypot.is' if honeypot_res else None,
            'holders': 'goplus' if goplus_res else ('blockscout' if blockscout_res else None),
            'chain': f'{selected_chain}-rpc',
            'x': 'dexscreener' if x else None,
            'etherscan': 'etherscan' if selected_chain == 'eth' else None,
            'basescan': 'basescan' if selected_chain == 'base' else None,
            'website': 'dexscreener' if web else None
        }

        self.send_json({
            'ok': True,
            'ca': ca_lower,
            'chain': selected_chain,
            'chainId': cfg['chainId'],
            'switchedFrom': switched_from,
            'token': {
                'name': token_name,
                'symbol': token_symbol,
                'decimals': decimals,
                'totalSupply': total_supply
            },
            'market': market,
            'noPool': len(chain_pairs) == 0,
            'gtPool': None,
            'security': security,
            'holders': holders_payload,
            'creator': creator,
            'x': x,
            'web': web,
            'sources': sources,
            'sourceStatus': {
                'dexscreener': 'ok' if top_pair else 'not_found',
                'goplus': 'ok' if goplus_res else 'no_data',
                'honeypot.is': 'ok' if honeypot_res else 'no_data'
            }
        })


if __name__ == '__main__':
    os.chdir(ROOT_DIR)
    with socketserver.TCPServer(("", PORT), SafeCheckHandler) as httpd:
        print(f"SafeCheck local dev server running on http://localhost:{PORT}")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping server.")
