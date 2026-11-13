/**
 * VINA DRAGON - GOOGLE APPS SCRIPT SHIM FOR VERCEL & WEB
 * Giả lập hoàn chỉnh google.script.run qua API /api/rpc kèm đồng bộ tức thì LocalStorage / BroadcastChannel
 */
(function () {
  if (window.google && window.google.script && window.google.script.run) return;

  var DEFAULT_PENALTIES = [
    '💪 Hít đất 10 cái',
    '🎤 Hát 1 bài hát',
    '🍺 Uống 1 ly bia'
  ];

  function getLocalStore() {
    try {
      var raw = localStorage.getItem('VD_VERCEL_STORE');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      systemState: null,
      bwConfig: {
        giftTotal: 6,
        giftUsed: 0,
        lixiTotal: 10,
        lixiUsed: 0,
        penalties: DEFAULT_PENALTIES.slice(),
        penaltiesCustom: false
      },
      tables: { Nominees: [], Winners: [] }
    };
  }

  function saveLocalStore(store) {
    try {
      localStorage.setItem('VD_VERCEL_STORE', JSON.stringify(store));
    } catch (e) {}
  }

  function formatLocalBwConfig(cfg) {
    var giftTotal = cfg.giftTotal !== undefined ? parseInt(cfg.giftTotal) : 6;
    var giftUsed = cfg.giftUsed !== undefined ? parseInt(cfg.giftUsed) : 0;
    var lixiTotal = cfg.lixiTotal !== undefined ? parseInt(cfg.lixiTotal) : 10;
    var lixiUsed = cfg.lixiUsed !== undefined ? parseInt(cfg.lixiUsed) : 0;
    var penalties = (Array.isArray(cfg.penalties) && cfg.penalties.length > 0)
      ? cfg.penalties
      : DEFAULT_PENALTIES.slice();
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

  function runLocalFallback(method, args) {
    var store = getLocalStore();
    switch (method) {
      case 'getSystemState':
        return store.systemState || null;
      case 'setSystemState':
        store.systemState = {
          action: args[0],
          payload: args[1] || {},
          timestamp: Date.now()
        };
        if (args[1] && Array.isArray(args[1].penalties) && args[1].penalties.length > 0) {
          store.bwConfig.penalties = args[1].penalties;
          store.bwConfig.penaltiesCustom = true;
        }
        saveLocalStore(store);
        return true;
      case 'bw_getConfig':
        return formatLocalBwConfig(store.bwConfig);
      case 'bw_setPenalties':
        if (Array.isArray(args[0]) && args[0].length > 0) {
          store.bwConfig.penalties = args[0];
          store.bwConfig.penaltiesCustom = true;
          saveLocalStore(store);
        }
        return formatLocalBwConfig(store.bwConfig);
      case 'bw_setTotals':
        if (!isNaN(parseInt(args[0]))) store.bwConfig.giftTotal = Math.max(0, parseInt(args[0]));
        if (!isNaN(parseInt(args[1]))) store.bwConfig.lixiTotal = Math.max(0, parseInt(args[1]));
        saveLocalStore(store);
        return formatLocalBwConfig(store.bwConfig);
      case 'bw_addExtra':
        if (args[0] === 'gift') store.bwConfig.giftTotal = Math.max(0, (store.bwConfig.giftTotal || 0) + (parseInt(args[1]) || 0));
        if (args[0] === 'lixi') store.bwConfig.lixiTotal = Math.max(0, (store.bwConfig.lixiTotal || 0) + (parseInt(args[1]) || 0));
        saveLocalStore(store);
        return formatLocalBwConfig(store.bwConfig);
      case 'bw_recordSpinResult':
        var s = String(args[0] || '').toLowerCase();
        if (s.indexOf('phần quà') > -1 || s.indexOf('🎁') > -1) store.bwConfig.giftUsed = (store.bwConfig.giftUsed || 0) + 1;
        else if (s.indexOf('lì xì') > -1 || s.indexOf('🧧') > -1) store.bwConfig.lixiUsed = (store.bwConfig.lixiUsed || 0) + 1;
        saveLocalStore(store);
        return formatLocalBwConfig(store.bwConfig);
      case 'bw_resetUsage':
        store.bwConfig.giftUsed = 0;
        store.bwConfig.lixiUsed = 0;
        saveLocalStore(store);
        return formatLocalBwConfig(store.bwConfig);
      case 'db_getAll':
        return (store.tables && store.tables[args[0]]) || [];
      case 'ld_getRemainingPool_V2':
        var maxR = parseInt(args[0]) || 100;
        var winners = (store.tables && store.tables.Winners) || [];
        var won = winners.map(function (w) { return parseInt(w.Code); });
        var pool = [];
        for (var i = 1; i <= maxR; i++) {
          if (won.indexOf(i) === -1) pool.push(i);
        }
        return pool;
      case 'ld_saveWinner':
        if (!store.tables.Winners) store.tables.Winners = [];
        var wObj = {
          Name: 'Số ' + args[0],
          Code: args[0],
          Prize: args[1],
          Timestamp: new Date().toLocaleString('vi-VN'),
          ParticipantID: 'LD-' + args[0]
        };
        store.tables.Winners.push(wObj);
        saveLocalStore(store);
        return wObj;
      case 'ld_clearDraw':
        store.tables.Winners = [];
        saveLocalStore(store);
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
        // Cập nhật tức thì trên localStorage cho cùng trình duyệt
        var localRes = runLocalFallback(method, args);

        fetch('/api/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: method, args: args })
        })
          .then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.json();
          })
          .then(function (data) {
            var res = (data && data.ok !== false) ? data.result : localRes;
            // Nếu là getSystemState, lấy bản mới hơn giữa Server và LocalStorage
            if (method === 'getSystemState') {
              var localState = getLocalStore().systemState;
              if (localState && (!res || (localState.timestamp || 0) > (res.timestamp || 0))) {
                res = localState;
              }
            }
            if (typeof successHandler === 'function') {
              successHandler(res);
            }
          })
          .catch(function () {
            // Fallback mượt mà về LocalStorage nếu chạy tĩnh hoặc mất mạng tạm thời
            if (typeof successHandler === 'function') {
              successHandler(localRes);
            } else if (typeof failureHandler === 'function') {
              failureHandler('Offline fallback');
            }
          });
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
