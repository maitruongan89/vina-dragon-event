const fs = require('fs');
const path = require('path');

const STATE_FILE = '/tmp/vina_dragon_state_v2.json';

const DEFAULT_BW_PENALTIES = [
  '💪 Nắm tai nhún nhảy 5 cái',
  '🎤 Hát 1 bài hát',
  '🍺 Uống 1 ly bia'
];

function getDefaultData() {
  return {
    systemState: null,
    bwConfig: {
      v: 2,
      giftTotal: 6,
      giftUsed: 0,
      lixiTotal: 10,
      lixiUsed: 0,
      penalties: DEFAULT_BW_PENALTIES.slice(),
      penaltiesCustom: false
    },
    tables: {
      Nominees: [],
      Participants: [],
      Prizes: [],
      Winners: []
    }
  };
}

// Bộ nhớ toàn cục trên Serverless Instance + Lưu file /tmp để giữ trạng thái lâu nhất có thể
if (!global.__VD_STORE__) {
  global.__VD_STORE__ = getDefaultData();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        global.__VD_STORE__ = Object.assign(getDefaultData(), parsed);
      }
    }
  } catch (e) {}
}

function loadStore() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        // Giữ bản mới hơn dựa trên timestamp
        const memTs = (global.__VD_STORE__.systemState && global.__VD_STORE__.systemState.timestamp) || 0;
        const diskTs = (parsed.systemState && parsed.systemState.timestamp) || 0;
        if (diskTs >= memTs) {
          global.__VD_STORE__ = Object.assign(getDefaultData(), parsed);
        }
      }
    }
  } catch (e) {}
  return global.__VD_STORE__;
}

function saveStore(store) {
  global.__VD_STORE__ = store;
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(store), 'utf8');
  } catch (e) {}
}

function formatBwConfig(cfg) {
  const giftTotal = cfg.giftTotal !== undefined ? parseInt(cfg.giftTotal) : 6;
  const giftUsed = cfg.giftUsed !== undefined ? parseInt(cfg.giftUsed) : 0;
  const lixiTotal = cfg.lixiTotal !== undefined ? parseInt(cfg.lixiTotal) : 10;
  const lixiUsed = cfg.lixiUsed !== undefined ? parseInt(cfg.lixiUsed) : 0;
  const penalties = (Array.isArray(cfg.penalties) && cfg.penalties.length > 0)
    ? cfg.penalties
    : DEFAULT_BW_PENALTIES.slice();

  return {
    giftTotal: giftTotal,
    giftUsed: giftUsed,
    giftRemaining: Math.max(0, giftTotal - giftUsed),
    lixiTotal: lixiTotal,
    lixiUsed: lixiUsed,
    lixiRemaining: Math.max(0, lixiTotal - lixiUsed),
    penalties: penalties,
    penaltiesCustom: !!cfg.penaltiesCustom
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const store = loadStore();
  const body = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const method = body.method || '';
  const args = Array.isArray(body.args) ? body.args : [];

  try {
    let result = null;

    switch (method) {
      case 'getSystemState': {
        result = store.systemState || null;
        break;
      }

      case 'setSystemState': {
        const action = args[0];
        const payload = args[1] || {};
        store.systemState = {
          action: action,
          payload: payload,
          timestamp: Date.now()
        };
        if (payload && Array.isArray(payload.penalties) && payload.penalties.length > 0) {
          const cleaned = payload.penalties.map(p => String(p || '').trim()).filter(Boolean);
          if (cleaned.length > 0) {
            store.bwConfig.penalties = cleaned;
            store.bwConfig.penaltiesCustom = true;
          }
        }
        saveStore(store);
        result = true;
        break;
      }

      case 'bw_getConfig': {
        result = formatBwConfig(store.bwConfig);
        break;
      }

      case 'bw_setPenalties': {
        const penalties = args[0];
        if (Array.isArray(penalties)) {
          const cleaned = penalties.map(p => String(p || '').trim()).filter(Boolean);
          if (cleaned.length > 0) {
            store.bwConfig.penalties = cleaned;
            store.bwConfig.penaltiesCustom = true;
          }
        }
        saveStore(store);
        result = formatBwConfig(store.bwConfig);
        break;
      }

      case 'bw_setTotals': {
        const giftTotal = args[0];
        const lixiTotal = args[1];
        if (giftTotal !== null && giftTotal !== undefined && !isNaN(parseInt(giftTotal))) {
          store.bwConfig.giftTotal = Math.max(0, parseInt(giftTotal));
        }
        if (lixiTotal !== null && lixiTotal !== undefined && !isNaN(parseInt(lixiTotal))) {
          store.bwConfig.lixiTotal = Math.max(0, parseInt(lixiTotal));
        }
        saveStore(store);
        result = formatBwConfig(store.bwConfig);
        break;
      }

      case 'bw_addExtra': {
        const type = args[0];
        const addVal = parseInt(args[1]) || 0;
        if (type === 'gift') {
          store.bwConfig.giftTotal = Math.max(0, (store.bwConfig.giftTotal || 0) + addVal);
        } else if (type === 'lixi') {
          store.bwConfig.lixiTotal = Math.max(0, (store.bwConfig.lixiTotal || 0) + addVal);
        }
        saveStore(store);
        result = formatBwConfig(store.bwConfig);
        break;
      }

      case 'bw_recordSpinResult': {
        const str = String(args[0] || '').toLowerCase();
        if (str.indexOf('phần quà') > -1 || str.indexOf('🎁') > -1) {
          store.bwConfig.giftUsed = (store.bwConfig.giftUsed || 0) + 1;
        } else if (str.indexOf('lì xì') > -1 || str.indexOf('🧧') > -1) {
          store.bwConfig.lixiUsed = (store.bwConfig.lixiUsed || 0) + 1;
        }
        saveStore(store);
        result = formatBwConfig(store.bwConfig);
        break;
      }

      case 'bw_resetUsage': {
        store.bwConfig.giftUsed = 0;
        store.bwConfig.lixiUsed = 0;
        saveStore(store);
        result = formatBwConfig(store.bwConfig);
        break;
      }

      case 'db_getAll': {
        const sheetName = args[0] || 'Nominees';
        result = store.tables[sheetName] || [];
        break;
      }

      case 'db_setAll': {
        const sheetName = args[0] || 'Nominees';
        const items = Array.isArray(args[1]) ? args[1] : [];
        store.tables[sheetName] = items;
        saveStore(store);
        result = true;
        break;
      }

      case 'db_addRow': {
        const sheetName = args[0] || 'Winners';
        const item = args[1] || {};
        if (!store.tables[sheetName]) store.tables[sheetName] = [];
        store.tables[sheetName].push(item);
        saveStore(store);
        result = true;
        break;
      }

      case 'ld_getRemainingPool_V2': {
        const range = parseInt(args[0]) || 100;
        const winners = store.tables.Winners || [];
        const wonNumbers = winners.map(w => parseInt(w.Code)).filter(n => !isNaN(n));
        const pool = [];
        for (let i = 1; i <= range; i++) {
          if (wonNumbers.indexOf(i) === -1) {
            pool.push(i);
          }
        }
        result = pool;
        break;
      }

      case 'ld_saveWinner': {
        const number = args[0];
        const prizeName = args[1];
        const winner = {
          Name: 'Số ' + number,
          Code: number,
          Prize: prizeName,
          Timestamp: new Date().toLocaleString('vi-VN'),
          ParticipantID: 'LD-' + number
        };
        if (!store.tables.Winners) store.tables.Winners = [];
        store.tables.Winners.push(winner);
        saveStore(store);
        result = winner;
        break;
      }

      case 'ld_clearDraw': {
        store.tables.Winners = [];
        saveStore(store);
        result = true;
        break;
      }

      default:
        result = null;
    }

    return res.status(200).json({ ok: true, result: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
};
