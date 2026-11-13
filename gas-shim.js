/**
 * VINA DRAGON - REALTIME CLOUD & LOCAL SHIM FOR VERCEL
 * Đồng bộ thời gian thực đa thiết bị (Điện thoại <-> Máy tính) không cần phụ thuộc thư mục /api
 * Kết hợp 3 kênh:
 *   1. BroadcastChannel + LocalStorage (0ms trên cùng máy tính)
 *   2. Cloud Realtime Pub/Sub qua ntfy.sh SSE + HTTP Poll (<100ms giữa Điện thoại 4G & Máy chiếu)
 *   3. /api/rpc (nếu có trên Vercel)
 */
(function () {
  if (window.google && window.google.script && window.google.script.run) return;

  var CLOUD_TOPIC = 'vina_dragon_asean_2026_live_v3';
  var CLOUD_URL = 'https://ntfy.sh/' + CLOUD_TOPIC;

  var DEFAULT_PENALTIES = [
    '💪 Nắm tai nhún nhảy 5 cái',
    '🎤 Hát 1 bài hát',
    '🍺 Uống 1 ly bia'
  ];

  function normalizePenalties(list) {
    if (!Array.isArray(list) || list.length === 0) return DEFAULT_PENALTIES.slice();
    return list.map(function (p) {
      var s = String(p || '').trim();
      var low = s.toLowerCase();
      if (low.indexOf('hít đất 10 cái') > -1 || low.indexOf('thụt dầu 10 cái') > -1) {
        return '💪 Nắm tai nhún nhảy 5 cái';
      }
      if (low.indexOf('vũ điệu lái xe') > -1) {
        return '🎤 Hát 1 bài hát';
      }
      return s;
    }).filter(Boolean);
  }

  var memoryStore = {
    systemState: null,
    bwConfig: {
      giftTotal: 6,
      giftUsed: 0,
      lixiTotal: 10,
      lixiUsed: 0,
      penalties: DEFAULT_PENALTIES.slice(),
      penaltiesCustom: false,
      updatedAt: 0
    },
    tables: {
      Nominees: [],
      Winners: []
    }
  };

  // Khôi phục từ LocalStorage nếu có
  try {
    var saved = localStorage.getItem('VD_VERCEL_STORE_V3');
    if (saved) {
      var parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        if (parsed.systemState) memoryStore.systemState = parsed.systemState;
        if (parsed.bwConfig) memoryStore.bwConfig = Object.assign(memoryStore.bwConfig, parsed.bwConfig);
        if (parsed.tables) memoryStore.tables = Object.assign(memoryStore.tables, parsed.tables);
      }
    }
  } catch (e) {}

  function persistLocal() {
    try {
      localStorage.setItem('VD_VERCEL_STORE_V3', JSON.stringify(memoryStore));
    } catch (e) {}
  }

  function formatBwConfig(cfg) {
    var giftTotal = cfg.giftTotal !== undefined ? parseInt(cfg.giftTotal) : 6;
    var giftUsed = cfg.giftUsed !== undefined ? parseInt(cfg.giftUsed) : 0;
    var lixiTotal = cfg.lixiTotal !== undefined ? parseInt(cfg.lixiTotal) : 10;
    var lixiUsed = cfg.lixiUsed !== undefined ? parseInt(cfg.lixiUsed) : 0;
    var penalties = normalizePenalties(cfg.penalties);

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

  // Kênh 1: BroadcastChannel + Storage Event (giữa các tab cùng trình duyệt)
  var bc = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('vina_dragon_sync_v3');
      bc.onmessage = function (ev) {
        if (ev && ev.data) applyIncomingSync(ev.data);
      };
    }
  } catch (e) {}

  window.addEventListener('storage', function (ev) {
    if (ev && ev.key === 'VD_VERCEL_STORE_V3' && ev.newValue) {
      try {
        applyIncomingSync(JSON.parse(ev.newValue));
      } catch (e) {}
    }
  });

  function applyIncomingSync(incoming, isHistorical) {
    if (!incoming || typeof incoming !== 'object') return;
    var changed = false;

    if (incoming.bwConfig) {
      var incCfgTs = incoming.bwConfig.updatedAt || 0;
      var curCfgTs = memoryStore.bwConfig.updatedAt || 0;
      if (incCfgTs >= curCfgTs) {
        memoryStore.bwConfig = Object.assign(memoryStore.bwConfig, incoming.bwConfig);
        changed = true;
      }
    }

    if (incoming.systemState && incoming.systemState.timestamp) {
      var curTs = (memoryStore.systemState && memoryStore.systemState.timestamp) || 0;
      if (incoming.systemState.timestamp > curTs) {
        if (isHistorical) {
          // Chỉ khôi phục cấu hình hình phạt từ lịch sử, không kích hoạt lại lệnh quay/dừng nhạc cũ
          memoryStore.systemState = {
            action: 'initial_sync',
            payload: incoming.systemState.payload || {},
            timestamp: incoming.systemState.timestamp
          };
        } else {
          memoryStore.systemState = incoming.systemState;
        }
        changed = true;
      }
    }

    if (incoming.tables) {
      memoryStore.tables = Object.assign(memoryStore.tables, incoming.tables);
      changed = true;
    }

    if (changed) {
      persistLocal();
    }
  }

  // Đẩy trạng thái lên Cloud Realtime (ntfy.sh) + BroadcastChannel
  function broadcastSyncPacket() {
    persistLocal();
    var packet = {
      systemState: memoryStore.systemState,
      bwConfig: memoryStore.bwConfig,
      tables: memoryStore.tables
    };

    if (bc) {
      try { bc.postMessage(packet); } catch (e) {}
    }

    // Gửi lên Cloud Realtime để mọi thiết bị (Điện thoại <-> Máy chiếu) nhận tức thì
    try {
      fetch(CLOUD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(packet)
      }).catch(function () {});
    } catch (e) {}
  }

  // Kênh 2: Nhận dữ liệu Realtime từ Cloud qua SSE (EventSource) + Poll dự phòng
  var seenCloudIds = {};
  var pageStartSec = Math.floor(Date.now() / 1000);

  function initCloudRealtimeListener() {
    // 1. Lấy trạng thái cấu hình gần nhất trên Cloud khi vừa mở trang
    fetch(CLOUD_URL + '/json?poll=1&since=12h')
      .then(function (r) { return r.text(); })
      .then(function (text) {
        if (!text) return;
        var lines = text.trim().split('\n');
        for (var i = 0; i < lines.length; i++) {
          try {
            var env = JSON.parse(lines[i]);
            if (env && env.id) seenCloudIds[env.id] = true;
            if (env && env.event === 'message' && env.message) {
              var data = JSON.parse(env.message);
              applyIncomingSync(data, true);
            }
          } catch (e) {}
        }
      })
      .catch(function () {});

    // 2. Kết nối luồng SSE thời gian thực (<100ms)
    if (typeof EventSource !== 'undefined') {
      try {
        var es = new EventSource(CLOUD_URL + '/sse');
        es.onmessage = function (evt) {
          try {
            var env = JSON.parse(evt.data);
            if (env && env.id) {
              if (seenCloudIds[env.id]) return;
              seenCloudIds[env.id] = true;
            }
            if (env && env.event === 'message' && env.message) {
              var data = JSON.parse(env.message);
              applyIncomingSync(data, false);
            }
          } catch (e) {}
        };
      } catch (e) {}
    }

    // 3. Poll dự phòng mỗi 1.5 giây phòng khi mạng chặn SSE
    setInterval(function () {
      fetch(CLOUD_URL + '/json?poll=1&since=15s')
        .then(function (r) { return r.text(); })
        .then(function (text) {
          if (!text) return;
          var lines = text.trim().split('\n');
          for (var i = 0; i < lines.length; i++) {
            try {
              var env = JSON.parse(lines[i]);
              if (!env || !env.id || seenCloudIds[env.id]) continue;
              seenCloudIds[env.id] = true;
              if (env.event === 'message' && env.message) {
                var isOld = env.time && (env.time < pageStartSec - 2);
                applyIncomingSync(JSON.parse(env.message), isOld);
              }
            } catch (e) {}
          }
        })
        .catch(function () {});
    }, 1500);
  }

  initCloudRealtimeListener();

  function executeMethod(method, args) {
    switch (method) {
      case 'getSystemState':
        return memoryStore.systemState || null;

      case 'setSystemState':
        var action = args[0];
        var payload = args[1] || {};
        memoryStore.systemState = {
          action: action,
          payload: payload,
          timestamp: Date.now()
        };
        if (payload && Array.isArray(payload.penalties) && payload.penalties.length > 0) {
          var cleaned = payload.penalties.map(function (p) { return String(p || '').trim(); }).filter(Boolean);
          if (cleaned.length > 0) {
            memoryStore.bwConfig.penalties = cleaned;
            memoryStore.bwConfig.penaltiesCustom = true;
            memoryStore.bwConfig.updatedAt = Date.now();
          }
        }
        broadcastSyncPacket();
        return true;

      case 'bw_getConfig':
        return formatBwConfig(memoryStore.bwConfig);

      case 'bw_setPenalties':
        if (Array.isArray(args[0])) {
          var cl = args[0].map(function (p) { return String(p || '').trim(); }).filter(Boolean);
          if (cl.length > 0) {
            memoryStore.bwConfig.penalties = cl;
            memoryStore.bwConfig.penaltiesCustom = true;
            memoryStore.bwConfig.updatedAt = Date.now();
            broadcastSyncPacket();
          }
        }
        return formatBwConfig(memoryStore.bwConfig);

      case 'bw_setTotals':
        if (!isNaN(parseInt(args[0]))) memoryStore.bwConfig.giftTotal = Math.max(0, parseInt(args[0]));
        if (!isNaN(parseInt(args[1]))) memoryStore.bwConfig.lixiTotal = Math.max(0, parseInt(args[1]));
        memoryStore.bwConfig.updatedAt = Date.now();
        broadcastSyncPacket();
        return formatBwConfig(memoryStore.bwConfig);

      case 'bw_addExtra':
        if (args[0] === 'gift') {
          memoryStore.bwConfig.giftTotal = Math.max(0, (memoryStore.bwConfig.giftTotal || 0) + (parseInt(args[1]) || 0));
        } else if (args[0] === 'lixi') {
          memoryStore.bwConfig.lixiTotal = Math.max(0, (memoryStore.bwConfig.lixiTotal || 0) + (parseInt(args[1]) || 0));
        }
        memoryStore.bwConfig.updatedAt = Date.now();
        broadcastSyncPacket();
        return formatBwConfig(memoryStore.bwConfig);

      case 'bw_recordSpinResult':
        var s = String(args[0] || '').toLowerCase();
        if (s.indexOf('phần quà') > -1 || s.indexOf('🎁') > -1) {
          memoryStore.bwConfig.giftUsed = (memoryStore.bwConfig.giftUsed || 0) + 1;
        } else if (s.indexOf('lì xì') > -1 || s.indexOf('🧧') > -1) {
          memoryStore.bwConfig.lixiUsed = (memoryStore.bwConfig.lixiUsed || 0) + 1;
        }
        memoryStore.bwConfig.updatedAt = Date.now();
        broadcastSyncPacket();
        return formatBwConfig(memoryStore.bwConfig);

      case 'bw_resetUsage':
        memoryStore.bwConfig.giftUsed = 0;
        memoryStore.bwConfig.lixiUsed = 0;
        memoryStore.bwConfig.updatedAt = Date.now();
        broadcastSyncPacket();
        return formatBwConfig(memoryStore.bwConfig);

      case 'db_getAll':
        return (memoryStore.tables && memoryStore.tables[args[0]]) || [];

      case 'db_setAll':
        if (!memoryStore.tables) memoryStore.tables = {};
        memoryStore.tables[args[0] || 'Nominees'] = Array.isArray(args[1]) ? args[1] : [];
        broadcastSyncPacket();
        return true;

      case 'db_addRow':
        var sh = args[0] || 'Winners';
        if (!memoryStore.tables[sh]) memoryStore.tables[sh] = [];
        memoryStore.tables[sh].push(args[1] || {});
        broadcastSyncPacket();
        return true;

      case 'ld_getRemainingPool_V2':
        var maxR = parseInt(args[0]) || 100;
        var winners = (memoryStore.tables && memoryStore.tables.Winners) || [];
        var won = winners.map(function (w) { return parseInt(w.Code); });
        var pool = [];
        for (var i = 1; i <= maxR; i++) {
          if (won.indexOf(i) === -1) pool.push(i);
        }
        return pool;

      case 'ld_saveWinner':
        if (!memoryStore.tables.Winners) memoryStore.tables.Winners = [];
        var wObj = {
          Name: 'Số ' + args[0],
          Code: args[0],
          Prize: args[1],
          Timestamp: new Date().toLocaleString('vi-VN'),
          ParticipantID: 'LD-' + args[0]
        };
        memoryStore.tables.Winners.push(wObj);
        broadcastSyncPacket();
        return wObj;

      case 'ld_clearDraw':
        memoryStore.tables.Winners = [];
        broadcastSyncPacket();
        return true;

      default:
        return null;
    }
  }

  var METHODS = [
    'getSystemState',
    'setSystemState',
    'bw_getConfig',
    'bw_setPenalties',
    'bw_setTotals',
    'bw_addExtra',
    'bw_recordSpinResult',
    'bw_resetUsage',
    'db_getAll',
    'db_setAll',
    'db_addRow',
    'ld_getRemainingPool_V2',
    'ld_saveWinner',
    'ld_clearDraw'
  ];

  function createRunner(successHandler, failureHandler) {
    var runner = {
      withSuccessHandler: function (fn) {
        return createRunner(fn, failureHandler);
      },
      withFailureHandler: function (fn) {
        return createRunner(successHandler, fn);
      }
    };

    METHODS.forEach(function (method) {
      runner[method] = function () {
        var args = Array.prototype.slice.call(arguments);
        setTimeout(function () {
          try {
            var res = executeMethod(method, args);
            if (typeof successHandler === 'function') {
              successHandler(res);
            }
          } catch (err) {
            if (typeof failureHandler === 'function') {
              failureHandler(err);
            }
          }
        }, 10);
      };
    });

    return runner;
  }

  window.google = {
    script: {
      run: createRunner(null, null)
    }
  };
})();
