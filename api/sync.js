const fs = require('fs');

const CLOUD_TOPIC = 'vina_dragon_asean_2026_live_v3';
const NTFY_URL = 'https://ntfy.sh/' + CLOUD_TOPIC;
const RELAY_FILE = '/tmp/vina_dragon_relay_v3.json';

if (!global.__VD_RELAY__) {
  global.__VD_RELAY__ = {
    items: [],
    ntfyCacheAt: 0,
    ntfyItems: []
  };
  try {
    if (fs.existsSync(RELAY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(RELAY_FILE, 'utf8'));
      if (parsed && Array.isArray(parsed.items)) {
        global.__VD_RELAY__.items = parsed.items.slice(-30);
      }
    }
  } catch (e) {}
}

function appendRelayItem(item) {
  const relay = global.__VD_RELAY__;
  if (!item || !item.id) return;
  if (!relay.items.some(x => x.id === item.id)) {
    relay.items.push(item);
    if (relay.items.length > 30) {
      relay.items = relay.items.slice(-30);
    }
    try {
      fs.writeFileSync(RELAY_FILE, JSON.stringify({ items: relay.items }), 'utf8');
    } catch (e) {}
  }
}

async function fetchNtfyRecent(forceFresh) {
  const relay = global.__VD_RELAY__;
  const now = Date.now();
  if (!forceFresh && (now - relay.ntfyCacheAt) < 2500 && relay.ntfyItems.length > 0) {
    return relay.ntfyItems;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3500);
  try {
    const resp = await fetch(NTFY_URL + '/json?poll=1&since=5m', { signal: ctrl.signal });
    if (resp.ok) {
      const text = await resp.text();
      const lines = text.trim().split('\n').filter(Boolean);
      const parsed = [];
      for (let i = 0; i < lines.length; i++) {
        try {
          const env = JSON.parse(lines[i]);
          if (env && env.event === 'message' && env.message) {
            parsed.push({
              id: env.id,
              time: env.time,
              event: 'message',
              message: env.message
            });
          }
        } catch (e) {}
      }
      relay.ntfyItems = parsed.slice(-30);
      relay.ntfyCacheAt = Date.now();
    }
  } catch (e) {} finally {
    clearTimeout(t);
  }
  return relay.ntfyItems;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    let rawBody = '';
    try {
      rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    } catch (e) {
      rawBody = '{}';
    }
    const relayItem = {
      id: 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      time: Math.floor(Date.now() / 1000),
      event: 'message',
      message: rawBody
    };
    appendRelayItem(relayItem);
    global.__VD_RELAY__.ntfyCacheAt = 0;

    let ntfyOk = false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const up = await fetch(NTFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: rawBody,
        signal: ctrl.signal
      });
      ntfyOk = up.ok;
    } catch (e) {} finally {
      clearTimeout(t);
    }

    return res.status(200).json({ ok: true, id: relayItem.id, ntfyOk: ntfyOk });
  }

  const ntfyItems = await fetchNtfyRecent(false);
  const mergedMap = new Map();
  global.__VD_RELAY__.items.forEach(item => { if (item && item.id) mergedMap.set(item.id, item); });
  ntfyItems.forEach(item => { if (item && item.id) mergedMap.set(item.id, item); });
  const merged = Array.from(mergedMap.values()).sort((a, b) => (a.time || 0) - (b.time || 0)).slice(-30);

  return res.status(200).json({ ok: true, items: merged });
};
