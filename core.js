
    /**
     * VINA DRAGON - ROBUST JAVASCRIPT CORE
     * Standard prototype-based functions for maximum compatibility.
     */
    // VERSION: 1.0.5 - Added SHOW_ALL_LIST
    var EVENT_TYPES = {
        SHOW_INDIVIDUAL_AWARD: 'show_individual_award',
        SHOW_TEAM_AWARD: 'show_team_award',
        RESET_DISPLAY: 'reset_display',
        UPDATE_SETTINGS: 'update_settings',
        SHOW_SLIDESHOW: 'show_slideshow',
        SHOW_ALL_LIST: 'show_all_list',

        // Lucky Draw Events
        LD_START_SPIN: 'ld_start_spin',
        LD_SHOW_WINNER: 'ld_show_winner',
        LD_RESET: 'ld_reset',

        // Bonus Wheel Events
        BW_SHOW_HAND: 'bw_show_hand',
        BW_START_SPIN: 'bw_start_spin',
        BW_SHOW_RESULT: 'bw_show_result',
        BGM_CONTROL: 'bgm_control'
    };

    /**
     * DATA MANAGER
     */
    function DataManager() {
        this.cache = { nominees: [] };
    }

    DataManager.prototype.getNominees = function (forceRefresh) {
        var self = this;
        if (this.cache.nominees && this.cache.nominees.length > 0 && !forceRefresh) {
            return Promise.resolve(this.cache.nominees);
        }
        return new Promise(function (resolve, reject) {
            google.script.run
                .withSuccessHandler(function (data) {
                    self.cache.nominees = data;
                    // Proactive preloading of images for smoothness
                    if (data && data.length > 0) {
                        data.forEach(function (item) {
                            var img = new Image();
                            var url = item.Image || item.image;
                            if (url) {
                                var id = String(url).match(/[-\w]{25,}/);
                                img.src = id ? 'https://drive.google.com/thumbnail?id=' + id[0] + '&sz=w1600' : url;
                            }
                        });
                    }
                    resolve(data);
                })
                .withFailureHandler(reject)
                .db_getAll('Nominees');
        });
    };

    /**
     * BROADCAST MANAGER
     */
    function BroadcastManager() {
        this.listeners = {};
        this.lastTimestamp = 0;
        this.initialized = false;
        this.onStateChange = null;
        this.isPolling = false;
        this.pollInterval = 800; // Faster response (0.8s)
    }

    BroadcastManager.prototype.startPolling = function () {
        if (this.isPolling) return;
        this.isPolling = true;
        var self = this;

        function poll() {
            google.script.run
                .withSuccessHandler(function (state) {
                    if (state) {
                        if (self.onStateChange) self.onStateChange(state);
                        if (!self.initialized) {
                            self.initialized = true;
                            self.lastTimestamp = state.timestamp || 0;
                        } else if (state.timestamp > self.lastTimestamp) {
                            self.lastTimestamp = state.timestamp;
                            self.handleMessage(state);
                        }
                    } else {
                        self.initialized = true;
                    }
                    setTimeout(poll, self.pollInterval);
                })
                .withFailureHandler(function (err) {
                    console.warn('Sync Polling Error:', err);
                    setTimeout(poll, 3000); // Backoff on error
                })
                .getSystemState();
        }
        poll();
    };

    BroadcastManager.prototype.send = function (type, payload) {
        var self = this;
        this.lastTimestamp = Date.now();
        google.script.run
            .withSuccessHandler(function () { console.log('📤 Broadcast Success'); })
            .withFailureHandler(function (e) { console.error('📤 Broadcast Fail:', e); })
            .setSystemState(type, payload || {});
    };

    BroadcastManager.prototype.handleMessage = function (m) {
        console.log('📥 Received:', m.action, m.payload);
        var callbacks = this.listeners[m.action];
        if (callbacks) {
            callbacks.forEach(function (cb) {
                try { cb(m.payload); } catch (e) { console.error('Handler error:', e); }
            });
        }
    };

    BroadcastManager.prototype.on = function (type, cb) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(cb);
    };

    window.EVENT_TYPES = EVENT_TYPES;
    window.DataManager = DataManager;
    window.BroadcastManager = BroadcastManager;

    /**
     * LUCKY WHEEL ENGINE
     */
    function LuckyWheel(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.participants = [];
        this.isSpinning = false;
        this.currentAngle = 0;
        this.colors = [
            '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
            '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe',
            '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000',
            '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'
        ];
        this.init();
    }

    LuckyWheel.prototype.init = function () {
        this.canvas.width = 1200;
        this.canvas.height = 1200;
        this.radius = 580;
        this.centerX = 600;
        this.centerY = 600;
    };

    LuckyWheel.prototype.setParticipants = function (list) {
        this.participants = list || [];

        // If too few, mock some for visuals to keep it "full"
        // But keep it consistent
        if (this.participants.length < 10 && this.participants.length > 0) {
            var original = this.participants.slice();
            while (this.participants.length < 20) {
                this.participants = this.participants.concat(original);
            }
        }

        // Adjust base font size after final slice count is known
        this.fontSize = 38;
        if (this.participants.length > 20) this.fontSize = 32;
        if (this.participants.length > 40) this.fontSize = 22;

        this.draw();
    };

    LuckyWheel.prototype.draw = function () {
        var ctx = this.ctx;
        var centerX = this.centerX;
        var centerY = this.centerY;
        var radius = this.radius;
        var participants = this.participants;

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (!participants.length) return;

        var sliceAngle = (Math.PI * 2) / participants.length;

        for (var i = 0; i < participants.length; i++) {
            var startAngle = this.currentAngle + i * sliceAngle;
            var endAngle = startAngle + sliceAngle;

            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.closePath();
            ctx.fillStyle = this.colors[i % this.colors.length];
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Text
            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate(startAngle + sliceAngle / 2);
            ctx.textAlign = "right";

            var bgCol = this.colors[i % this.colors.length];
            var r = parseInt(bgCol.slice(1, 3), 16);
            var g = parseInt(bgCol.slice(3, 5), 16);
            var b = parseInt(bgCol.slice(5, 7), 16);
            var brightness = (r * 299 + g * 587 + b * 114) / 1000;
            ctx.fillStyle = (brightness < 128) ? "#fff" : "#000";

            var label = String(participants[i].Name || participants[i].Code || participants[i]);
            var fSize = this.fontSize;
            var maxTextWidth = radius - 145; // Keep clear of center hub (70px) and outer rim
            ctx.font = "bold " + fSize + "px 'Be Vietnam Pro', Arial";
            while (fSize > 20 && ctx.measureText(label).width > maxTextWidth) {
                fSize -= 2;
                ctx.font = "bold " + fSize + "px 'Be Vietnam Pro', Arial";
            }

            ctx.shadowBlur = 4;
            ctx.shadowColor = "rgba(0,0,0,0.5)";

            ctx.fillText(label, radius - 34, fSize / 3, maxTextWidth);
            ctx.restore();
        }

        // Hub
        ctx.beginPath();
        ctx.arc(centerX, centerY, 70, 0, Math.PI * 2);
        ctx.fillStyle = "#FFD700";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 15;
        ctx.stroke();
    };

    LuckyWheel.prototype.spinTo = function (targetIndex, onComplete) {
        if (this.isSpinning) return;
        this.isSpinning = true;

        var sliceAngle = (Math.PI * 2) / this.participants.length;
        var extraRots = Math.floor(10 + Math.random() * 5); // At least 10 full rotations

        // 1. Calculate the center angle of the target slice relative to wheel's 0 position
        // Slice 0 is at currentAngle + 0
        // Slice i center is at i * sliceAngle + 0.5 * sliceAngle
        var randomOffset = sliceAngle * (0.2 + Math.random() * 0.6);
        var targetRelativeAngle = (targetIndex * sliceAngle) + randomOffset;

        // 2. We want: (this.currentAngle + targetRelativeAngle) % 2PI = 1.5 * PI (Top)
        // => this.currentAngle = 1.5 * PI - targetRelativeAngle
        var targetAngleMod = (1.5 * Math.PI) - targetRelativeAngle;

        // 3. Normalize targetAngleMod to be in [0, 2PI)
        while (targetAngleMod < 0) targetAngleMod += Math.PI * 2;
        targetAngleMod = targetAngleMod % (Math.PI * 2);

        // 4. Calculate current mod
        var currentMod = this.currentAngle % (Math.PI * 2);
        while (currentMod < 0) currentMod += Math.PI * 2;

        // 5. Calculate rotation needed to reach targetMod from currentMod
        var rotationInThisLap = targetAngleMod - currentMod;
        if (rotationInThisLap <= 0) rotationInThisLap += Math.PI * 2;

        // 6. Total rotation = extra full laps + rotation to target
        var totalRotation = (extraRots * Math.PI * 2) + rotationInThisLap;

        var startAngle = this.currentAngle;
        var finalAngle = startAngle + totalRotation;

        var startTime = null;
        var duration = 7000; // Slightly longer for better physics feel
        var self = this;

        function animate(timestamp) {
            if (!startTime) startTime = timestamp;
            var elapsed = timestamp - startTime;
            var progress = Math.min(elapsed / duration, 1);

            // Custom cubic-bezier like easeOut
            var ease = 1 - Math.pow(1 - progress, 5);
            self.currentAngle = startAngle + (finalAngle - startAngle) * ease;
            self.draw();

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                self.isSpinning = false;
                if (onComplete) onComplete();
            }
        }
        requestAnimationFrame(animate);
    };

    window.LuckyWheel = LuckyWheel;
