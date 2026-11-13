/**
 * VINA DRAGON - REALTIME CLOUD & LOCAL SHIM FOR VERCEL
 * Đồng bộ thời gian thực đa thiết bị (Điện thoại <-> Máy tính) không cần phụ thuộc thư mục /api
 * Kết hợp các kênh:
 *   1. BroadcastChannel + LocalStorage (0ms trên cùng máy tính / trình duyệt)
 *   2. Cloud Realtime SSE (EventSource <100ms, KHÔNG poll liên tục nên KHÔNG bị giới hạn 429)
 *   3. Catch-up Poll thông minh khi mở trang / bật lại màn hình / khi SSE chưa mở
 */
(function () {
  if (window.google && window.google.script && window.google.script.run) return;

  var CLOUD_TOPIC = 'vina_dragon_asean_2026_live_v3';
  var CLOUD_URL = 'https://ntfy.sh/' + CLOUD_TOPIC;
  var TAB_SENDER_ID = 'tab_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
  var localSeq = 0;

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

  // Khôi phục cấu hình (nhưng KHÔNG tự chạy lại hành động quay/dừng nhạc cũ từ phiên trước)
  try {
    var saved = localStorage.getItem('VD_VERCEL_STORE_V3');
    if (saved) {
      var parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        if (parsed.systemState) {
          memoryStore.systemState = {
            action: 'initial_sync',
            payload: parsed.systemState.payload || {},
            timestamp: parsed.systemState.timestamp || 0,
            msgId: parsed.systemState.msgId || ''
          };
        }
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

  var seenCloudIds = {};
  var seenMsgIds = {};
  var seenCfgIds = {};
  if (memoryStore.systemState && memoryStore.systemState.msgId) {
    seenMsgIds[memoryStore.systemState.msgId] = true;
  }

  // Kênh 1: BroadcastChannel + Storage Event (0ms giữa các tab cùng trình duyệt)
  var bc = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('vina_dragon_sync_v3');
      bc.onmessage = function (ev) {
        if (ev && ev.data) applyIncomingSync(ev.data, false);
      };
    }
  } catch (e) {}

  window.addEventListener('storage', function (ev) {
    if (ev && ev.key === 'VD_VERCEL_STORE_V3' && ev.newValue) {
      try {
        applyIncomingSync(JSON.parse(ev.newValue), false);
      } catch (e) {}
    }
  });

  function applyIncomingSync(incoming, isHistorical) {
    if (!incoming || typeof incoming !== 'object') return;
    var changed = false;

    if (incoming.bwConfig) {
      var incCfgId = incoming.bwConfig.cfgId || '';
      var incCfgTs = incoming.bwConfig.updatedAt || 0;
      var curCfgTs = memoryStore.bwConfig.updatedAt || 0;
      var isNewCfgPacket = !isHistorical && incCfgId && !seenCfgIds[incCfgId] && incoming.bwConfig.senderId !== TAB_SENDER_ID;
      if (incCfgId) seenCfgIds[incCfgId] = true;

      if (isNewCfgPacket || incCfgTs > curCfgTs || (incCfgTs === curCfgTs && !memoryStore.bwConfig.penaltiesCustom && incoming.bwConfig.penaltiesCustom)) {
        var nextCfg = Object.assign({}, memoryStore.bwConfig, incoming.bwConfig);
        nextCfg.updatedAt = Math.max(Date.now(), curCfgTs + 1, incCfgTs);
        memoryStore.bwConfig = nextCfg;
        changed = true;
      }
    }

    if (incoming.systemState && (incoming.systemState.timestamp || incoming.systemState.msgId)) {
      var s = incoming.systemState;
      var msgId = s.msgId || (String(s.action) + '_' + String(s.timestamp || 0));
      var curTs = (memoryStore.systemState && memoryStore.systemState.timestamp) || 0;

      if (isHistorical) {
        seenMsgIds[msgId] = true;
        if ((s.timestamp || 0) >= curTs) {
          memoryStore.systemState = {
            action: 'initial_sync',
            payload: s.payload || {},
            timestamp: Math.max(curTs, s.timestamp || 0),
            msgId: msgId
          };
          changed = true;
        }
      } else {
        // Bỏ qua nếu chính tab hiện tại vừa phát đi hoặc msgId này đã xử lý từ kênh khác
        if (s.senderId === TAB_SENDER_ID || seenMsgIds[msgId]) {
          if (changed) persistLocal();
          return;
        }
        seenMsgIds[msgId] = true;
        // Bảo đảm timestamp luôn tăng đơn điệu trên máy nhận bất kể lệch đồng hồ giữa 2 thiết bị
        var nextTs = Math.max(Date.now(), curTs + 1, s.timestamp || 0);
        memoryStore.systemState = {
          action: s.action,
          payload: s.payload || {},
          timestamp: nextTs,
          msgId: msgId,
          senderId: s.senderId
        };
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

  function nextSystemTimestamp() {
    var curTs = (memoryStore.systemState && memoryStore.systemState.timestamp) || 0;
    return Math.max(Date.now(), curTs + 1);
  }

  function nextConfigTimestamp() {
    var curTs = (memoryStore.bwConfig && memoryStore.bwConfig.updatedAt) || 0;
    return Math.max(Date.now(), curTs + 1);
  }

  function createMsgId() {
    localSeq += 1;
    return TAB_SENDER_ID + '_' + localSeq + '_' + Date.now();
  }

  var rateLimitedUntil = 0;
  var ntfyBlockedUntil = 0;
  var ntfyFailCount = 0;
  var apiSyncEnabled = true;

  var MQTT_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081/',
    'wss://broker.hivemq.com:8884/mqtt'
  ];
  var MQTT_BASE_TOPIC = 'vina_dragon/asean_2026_v3/' + CLOUD_TOPIC;
  var MQTT_CMD_TOPIC = MQTT_BASE_TOPIC + '/cmd';
  var MQTT_CFG_TOPIC = MQTT_BASE_TOPIC + '/cfg';

  function strToUtf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var utf8 = unescape(encodeURIComponent(str));
    var arr = new Uint8Array(utf8.length);
    for (var i = 0; i < utf8.length; i++) arr[i] = utf8.charCodeAt(i);
    return arr;
  }

  function utf8BytesToStr(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(bin));
  }

  function encodeVarLen(len) {
    var out = [];
    do {
      var d = len % 128;
      len = Math.floor(len / 128);
      if (len > 0) d = d | 0x80;
      out.push(d);
    } while (len > 0);
    return out;
  }

  function concatBytes(parts) {
    var total = 0;
    for (var i = 0; i < parts.length; i++) total += parts[i].length;
    var out = new Uint8Array(total);
    var pos = 0;
    for (var j = 0; j < parts.length; j++) {
      out.set(parts[j], pos);
      pos += parts[j].length;
    }
    return out;
  }

  function mqttConnectPacket(clientId) {
    var cidBytes = strToUtf8Bytes(clientId);
    var vh = new Uint8Array([0x00, 0x04, 0x4D, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x2D]);
    var cidLen = new Uint8Array([(cidBytes.length >> 8) & 0xFF, cidBytes.length & 0xFF]);
    var rem = encodeVarLen(vh.length + cidLen.length + cidBytes.length);
    return concatBytes([new Uint8Array([0x10].concat(rem)), vh, cidLen, cidBytes]);
  }

  function mqttSubscribePacket(pktId, topics) {
    var vh = new Uint8Array([(pktId >> 8) & 0xFF, pktId & 0xFF]);
    var parts = [vh];
    var remLen = 2;
    for (var i = 0; i < topics.length; i++) {
      var tb = strToUtf8Bytes(topics[i]);
      parts.push(new Uint8Array([(tb.length >> 8) & 0xFF, tb.length & 0xFF]));
      parts.push(tb);
      parts.push(new Uint8Array([0x00]));
      remLen += 2 + tb.length + 1;
    }
    var hdr = new Uint8Array([0x82].concat(encodeVarLen(remLen)));
    return concatBytes([hdr].concat(parts));
  }

  function mqttPublishPacket(topic, msgStr, retain) {
    var tb = strToUtf8Bytes(topic);
    var pb = strToUtf8Bytes(msgStr);
    var remLen = 2 + tb.length + pb.length;
    var hdrByte = retain ? 0x31 : 0x30;
    var hdr = new Uint8Array([hdrByte].concat(encodeVarLen(remLen)));
    var tLen = new Uint8Array([(tb.length >> 8) & 0xFF, tb.length & 0xFF]);
    return concatBytes([hdr, tLen, tb, pb]);
  }

  var mqttWs = null;
  var mqttConnected = false;
  var mqttBrokerIdx = 0;
  var mqttPingTimer = null;
  var mqttOpenTimer = null;
  var mqttRetryTimer = null;
  var mqttPktSeq = 1;

  function isMqttConnected() {
    return !!(mqttConnected && mqttWs && mqttWs.readyState === 1);
  }

  function publishMqttPacket(topic, msgStr, retain) {
    if (!isMqttConnected()) return false;
    try {
      mqttWs.send(mqttPublishPacket(topic, msgStr, !!retain));
      return true;
    } catch (e) {
      return false;
    }
  }

  function closeMqtt() {
    mqttConnected = false;
    if (mqttOpenTimer) { clearTimeout(mqttOpenTimer); mqttOpenTimer = null; }
    if (mqttPingTimer) { clearInterval(mqttPingTimer); mqttPingTimer = null; }
    if (mqttWs) {
      try { mqttWs.onopen = mqttWs.onmessage = mqttWs.onerror = mqttWs.onclose = null; mqttWs.close(); } catch (e) {}
      mqttWs = null;
    }
  }

  function scheduleMqttReconnect(delayMs) {
    if (mqttRetryTimer) return;
    mqttRetryTimer = setTimeout(function () {
      mqttRetryTimer = null;
      connectMqtt();
    }, delayMs || 4000);
  }

  function handleMqttBinary(buf) {
    var offset = 0;
    while (offset + 2 <= buf.length) {
      var hdr = buf[offset++];
      var pktType = hdr >> 4;
      var qos = (hdr >> 1) & 0x03;
      var mult = 1;
      var remLen = 0;
      var encoded = 0;
      do {
        if (offset >= buf.length) return;
        encoded = buf[offset++];
        remLen += (encoded & 127) * mult;
        mult *= 128;
      } while ((encoded & 128) !== 0);
      var pktEnd = offset + remLen;
      if (pktEnd > buf.length) return;

      if (pktType === 2) {
        // CONNACK
        if (remLen >= 2 && buf[offset + 1] === 0) {
          mqttConnected = true;
          syncStatus.mqtt = MQTT_BROKERS[mqttBrokerIdx];
          if (syncStatus.channel === 'init') syncStatus.channel = 'mqtt';
          markRealtimeActivity('mqtt');
          try {
            mqttWs.send(mqttSubscribePacket(++mqttPktSeq, [MQTT_CMD_TOPIC, MQTT_CFG_TOPIC]));
          } catch (e) {}
        }
      } else if (pktType === 3) {
        // PUBLISH
        if (offset + 2 <= pktEnd) {
          var tLen = (buf[offset] << 8) | buf[offset + 1];
          var p = offset + 2;
          if (p + tLen <= pktEnd) {
            var topic = utf8BytesToStr(buf.subarray(p, p + tLen));
            p += tLen;
            if (qos > 0) p += 2;
            var msgText = utf8BytesToStr(buf.subarray(p, pktEnd));
            markRealtimeActivity('mqtt');
            try {
              var payloadObj = JSON.parse(msgText);
              applyIncomingSync(payloadObj, topic === MQTT_CFG_TOPIC);
            } catch (e) {}
          }
        }
      }
      offset = pktEnd;
    }
  }

  function connectMqtt() {
    if (typeof WebSocket === 'undefined') return;
    if (mqttWs && (mqttWs.readyState === 0 || mqttWs.readyState === 1)) return;
    var brokerUrl = MQTT_BROKERS[mqttBrokerIdx % MQTT_BROKERS.length];
    try {
      var acked = false;
      mqttWs = new WebSocket(brokerUrl, 'mqtt');
      mqttWs.binaryType = 'arraybuffer';
      mqttOpenTimer = setTimeout(function () {
        mqttOpenTimer = null;
        if (!acked) {
          closeMqtt();
          mqttBrokerIdx = (mqttBrokerIdx + 1) % MQTT_BROKERS.length;
          scheduleMqttReconnect(2500);
        }
      }, 5000);

      mqttWs.onopen = function () {
        try {
          var cid = 'vd_' + Math.random().toString(36).slice(2, 10);
          mqttWs.send(mqttConnectPacket(cid));
          mqttPingTimer = setInterval(function () {
            if (mqttWs && mqttWs.readyState === 1) {
              try { mqttWs.send(new Uint8Array([0xC0, 0x00])); } catch (e) {}
            }
          }, 25000);
        } catch (e) {}
      };

      mqttWs.onmessage = function (evt) {
        acked = true;
        if (mqttOpenTimer) { clearTimeout(mqttOpenTimer); mqttOpenTimer = null; }
        if (evt.data instanceof ArrayBuffer) {
          handleMqttBinary(new Uint8Array(evt.data));
        }
      };

      mqttWs.onerror = function () {
        syncStatus.mqtt = false;
      };

      mqttWs.onclose = function () {
        syncStatus.mqtt = false;
        closeMqtt();
        if (!acked) mqttBrokerIdx = (mqttBrokerIdx + 1) % MQTT_BROKERS.length;
        scheduleMqttReconnect(acked ? 3000 : 5000);
      };
    } catch (e) {
      mqttBrokerIdx = (mqttBrokerIdx + 1) % MQTT_BROKERS.length;
      scheduleMqttReconnect(5000);
    }
  }

  // Đẩy trạng thái lên BroadcastChannel + LocalStorage + MQTT WSS + Same-origin Vercel /api/sync + ntfy.sh
  function broadcastSyncPacket(onCloudResult) {
    persistLocal();
    var packet = {
      systemState: memoryStore.systemState,
      bwConfig: memoryStore.bwConfig,
      tables: memoryStore.tables
    };
    var cfgOnlyPacket = {
      bwConfig: memoryStore.bwConfig,
      tables: memoryStore.tables
    };

    if (bc) {
      try { bc.postMessage(packet); } catch (e) {}
    }

    var bodyStr = JSON.stringify(packet);
    var cfgStr = JSON.stringify(cfgOnlyPacket);
    var mqttSent = publishMqttPacket(MQTT_CMD_TOPIC, bodyStr, false);
    if (mqttSent) publishMqttPacket(MQTT_CFG_TOPIC, cfgStr, true);

    var promises = [];
    if (apiSyncEnabled) {
      promises.push(
        fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
          keepalive: true
        }).then(function (r) {
          if (r && r.status === 404) { apiSyncEnabled = false; return false; }
          return !!(r && r.ok);
        }).catch(function () { return false; })
      );
    }

    if (Date.now() >= ntfyBlockedUntil && Date.now() >= rateLimitedUntil) {
      promises.push(
        fetch(CLOUD_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: bodyStr,
          keepalive: true
        }).then(function (r) {
          if (r && r.ok) {
            rateLimitedUntil = 0;
            ntfyFailCount = 0;
            ntfyBlockedUntil = 0;
            return true;
          }
          if (r && r.status === 429) rateLimitedUntil = Date.now() + 30000;
          return false;
        }).catch(function () {
          ntfyFailCount += 1;
          if (ntfyFailCount >= 2) ntfyBlockedUntil = Date.now() + 180000;
          return false;
        })
      );
    }

    if (typeof onCloudResult === 'function') {
      if (mqttSent) {
        onCloudResult(true);
      } else if (promises.length > 0) {
        Promise.all(promises).then(function (results) {
          var ok = results.some(Boolean);
          if (ok) onCloudResult(true);
          else onCloudResult(false, 'All cloud relays unavailable');
        });
      } else {
        onCloudResult(false, 'No active cloud relay');
      }
    }
  }

  // Kênh 2: Đồng bộ Cloud đa đường (MQTT-over-WSS + ntfy WS/SSE + Same-origin /api/sync fallback)
  var WS_URL = CLOUD_URL.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:') + '/ws';
  var ws = null;
  var wsOpenTimer = null;
  var wsRetryTimer = null;
  var lastWsAttemptAt = 0;
  var eventSource = null;
  var maxHistoricalServerTime = 0;
  var initialLoadDone = false;
  var apiSyncInitialized = false;
  var lastCatchupAt = 0;
  var lastRealtimeActivityAt = Date.now();
  var syncStatus = { channel: 'init', mqtt: false, ntfy: false, apiSync: true, lastActivityAt: lastRealtimeActivityAt };
  window.__VD_SYNC_STATUS = syncStatus;

  function markRealtimeActivity(channel) {
    lastRealtimeActivityAt = Date.now();
    syncStatus.lastActivityAt = lastRealtimeActivityAt;
    if (channel) syncStatus.channel = channel;
  }

  function recordNtfySuccess(channelName) {
    ntfyFailCount = 0;
    ntfyBlockedUntil = 0;
    syncStatus.ntfy = channelName || true;
    markRealtimeActivity(channelName || 'ntfy');
  }

  function recordNtfyFailure() {
    syncStatus.ntfy = false;
    ntfyFailCount += 1;
    if (ntfyFailCount >= 2) {
      ntfyBlockedUntil = Date.now() + 180000;
      closeWS();
      closeSSE();
    }
  }

  function processCloudLine(env, forceHistorical) {
    if (!env) return;
    if (env.event === 'open' || env.event === 'keepalive') {
      if (!forceHistorical) recordNtfySuccess(syncStatus.ntfy || 'ntfy');
      return;
    }
    if (!env.id || seenCloudIds[env.id]) return;
    seenCloudIds[env.id] = true;
    if (env.event === 'message' && env.message) {
      if (!forceHistorical) markRealtimeActivity();
      try {
        var data = JSON.parse(env.message);
        var isHist = !!forceHistorical || (maxHistoricalServerTime > 0 && env.time && env.time < maxHistoricalServerTime);
        applyIncomingSync(data, isHist);
      } catch (e) {}
    }
  }

  function catchupApiSync(forceHist) {
    if (!apiSyncEnabled) return Promise.resolve();
    return fetch('/api/sync')
      .then(function (r) {
        if (r.status === 404) {
          apiSyncEnabled = false;
          syncStatus.apiSync = false;
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.items)) return;
        var isInit = !!forceHist || !apiSyncInitialized;
        apiSyncInitialized = true;
        if (!isMqttConnected() && !syncStatus.ntfy) syncStatus.channel = 'api_sync';
        markRealtimeActivity();
        for (var i = 0; i < data.items.length; i++) {
          processCloudLine(data.items[i], isInit);
        }
      })
      .catch(function () {});
  }

  function catchupCloud(sinceStr, forceHistorical) {
    if (Date.now() < rateLimitedUntil || Date.now() < ntfyBlockedUntil) return Promise.resolve();
    var nowMs = Date.now();
    if (!forceHistorical && nowMs - lastCatchupAt < 4000) return Promise.resolve();
    lastCatchupAt = nowMs;

    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var abortTimer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 5000) : null;
    var fetchOpts = ctrl ? { signal: ctrl.signal } : undefined;

    return fetch(CLOUD_URL + '/json?poll=1&since=' + (sinceStr || '2m'), fetchOpts)
      .then(function (r) {
        if (abortTimer) { clearTimeout(abortTimer); abortTimer = null; }
        if (r.status === 429) {
          rateLimitedUntil = Date.now() + 45000;
          return '';
        }
        if (r.ok) recordNtfySuccess(syncStatus.ntfy || 'http');
        return r.ok ? r.text() : '';
      })
      .then(function (text) {
        if (!text) return;
        var lines = text.trim().split('\n');
        if (forceHistorical) {
          for (var k = 0; k < lines.length; k++) {
            try {
              var pre = JSON.parse(lines[k]);
              if (pre && pre.time && pre.time > maxHistoricalServerTime) {
                maxHistoricalServerTime = pre.time;
              }
            } catch (e) {}
          }
        }
        for (var i = 0; i < lines.length; i++) {
          try {
            var env = JSON.parse(lines[i]);
            processCloudLine(env, forceHistorical);
          } catch (e) {}
        }
      })
      .catch(function () {
        if (abortTimer) { clearTimeout(abortTimer); abortTimer = null; }
        recordNtfyFailure();
      });
  }

  function closeSSE() {
    if (eventSource) {
      try { eventSource.close(); } catch (e) {}
      eventSource = null;
    }
  }

  function closeWS() {
    if (wsOpenTimer) { clearTimeout(wsOpenTimer); wsOpenTimer = null; }
    if (ws) {
      try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; ws.close(); } catch (e) {}
      ws = null;
    }
  }

  function connectSSE() {
    if (Date.now() < rateLimitedUntil || Date.now() < ntfyBlockedUntil) return;
    if (ws && ws.readyState === 1) return;
    if (typeof EventSource === 'undefined') return;
    if (eventSource && eventSource.readyState !== 2) return;
    try {
      var sseOpened = false;
      eventSource = new EventSource(CLOUD_URL + '/sse');
      eventSource.addEventListener('open', function () {
        sseOpened = true;
        recordNtfySuccess('sse');
      });
      eventSource.addEventListener('keepalive', function () {
        recordNtfySuccess('sse');
      });
      eventSource.onmessage = function (evt) {
        sseOpened = true;
        recordNtfySuccess('sse');
        try {
          var env = JSON.parse(evt.data);
          processCloudLine(env, false);
        } catch (e) {}
      };
      eventSource.onerror = function () {
        if (!sseOpened) recordNtfyFailure();
        if (eventSource && eventSource.readyState === 2) {
          eventSource = null;
          if (Date.now() >= ntfyBlockedUntil) setTimeout(connectRealtime, 6000);
        }
      };
    } catch (e) {}
  }

  function scheduleWsRetry(delayMs) {
    if (wsRetryTimer) return;
    wsRetryTimer = setTimeout(function () {
      wsRetryTimer = null;
      connectWS();
    }, delayMs || 8000);
  }

  function connectWS() {
    if (Date.now() < rateLimitedUntil || Date.now() < ntfyBlockedUntil) return;
    if (typeof WebSocket === 'undefined') {
      connectSSE();
      return;
    }
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    lastWsAttemptAt = Date.now();
    try {
      var opened = false;
      ws = new WebSocket(WS_URL);
      wsOpenTimer = setTimeout(function () {
        wsOpenTimer = null;
        if (!opened) {
          closeWS();
          recordNtfyFailure();
          if (Date.now() >= ntfyBlockedUntil) {
            connectSSE();
            scheduleWsRetry(15000);
          }
        }
      }, 4500);

      ws.onopen = function () {
        opened = true;
        if (wsOpenTimer) { clearTimeout(wsOpenTimer); wsOpenTimer = null; }
        closeSSE();
        recordNtfySuccess('ws');
      };
      ws.onmessage = function (evt) {
        recordNtfySuccess('ws');
        try {
          var env = JSON.parse(evt.data);
          processCloudLine(env, false);
        } catch (e) {}
      };
      ws.onerror = function () {
        if (!opened) {
          recordNtfyFailure();
          if (Date.now() >= ntfyBlockedUntil) connectSSE();
        }
      };
      ws.onclose = function () {
        if (wsOpenTimer) { clearTimeout(wsOpenTimer); wsOpenTimer = null; }
        ws = null;
        if (!opened) recordNtfyFailure();
        if (Date.now() >= ntfyBlockedUntil) {
          connectSSE();
          scheduleWsRetry(opened ? 5000 : 15000);
        }
      };
    } catch (e) {
      connectSSE();
    }
  }

  function connectRealtime() {
    if (Date.now() >= ntfyBlockedUntil) {
      if (typeof WebSocket !== 'undefined') connectWS();
      else connectSSE();
    }
  }

  function initCloudRealtimeListener() {
    // 1. Kết nối ngay MQTT-over-WSS (hoạt động kể cả khi mạng/ISP chặn ntfy.sh)
    connectMqtt();

    // 2. Lấy cấu hình gần nhất từ ntfy.sh + /api/sync một lần lúc mở trang
    catchupCloud('12h', true).then(function () {
      initialLoadDone = true;
      connectRealtime();
    });
    catchupApiSync(true);

    // 3. Kết nối ngay ntfy WebSocket nếu mạng cho phép
    connectRealtime();

    // 4. Watchdog + Same-origin /api/sync fallback poll khi cả MQTT lẫn ntfy đều bị chặn/đứt
    setInterval(function () {
      if (!isMqttConnected() && apiSyncEnabled) {
        var ntfyHealthy = (Date.now() < ntfyBlockedUntil) ? false : ((ws && ws.readyState === 1) || (eventSource && eventSource.readyState === 1));
        if (!ntfyHealthy) {
          catchupApiSync(false);
        }
      }
    }, 3000);

    setInterval(function () {
      if (!initialLoadDone) return;
      if (!isMqttConnected()) connectMqtt();

      if (Date.now() < ntfyBlockedUntil) return;
      var hasLiveWS = !!(ws && ws.readyState === 1);
      var hasLiveSSE = !!(eventSource && eventSource.readyState === 1);
      var isStale = (Date.now() - lastRealtimeActivityAt) > 95000;

      if (isStale) {
        closeWS();
        closeSSE();
        connectRealtime();
        catchupCloud('2m', false);
        return;
      }

      if (!hasLiveWS && !hasLiveSSE) {
        connectRealtime();
        catchupCloud('2m', false);
      } else if (!hasLiveWS && typeof WebSocket !== 'undefined' && (Date.now() - lastWsAttemptAt > 60000)) {
        connectWS();
      }
    }, 15000);

    // 5. Khi mở lại tab / bật sáng màn hình / có mạng lại -> nối lại tất cả kênh realtime
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        if (!isMqttConnected()) connectMqtt();
        ntfyFailCount = 0;
        if (Date.now() >= ntfyBlockedUntil) {
          var healthy = (ws && ws.readyState === 1) || (eventSource && eventSource.readyState === 1);
          if (!healthy || (Date.now() - lastRealtimeActivityAt) > 30000) {
            connectRealtime();
            catchupCloud('2m', false);
          }
        }
        if (!isMqttConnected()) catchupApiSync(false);
      }
    });

    window.addEventListener('online', function () {
      ntfyFailCount = 0;
      ntfyBlockedUntil = 0;
      closeMqtt();
      closeWS();
      closeSSE();
      connectMqtt();
      connectRealtime();
      catchupCloud('2m', false);
      catchupApiSync(false);
    });
  }

  initCloudRealtimeListener();

  function executeMethod(method, args, doneCb) {
    switch (method) {
      case 'getSystemState':
        doneCb(null, memoryStore.systemState || null);
        return;

      case 'setSystemState':
        var action = args[0];
        var payload = args[1] || {};
        var msgId = createMsgId();
        memoryStore.systemState = {
          action: action,
          payload: payload,
          timestamp: nextSystemTimestamp(),
          msgId: msgId,
          senderId: TAB_SENDER_ID
        };
        seenMsgIds[msgId] = true;

        if (payload && Array.isArray(payload.penalties) && payload.penalties.length > 0) {
          var cleaned = payload.penalties.map(function (p) { return String(p || '').trim(); }).filter(Boolean);
          if (cleaned.length > 0) {
            memoryStore.bwConfig.penalties = cleaned;
            memoryStore.bwConfig.penaltiesCustom = true;
            memoryStore.bwConfig.updatedAt = nextConfigTimestamp();
            memoryStore.bwConfig.cfgId = createMsgId();
            memoryStore.bwConfig.senderId = TAB_SENDER_ID;
          }
        }
        broadcastSyncPacket(function (ok, errInfo) {
          if (ok) doneCb(null, true);
          else doneCb(new Error('Cloud sync failed: ' + errInfo));
        });
        return;

      case 'bw_getConfig':
        doneCb(null, formatBwConfig(memoryStore.bwConfig));
        return;

      case 'bw_setPenalties':
        if (Array.isArray(args[0])) {
          var cl = args[0].map(function (p) { return String(p || '').trim(); }).filter(Boolean);
          if (cl.length > 0) {
            memoryStore.bwConfig.penalties = cl;
            memoryStore.bwConfig.penaltiesCustom = true;
            memoryStore.bwConfig.updatedAt = nextConfigTimestamp();
            memoryStore.bwConfig.cfgId = createMsgId();
            memoryStore.bwConfig.senderId = TAB_SENDER_ID;
            broadcastSyncPacket();
          }
        }
        doneCb(null, formatBwConfig(memoryStore.bwConfig));
        return;

      case 'bw_setTotals':
        if (!isNaN(parseInt(args[0]))) memoryStore.bwConfig.giftTotal = Math.max(0, parseInt(args[0]));
        if (!isNaN(parseInt(args[1]))) memoryStore.bwConfig.lixiTotal = Math.max(0, parseInt(args[1]));
        memoryStore.bwConfig.updatedAt = nextConfigTimestamp();
        memoryStore.bwConfig.cfgId = createMsgId();
        memoryStore.bwConfig.senderId = TAB_SENDER_ID;
        broadcastSyncPacket();
        doneCb(null, formatBwConfig(memoryStore.bwConfig));
        return;

      case 'bw_addExtra':
        if (args[0] === 'gift') {
          memoryStore.bwConfig.giftTotal = Math.max(0, (memoryStore.bwConfig.giftTotal || 0) + (parseInt(args[1]) || 0));
        } else if (args[0] === 'lixi') {
          memoryStore.bwConfig.lixiTotal = Math.max(0, (memoryStore.bwConfig.lixiTotal || 0) + (parseInt(args[1]) || 0));
        }
        memoryStore.bwConfig.updatedAt = nextConfigTimestamp();
        memoryStore.bwConfig.cfgId = createMsgId();
        memoryStore.bwConfig.senderId = TAB_SENDER_ID;
        broadcastSyncPacket();
        doneCb(null, formatBwConfig(memoryStore.bwConfig));
        return;

      case 'bw_recordSpinResult':
        var s = String(args[0] || '').toLowerCase();
        if (s.indexOf('phần quà') > -1 || s.indexOf('🎁') > -1) {
          memoryStore.bwConfig.giftUsed = (memoryStore.bwConfig.giftUsed || 0) + 1;
        } else if (s.indexOf('lì xì') > -1 || s.indexOf('🧧') > -1) {
          memoryStore.bwConfig.lixiUsed = (memoryStore.bwConfig.lixiUsed || 0) + 1;
        }
        memoryStore.bwConfig.updatedAt = nextConfigTimestamp();
        memoryStore.bwConfig.cfgId = createMsgId();
        memoryStore.bwConfig.senderId = TAB_SENDER_ID;
        broadcastSyncPacket();
        doneCb(null, formatBwConfig(memoryStore.bwConfig));
        return;

      case 'bw_resetUsage':
        memoryStore.bwConfig.giftUsed = 0;
        memoryStore.bwConfig.lixiUsed = 0;
        memoryStore.bwConfig.updatedAt = nextConfigTimestamp();
        memoryStore.bwConfig.cfgId = createMsgId();
        memoryStore.bwConfig.senderId = TAB_SENDER_ID;
        broadcastSyncPacket();
        doneCb(null, formatBwConfig(memoryStore.bwConfig));
        return;

      case 'db_getAll':
        doneCb(null, (memoryStore.tables && memoryStore.tables[args[0]]) || []);
        return;

      case 'db_setAll':
        if (!memoryStore.tables) memoryStore.tables = {};
        memoryStore.tables[args[0] || 'Nominees'] = Array.isArray(args[1]) ? args[1] : [];
        broadcastSyncPacket();
        doneCb(null, true);
        return;

      case 'db_addRow':
        var sh = args[0] || 'Winners';
        if (!memoryStore.tables[sh]) memoryStore.tables[sh] = [];
        memoryStore.tables[sh].push(args[1] || {});
        broadcastSyncPacket();
        doneCb(null, true);
        return;

      case 'ld_getRemainingPool_V2':
        var maxR = parseInt(args[0]) || 100;
        var winners = (memoryStore.tables && memoryStore.tables.Winners) || [];
        var won = winners.map(function (w) { return parseInt(w.Code); });
        var pool = [];
        for (var i = 1; i <= maxR; i++) {
          if (won.indexOf(i) === -1) pool.push(i);
        }
        doneCb(null, pool);
        return;

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
        doneCb(null, wObj);
        return;

      case 'ld_clearDraw':
        memoryStore.tables.Winners = [];
        broadcastSyncPacket();
        doneCb(null, true);
        return;

      default:
        doneCb(null, null);
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
            executeMethod(method, args, function (err, res) {
              if (err) {
                if (typeof failureHandler === 'function') failureHandler(err);
              } else if (typeof successHandler === 'function') {
                successHandler(res);
              }
            });
          } catch (err) {
            if (typeof failureHandler === 'function') {
              failureHandler(err);
            }
          }
        }, 5);
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
