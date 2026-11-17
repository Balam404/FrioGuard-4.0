
(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);

    const state = {
        temp: 4,
        outside: 26,
        door: false,
        doorVisual: 0,
        failure: false,
        yaw: 0.49,
        pitch: 0.21,
        radius: 10.3,
        sound: false,
        history: [],
        events: [],
        secondsOut: 0,
        started: Date.now(),
        alarm: false,
        reason: 'normal',
        previousReason: 'normal'
    };

    let ac = null;
    let lastBeep = 0;
    let lastFrame = performance.now();
    let drag = null;

    const canvas = $('scene');
    const ctx = canvas.getContext('2d');
    const chart = $('chart');
    const chartCtx = chart.getContext('2d');

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const V = (x, y, z) => [x, y, z];
    const sub = (a, b) => [
        a[0] - b[0], a[1] - b[1], a[2] - b[2]
    ];
    const add = (a, b) => [
        a[0] + b[0], a[1] + b[1], a[2] + b[2]
    ];
    const dot = (a, b) =>
        a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    const cross = (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];

    const norm = (v) => {
        const l = Math.hypot(...v) || 1;
        return v.map(x => x / l);
    };

    function cameraState(w, h) {
        const target = V(0, 1.48, 0);
        const cam = add(
            target,
            V(
                state.radius * Math.sin(state.yaw) * Math.cos(state.pitch),
                state.radius * Math.sin(state.pitch),
                state.radius * Math.cos(state.yaw) * Math.cos(state.pitch)
            )
        );
        const forward = norm(sub(target, cam));
        const right = norm(cross(forward, V(0, 1, 0)));
        const up = cross(right, forward);
        const f = Math.min(w * 1.20, h * 1.80);
        return { cam, forward, right, up, w, h, f };
    }

    function project(p, c) {
        const q = sub(p, c.cam);
        const z = dot(q, c.forward);
        if (z <= .1) return null;

        const sc = c.f / z;
        return {
            x: c.w / 2 + dot(q, c.right) * sc,
            y: c.h / 2 - dot(q, c.up) * sc,
            z,
            s: sc
        };
    }

    function csize(cv) {
        const b = cv.getBoundingClientRect();
        const dpr = Math.min(devicePixelRatio || 1, 2);
        const w = Math.round(b.width * dpr);
        const h = Math.round(b.height * dpr);

        if (cv.width !== w || cv.height !== h) {
            cv.width = w;
            cv.height = h;
        }
        return [w, h, dpr];
    }

    function tint(hex, fac) {
        const n = parseInt(hex.replace('#', ''), 16);
        return `rgb(${clamp(Math.round(((n >> 16) & 255) * fac), 0, 255)},${clamp(Math.round(((n >> 8) & 255) * fac), 0, 255)},${clamp(Math.round((n & 255) * fac), 0, 255)})`;
    }

    let polys = [];

    function quad(pts, color, alpha = 1, edge = null) {
        polys.push({ pts, color, alpha, edge });
    }

    function box(x1, y1, z1, x2, y2, z2, col, alpha = 1) {
        const a = V(x1, y1, z1);
        const b = V(x2, y1, z1);
        const c = V(x2, y2, z1);
        const d = V(x1, y2, z1);
        const e = V(x1, y1, z2);
        const f = V(x2, y1, z2);
        const g = V(x2, y2, z2);
        const h = V(x1, y2, z2);

        quad([a, b, c, d], tint(col, .67), alpha);
        quad([e, f, g, h], tint(col, 1.10), alpha);
        quad([a, e, h, d], tint(col, .85), alpha);
        quad([b, f, g, c], tint(col, .72), alpha);
        quad([d, c, g, h], tint(col, 1.20), alpha);
        quad([a, b, f, e], tint(col, .53), alpha);
    }

    function doorPt(x, y, z) {
        const theta = -state.doorVisual * 1.68;
        const dx = x + 2.21;
        const dz = z - 1.58;

        return V(
            -2.21 + dx * Math.cos(theta) + dz * Math.sin(theta),
            y,
            1.58 - dx * Math.sin(theta) + dz * Math.cos(theta)
        );
    }

    function doorBox(x1, y1, z1, x2, y2, z2, col) {
        const a = doorPt(x1, y1, z1);
        const b = doorPt(x2, y1, z1);
        const c = doorPt(x2, y2, z1);
        const d = doorPt(x1, y2, z1);
        const e = doorPt(x1, y1, z2);
        const f = doorPt(x2, y1, z2);
        const g = doorPt(x2, y2, z2);
        const h = doorPt(x1, y2, z2);

        quad([a, b, c, d], tint(col, .75));
        quad([e, f, g, h], tint(col, 1.12));
        quad([a, e, h, d], tint(col, .75));
        quad([b, f, g, c], tint(col, .87));
        quad([d, c, g, h], tint(col, 1.2));
        quad([a, b, f, e], tint(col, .6));
    }

    let camStateCached;

    function circle3(x, y, z, r, col, outline = null) {
        const c = project(V(x, y, z), camStateCached);
        if (!c) return;

        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(1, r * c.s), 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();

        if (outline) {
            ctx.strokeStyle = outline;
            ctx.lineWidth = Math.max(1, c.s * .01);
            ctx.stroke();
        }
    }

    function line3(a, b, col, lw = 1) {
        let x = project(a, camStateCached);
        let y = project(b, camStateCached);
        if (!x || !y) return;

        ctx.beginPath();
        ctx.moveTo(x.x, x.y);
        ctx.lineTo(y.x, y.y);
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.stroke();
    }

    function label3(p, text, bg = '#082236') {
        const q = project(p, camStateCached);
        if (!q) return;

        const fs = clamp(11 * q.s / 75, 10, 14);
        const pad = 7;
        ctx.font = `700 ${fs}px system-ui`;
        const tw = ctx.measureText(text).width;

        ctx.fillStyle = bg;
        ctx.strokeStyle = '#5d98bb';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(
            q.x - tw / 2 - pad,
            q.y - fs - 10,
            tw + pad * 2,
            fs + pad * 2,
            6
        );
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#e1f6ff';
        ctx.fillText(text, q.x - tw / 2, q.y - 8);
    }

    // DIBUJO DE LA CAMARA FRIGORIFICA 3D
    function sceneRender(now) {
        const [w, h] = csize(canvas);
        camStateCached = cameraState(w, h);
        ctx.clearRect(0, 0, w, h);

        const gradient = ctx.createRadialGradient(
            w * .54, h * .40, 20,
            w * .50, h * .53, Math.max(w, h) * .75
        );
        gradient.addColorStop(0, '#23445e');
        gradient.addColorStop(.6, '#102c43');
        gradient.addColorStop(1, '#061322');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);

        // Cuadricula del suelo
        for (let n = -10; n <= 10; n++) {
            line3(
                V(n * .7, -.20, -7),
                V(n * .7, -.20, 7),
                '#35607735', 1
            );
            line3(
                V(-7, -.20, n * .7),
                V(7, -.20, n * .7),
                '#35607735', 1
            );
        }

        const glow = ctx.createRadialGradient(
            w * .5, h * .80, 1,
            w * .5, h * .8, w * .40
        );
        glow.addColorStop(0, '#8ddfff19');
        glow.addColorStop(1, '#8ddfff00');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);

        polys = [];

        // Estructura de refrigeracion
        box(-2.40, -.22, -1.52, 2.40, .08, 1.74, '#b1d6e4');
        box(-2.36, 0, -1.55, 2.36, 3.19, -1.38, '#e7f7fa');
        box(-2.42, .03, -1.52, -2.27, 3.18, 1.62, '#a5ccdb', .57);
        box(2.27, .03, -1.52, 2.43, 3.18, 1.62, '#b7dce8', .50);
        box(-2.42, 3.15, -1.62, 2.43, 3.35, 1.76, '#d5edf4');

        // Pared interior
        box(-2.20, .18, -1.35, 2.19, 3.04, -1.31, '#17455f', .65);

        // Estantes interiores
        for (let y of [.83, 1.68, 2.53]) {
            box(-1.98, y, -1.04, 1.92, y + .11, .85, '#8aaebe');
        }

        for (let x of [-1.90, 1.86]) {
            box(x, .08, -1.12, x + .08, 2.65, -1.03, '#8ca3af');
        }

        // Cajas de productos
        const crateColors = [
            '#dfc69f', '#acd3e3', '#d5e2e4',
            '#a9d3d5', '#b5cfe6', '#e2d1ac',
            '#c7dede', '#c9c4b0'
        ];

        let idx = 0;

        for (const yy of [1.0, 1.85]) {
            for (const xx of [-1.49, -.23, 1.03]) {
                const cc = crateColors[idx++ % crateColors.length];
                box(xx, yy, -.80, xx + .96, yy + .54, .38, cc);
                box(
                    xx + .11, yy + .48, -.78,
                    xx + .83, yy + .53, .35,
                    '#597a8d'
                );
            }
        }

        for (const xx of [-1.55, -.2, 1.0]) {
            box(
                xx, .10, -.7,
                xx + 1.1, .60, .48,
                crateColors[idx++ % crateColors.length]
            );
        }

        // Sensores y modulo exterior
        box(-2.18, 1.88, .45, -2.02, 2.19, .67, '#45d9fa');
        box(2.43, 1.16, .42, 2.89, 2.40, 1.34, '#12263c');
        box(2.87, 1.32, .54, 2.92, 2.26, 1.24, '#234a67');

        // Indicadores de alarma
        box(
            2.91, 1.90, 1.07,
            2.96, 2.02, 1.19,
            state.alarm ? '#fd4f64' : '#55dbaa'
        );
        box(
            2.91, 1.69, 1.07,
            2.96, 1.79, 1.19,
            state.alarm ? '#b94b4e' : '#3688ae'
        );

        // Marco de entrada
        box(-2.39, 0, 1.54, -2.23, 3.18, 1.72, '#e5f4f5');
        box(2.22, 0, 1.54, 2.38, 3.18, 1.72, '#cfe6ed');
        box(-2.37, 3.04, 1.54, 2.37, 3.20, 1.72, '#e5f5f7');

        // Puerta animada
        doorBox(-2.21, .10, 1.59, 2.12, .27, 1.74, '#d8f0f6');
        doorBox(-2.21, 2.97, 1.59, 2.12, 3.13, 1.74, '#e0f4f8');
        doorBox(-2.21, .14, 1.59, -2.04, 3.06, 1.74, '#dcebf2');
        doorBox(1.95, .14, 1.59, 2.12, 3.06, 1.74, '#c5e5eb');
        doorBox(-2.06, 1.51, 1.59, 1.96, 1.59, 1.74, '#91c0d4');

        // Paneles de cristal
        quad([
            doorPt(-2.01, .28, 1.68),
            doorPt(1.93, .28, 1.68),
            doorPt(1.93, 1.47, 1.68),
            doorPt(-2.01, 1.47, 1.68)
        ], '#7de3ff', .09, '#8cc7db');

        quad([
            doorPt(-2.01, 1.64, 1.68),
            doorPt(1.93, 1.64, 1.68),
            doorPt(1.93, 2.95, 1.68),
            doorPt(-2.01, 2.95, 1.68)
        ], '#b7f3ff', .11, '#90cbdc');

        // Manija de la puerta
        doorBox(1.73, 1.33, 1.72, 1.88, 1.98, 1.92, '#598b9f');

        // Orden de profundidad 3D
        polys.sort((u, v) => {
            const avg = (p) => p.pts.reduce(
                (s, v) => s + dot(
                    sub(v, camStateCached.cam),
                    camStateCached.forward
                ), 0
            ) / p.pts.length;
            return avg(v) - avg(u);
        });

        for (const q of polys) {
            const p = q.pts.map(x => project(x, camStateCached));
            if (p.some(x => !x)) continue;

            ctx.beginPath();
            ctx.moveTo(p[0].x, p[0].y);

            for (let k = 1; k < p.length; k++) {
                ctx.lineTo(p[k].x, p[k].y);
            }

            ctx.closePath();
            ctx.fillStyle = q.color;
            ctx.globalAlpha = q.alpha;
            ctx.fill();
            ctx.strokeStyle = q.edge || '#c6e9f81b';
            ctx.lineWidth = 1.1;
            ctx.stroke();
        }

        ctx.globalAlpha = 1;

        // Ventilador animado
        circle3(0, 2.78, -1.28, .19, '#0a2a42', '#64adc6');

        for (let k = 0; k < 4; k++) {
            let a = now / 800 + k * Math.PI / 2;
            line3(
                V(
                    Math.cos(a) * .05,
                    2.78 + Math.sin(a) * .05,
                    -1.22
                ),
                V(
                    Math.cos(a + .35) * .16,
                    2.78 + Math.sin(a + .35) * .16,
                    -1.22
                ),
                '#b9edff',
                Math.max(1, w / 480)
            );
        }

        circle3(0, 2.78, -1.17, .05, '#daf9ff');

        // Indicadores visuales de sensores
        circle3(-2.09, 2.10, .59, .07, '#68e7ff');

        circle3(
            2.94, 1.98, 1.10, .08,
            state.alarm
                ? (Math.sin(now / 200) > 0 ? '#ff4054' : '#9e334c')
                : '#5bffbb'
        );

        // Etiquetas del modelo
        label3(V(-1.6, 3.44, .2), 'CÁMARA FRÍA');
        label3(V(2.99, 2.68, 1.09), 'ESP32 / ALARMA');
        label3(V(-2.1, 1.76, .7), 'DS18B20');
        label3(doorPt(1.86, .98, 1.85), 'PUERTA');

        // Particulas decorativas
        for (let i = 0; i < 17; i++) {
            const p = V(
                (i * 1.37 % 3.65) - 1.8,
                .33 + ((now / 4200 + i * .119) % 2.42),
                ((i * 1.17) % 2.15) - 1.07
            );
            const q = project(p, camStateCached);
            if (!q) continue;

            ctx.globalAlpha = .14 + .12 * Math.sin(i + now / 1100);
            ctx.fillStyle = '#a9f5ff';
            ctx.beginPath();
            ctx.arc(
                q.x, q.y,
                clamp(1.2 * q.s / 70, .6, 2.6),
                0, Math.PI * 2
            );
            ctx.fill();
        }

        ctx.globalAlpha = 1;
    }

    // GRAFICA DE TEMPERATURA
    function plot() {
        const [w, h, dpr] = csize(chart);
        chartCtx.clearRect(0, 0, w, h);

        const c = chartCtx;
        const pad = {
            l: 42 * dpr,
            r: 20 * dpr,
            t: 19 * dpr,
            b: 21 * dpr
        };

        const iw = w - pad.l - pad.r;
        const ih = h - pad.t - pad.b;
        const yval = (v) => pad.t + ih * (1 - (v + 3) / 18);

        c.lineWidth = dpr;
        c.font = `${11 * dpr}px system-ui`;

        for (const v of [-3, 0, 5, 10, 15]) {
            const y = yval(v);
            c.strokeStyle = v === 5 ? '#ef827caa' : '#45617a66';
            c.setLineDash(v === 5 ? [6 * dpr, 5 * dpr] : []);
            c.beginPath();
            c.moveTo(pad.l, y);
            c.lineTo(w - pad.r, y);
            c.stroke();
            c.setLineDash([]);
            c.fillStyle = '#94b7cc';
            c.fillText(v + '°', 9 * dpr, y + 3 * dpr);
        }

        let data = state.history.slice(-90);
        if (data.length < 2) return;

        c.beginPath();

        for (let i = 0; i < data.length; i++) {
            const x = pad.l + iw * i / Math.max(89, data.length - 1);
            const y = yval(data[i].temp);

            if (i === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
        }

        c.strokeStyle = '#7ed4ff';
        c.lineWidth = 2.5 * dpr;
        c.stroke();

        const lx = pad.l + iw * (data.length - 1) /
            Math.max(89, data.length - 1);
        const ly = yval(data[data.length - 1].temp);

        c.beginPath();
        c.arc(lx, ly, 4 * dpr, 0, Math.PI * 2);
        c.fillStyle = '#b8faff';
        c.fill();

        c.fillStyle = '#b7d3e4';
        c.fillText(
            'Límite 5 °C',
            w - 104 * dpr,
            yval(5) - 8 * dpr
        );
    }

    // REGISTRO DE EVENTOS
    function logEvent(msg, severity = 'ok') {
        state.events.unshift({
            time: new Date().toLocaleTimeString('es-MX', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }),
            msg,
            severity
        });

        state.events = state.events.slice(0, 15);

        $('events').innerHTML = state.events.map(e => `
            <div class="event">
                <time>${e.time}</time>
                <span>${e.msg}</span>
                <b class="tag ${e.severity === 'alert' ? 'alert' : ''}">
                    ${e.severity === 'alert' ? 'ALERTA' : 'INFO'}
                </b>
            </div>
        `).join('');
    }

    // DETECCION DE ALERTAS
    function reason() {
        return state.door
            ? 'puerta_abierta'
            : (state.temp < -0 || state.temp > 5)
                ? 'temperatura_fuera_de_rango'
                : 'normal';
    }

    // ALARMA SONORA
    function beep() {
        if (!state.sound) return;

        try {
            ac = ac || new (
                window.AudioContext || window.webkitAudioContext
            )();

            if (ac.state === 'suspended') ac.resume();

            const osc = ac.createOscillator();
            const gain = ac.createGain();
            const t = ac.currentTime;

            osc.frequency.value = 1000;
            osc.type = 'sine';

            gain.gain.setValueAtTime(.0001, t);
            gain.gain.exponentialRampToValueAtTime(.075, t + .01);
            gain.gain.exponentialRampToValueAtTime(.0001, t + .19);

            osc.connect(gain);
            gain.connect(ac.destination);
            osc.start(t);
            osc.stop(t + .21);
        } catch (e) {}
    }

    // ACTUALIZACION DEL PANEL
    function refresh() {
        state.reason = reason();
        state.alarm = state.reason !== 'normal';

        $('mainStatus').classList.toggle('bad', state.alarm);

        $('mainStatusText').textContent = state.alarm
            ? 'ALERTA ACTIVA'
            : 'SISTEMA NORMAL';

        $('insideT').textContent = state.temp.toFixed(1) + ' °C';

        $('insideT').classList.toggle(
            'alert',
            state.temp < 0 || state.temp > 5
        );
        $('insideT').classList.toggle(
            'green',
            !(state.temp < 0 || state.temp > 5)
        );

        $('outsideT').textContent = state.outside.toFixed(1) + ' °C';

        $('doorStatus').textContent = state.door
            ? 'ABIERTA'
            : 'CERRADA';
        $('doorStatus').className = state.door ? 'alert' : 'green';

        $('alarmStatus').textContent = state.alarm
            ? 'ALERTA'
            : 'NORMAL';
        $('alarmStatus').className = state.alarm ? 'alert' : 'green';

        $('alarmReason').textContent =
            state.reason === 'puerta_abierta'
                ? 'Puerta abierta'
                : state.reason === 'temperatura_fuera_de_rango'
                    ? 'Temperatura fuera de rango'
                    : 'Sin incidencias';

        $('tempIndicator').textContent = state.temp.toFixed(1) + ' °C';
        $('sceneLabel').textContent =
            'INTERIOR ' + state.temp.toFixed(1) + ' °C';

        $('doorButton').textContent = state.door
            ? '🚪 Cerrar puerta'
            : '🚪 Abrir puerta';

        $('coolingButton').textContent = state.failure
            ? '❄ Falla de enfriamiento: SÍ'
            : '❄ Falla de enfriamiento: NO';

        $('coolingButton').classList.toggle('danger', state.failure);

        $('riskText').textContent = state.secondsOut > 0
            ? `Lote FG-0247: ${Math.round(state.secondsOut)} s de exposición térmica fuera del rango de prueba (simulados).`
            : 'Lote demostrativo FG-0247: sin exposición térmica registrada.';

        if (state.reason !== state.previousReason) {
            if (state.alarm) {
                logEvent(
                    state.reason === 'puerta_abierta'
                        ? 'Puerta abierta: se activa alarma'
                        : 'Temperatura fuera de rango: se activa alarma',
                    'alert'
                );
            } else {
                logEvent('Alarma desactivada: parámetros normales');
            }
            state.previousReason = state.reason;
        }
    }

    // CONTROL DE TEMPERATURA
    function setTemperature(t) {
        state.temp = clamp(t, -5, 15);
        $('tempSlider').value = state.temp;
        refresh();
    }

    $('tempSlider').addEventListener('input', e => {
        setTemperature(Number(e.target.value));
    });

    // CONTROL DE PUERTA
    $('doorButton').addEventListener('click', () => {
        state.door = !state.door;
        refresh();
    });

    // ESCENARIO DE FALLA
    $('failureButton').addEventListener('click', () => {
        setTemperature(8);
        logEvent(
            'Escenario de prueba: temperatura fijada en 8 °C',
            'alert'
        );
    });

    // FALLA DE ENFRIAMIENTO
    $('coolingButton').addEventListener('click', () => {
        state.failure = !state.failure;

        logEvent(
            state.failure
                ? 'Falla simulada en sistema de enfriamiento'
                : 'Enfriamiento virtual restablecido',
            state.failure ? 'alert' : 'ok'
        );
        refresh();
    });

    // REINICIAR SIMULADOR
    $('resetButton').addEventListener('click', () => {
        state.door = false;
        state.failure = false;
        state.secondsOut = 0;
        setTemperature(4);
        logEvent('Sistema de prueba restaurado');
    });

    // RESTABLECER CAMARA 3D
    $('resetCamera').addEventListener('click', () => {
        state.yaw = .49;
        state.pitch = .21;
        state.radius = 10.3;
    });

    // ACTIVAR O DESACTIVAR SONIDO
    $('toggleSound').addEventListener('click', async () => {
        state.sound = !state.sound;

        const btn = $('toggleSound');
        btn.textContent = state.sound
            ? '♫ Sonido activado'
            : '♪ Activar sonido';

        btn.classList.toggle('on', state.sound);

        if (state.sound) {
            try {
                ac = ac || new (
                    window.AudioContext || window.webkitAudioContext
                )();
                await ac.resume();
                beep();
            } catch (e) {}
        }
    });

    // EXPORTAR DATOS A CSV
    $('exportButton').addEventListener('click', () => {
        const lines = [
            'segundo_simulado,temperatura_interior_c,temperatura_exterior_c,puerta,alarma,motivo',
            ...state.history.map(d => [
                d.s,
                d.temp.toFixed(2),
                d.outside.toFixed(2),
                d.door ? 'abierta' : 'cerrada',
                d.alarm,
                d.reason
            ].join(','))
        ];

        const a = document.createElement('a');
        a.href = URL.createObjectURL(
            new Blob([lines.join('\r\n')], {
                type: 'text/csv;charset=utf-8'
            })
        );
        a.download = 'FrioGuard_datos_simulados.csv';
        a.click();

        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    // MOVIMIENTO DE LA CAMARA CON MOUSE O TOUCH
    canvas.addEventListener('pointerdown', e => {
        drag = {
            x: e.clientX,
            y: e.clientY,
            yaw: state.yaw,
            pitch: state.pitch
        };
        canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', e => {
        if (!drag) return;

        state.yaw = drag.yaw + (e.clientX - drag.x) * .008;
        state.pitch = clamp(
            drag.pitch + (e.clientY - drag.y) * .005,
            -.35,
            .80
        );
    });

    canvas.addEventListener('pointerup', () => drag = null);
    canvas.addEventListener('pointercancel', () => drag = null);

    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        state.radius = clamp(
            state.radius + e.deltaY * .014,
            6.2,
            16.5
        );
    }, { passive: false });

    // INICIO DE LA SIMULACION
    logEvent('Simulación 3D iniciada');
    refresh();

    let seconds = 0;
    let lastSample = performance.now();

    // BUCLE PRINCIPAL
    function animation(now) {
        const dt = Math.min(.1, (now - lastFrame) / 1000);
        lastFrame = now;

        // Animacion de la puerta
        state.doorVisual +=
            (Number(state.door) - state.doorVisual) *
            Math.min(1, dt * 4.4);

        // Activacion de sonido de alarma
        if (state.alarm && state.sound && now - lastBeep > 1150) {
            lastBeep = now;
            beep();
        }

        // Actualizacion cada segundo
        if (!modoWokwi && now - lastSample >= 1000) {
            const elapsed = Math.min(
                4,
                (now - lastSample) / 1000
            );
            lastSample = now;
            seconds += elapsed;

            // Dinamica simplificada de demostracion
            if (state.failure) {
                state.temp = clamp(
                    state.temp + .12 * elapsed,
                    -3,
                    15
                );
            } else if (state.door) {
                state.temp = clamp(
                    state.temp + .028 * elapsed,
                    -3,
                    15
                );
            } else if (state.temp > 4) {
                state.temp = Math.max(
                    4,
                    state.temp - .035 * elapsed
                );
            }

            // Acumulacion de exposicion termica simulada
            if (state.temp < 0 || state.temp > 5) {
                state.secondsOut += elapsed;
            }

            state.history.push({
                s: Math.round(seconds),
                temp: state.temp,
                outside: state.outside,
                door: state.door,
                alarm: state.alarm,
                reason: state.reason
            });

            if (state.history.length > 240) {
                state.history.shift();
            }

            $('tempSlider').value = state.temp;
            refresh();
            plot();
        }

        sceneRender(now);
        requestAnimationFrame(animation);
    }

    state.history.push({
        s: 0,
        temp: 4,
        outside: 26,
        door: false,
        alarm: false,
        reason: 'normal'
    });

    requestAnimationFrame(animation);

// ==========================================
// CONEXIÓN WOKWI - MQTT
// ==========================================

let modoWokwi = false;
let clienteMQTT = null;
let ultimaLectura = 0;

const TOPICO =
  "frioguard/hackathon2026/demo-a7c39d2b/telemetria";

function bloquearControles(bloquear) {
  [
    "tempSlider",
    "doorButton",
    "failureButton",
    "coolingButton",
    "resetButton"
  ].forEach(id => {
    const elemento = $(id);
    if (elemento) elemento.disabled = bloquear;
  });
}

// BOTÓN CONECTAR WOKWI
$("conectarWokwi").addEventListener("click", () => {

  if (!window.mqtt) {
    $("estadoMQTT").textContent = "Error: falta MQTT.js";
    return;
  }

  if (clienteMQTT) clienteMQTT.end(true);

  modoWokwi = true;
  ultimaLectura = 0;
  state.started = Date.now();
  state.history = [];
  state.secondsOut = 0;

  $("estadoMQTT").textContent = "Conectando MQTT...";

  const cliente = window.mqtt.connect(
    "wss://broker.emqx.io:8084/mqtt",
    {
      clientId: "frioguard_web_" +
        Math.random().toString(16).slice(2),
      reconnectPeriod: 3000
    }
  );

  clienteMQTT = cliente;

  // CONEXIÓN CON EL SERVIDOR
  cliente.on("connect", () => {

    if (cliente !== clienteMQTT) return;

    $("estadoMQTT").textContent =
      "Conectado. Esperando datos...";

    cliente.subscribe(TOPICO);
  });

  // RECIBIR DATOS DEL ESP32
  cliente.on("message", (canal, mensaje) => {

    if (
      cliente !== clienteMQTT ||
      !modoWokwi ||
      canal !== TOPICO
    ) return;

    try {
      const datos = JSON.parse(mensaje.toString());

      if (
        datos.proyecto !== "FrioGuard 4.0" ||
        !Number.isFinite(datos.temperatura_interna) ||
        !["abierta", "cerrada"].includes(datos.puerta)
      ) return;

      // ACTUALIZAR TEMPERATURAS
      state.temp = datos.temperatura_interna;

      if (Number.isFinite(datos.temperatura_externa)) {
        state.outside = datos.temperatura_externa;
      }

      // ACTUALIZAR PUERTA
      state.door = datos.puerta === "abierta";

      // CONTAR TIEMPO FUERA DEL RANGO
      const ahora = Date.now();

      if (
        ultimaLectura &&
        (state.temp < 0 || state.temp > 5)
      ) {
        state.secondsOut += Math.min(
          (ahora - ultimaLectura) / 1000, 5
        );
      }

      ultimaLectura = ahora;

      // ACTUALIZAR PANEL Y CÁMARA 3D
      refresh();

      $("tempSlider").value = Math.max(
        -5, Math.min(15, state.temp)
      );

      // GUARDAR DATOS PARA LA GRÁFICA
      state.history.push({
        s: Math.round((ahora - state.started) / 1000),
        temp: state.temp,
        outside: state.outside,
        door: state.door,
        alarm: state.alarm,
        reason: state.reason
      });

      if (state.history.length > 240) {
        state.history.shift();
      }

      plot();

      $("estadoMQTT").textContent =
        "Recibiendo datos de Wokwi";

    } catch (error) {
      console.error("Error MQTT:", error);
    }
  });

  cliente.on("error", () => {
    if (cliente === clienteMQTT) {
      $("estadoMQTT").textContent = "Error de conexión";
    }
  });

  cliente.on("close", () => {
    if (cliente === clienteMQTT && modoWokwi) {
      $("estadoMQTT").textContent = "MQTT desconectado";
    }
  });
});

// BOTÓN PARA VOLVER AL SIMULADOR LOCAL
$("modoLocal").addEventListener("click", () => {

  modoWokwi = false;

  if (clienteMQTT) {
    clienteMQTT.end(true);
    clienteMQTT = null;
  }

  bloquearControles(false);

  state.temp = 4;
  state.outside = 26;
  state.door = false;
  state.failure = false;

  lastSample = performance.now();
  refresh();

  $("estadoMQTT").textContent = "Modo local activo";
});

// REGISTRO DE CÁMARA FRIGORÍFICA
const REG_KEY = "frioguard_registro";

let registroCamara = {
  nombre: "Cámara de demostración",
  codigo: "DEMO",
  empresa: "FríoGuard 4.0",
  ubicacion: "Simulación virtual"
};

function mostrarRegistro() {
  $("registeredCamera").textContent =
    registroCamara.nombre + " · " + registroCamara.codigo;

  $("registeredDetails").textContent =
    [registroCamara.empresa, registroCamara.ubicacion]
      .filter(Boolean).join(" · ");
}

function cerrarPortada() {
  $("welcomeScreen").classList.add("hidden");
  document.body.classList.remove("welcome-open");
  mostrarRegistro();
  window.dispatchEvent(new Event("resize"));
}

function abrirPortada() {
  $("welcomeScreen").classList.remove("hidden");
  document.body.classList.add("welcome-open");
}

// RECUPERAR REGISTRO ANTERIOR
try {
  const guardado = JSON.parse(localStorage.getItem(REG_KEY));

  if (guardado && guardado.nombre && guardado.codigo) {
    registroCamara = guardado;
    $("cameraName").value = guardado.nombre;
    $("cameraCode").value = guardado.codigo;
    $("cameraCompany").value = guardado.empresa || "";
    $("cameraLocation").value = guardado.ubicacion || "";
  }
} catch (error) {
  console.warn("No se pudo recuperar el registro", error);
}

// BOTÓN REGISTRAR
$("registerForm").addEventListener("submit", function(e) {
  e.preventDefault();

  registroCamara = {
    nombre: $("cameraName").value.trim(),
    codigo: $("cameraCode").value.trim(),
    empresa: $("cameraCompany").value.trim(),
    ubicacion: $("cameraLocation").value.trim()
  };

  try {
    localStorage.setItem(REG_KEY, JSON.stringify(registroCamara));
  } catch (error) {
    console.warn("No se pudo guardar el registro", error);
  }

  cerrarPortada();
});

// ENTRAR EN MODO DEMO
$("enterDemo").addEventListener("click", function() {
  registroCamara = {
    nombre: "Cámara de demostración",
    codigo: "DEMO",
    empresa: "FríoGuard 4.0",
    ubicacion: "Simulación virtual"
  };

  cerrarPortada();
});

// CAMBIAR REGISTRO
$("editRegistration").addEventListener("click", abrirPortada);

mostrarRegistro();

// GENERACIÓN DEL REPORTE PDF
function exportarPDF() {

  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("No se cargó la biblioteca PDF. Revisa tu conexión a Internet.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const fecha = new Date().toLocaleString("es-MX");

  const lecturas = state.history.filter(d =>
    Number.isFinite(d.temp)
  );

  const origen = modoWokwi
    ? "ESP32 virtual de Wokwi mediante MQTT"
    : "Simulación local de la página";

  const temperatura = v =>
    Number.isFinite(v) ? v.toFixed(2) + " °C" : "Sin lectura";

  let y = 20;

  function nuevaPagina(espacio = 8) {
    if (y + espacio > 280) {
      pdf.addPage();
      y = 20;
    }
  }

  function linea(etiqueta, valor) {
    const texto = etiqueta + ": " + String(valor);
    const partes = pdf.splitTextToSize(texto, 178);
    nuevaPagina(partes.length * 6);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(40, 60, 80);
    pdf.text(partes, 16, y);
    y += partes.length * 6 + 2;
  }

  function titulo(texto) {
    nuevaPagina(17);
    y += 5;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(17, 105, 145);
    pdf.text(texto, 16, y);
    y += 9;
  }

  // ENCABEZADO
  pdf.setFillColor(9, 32, 53);
  pdf.rect(0, 0, 210, 13, "F");

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(11);
  pdf.setFont("helvetica", "bold");
  pdf.text("FRIOGUARD 4.0 - REPORTE DE MONITOREO", 15, 9);

  // INFORMACIÓN DE LA CÁMARA
  titulo("Información de la cámara");

  linea("Nombre", registroCamara.nombre);
  linea("Identificador", registroCamara.codigo);
  linea("Empresa", registroCamara.empresa || "No especificada");
  linea("Ubicación", registroCamara.ubicacion || "No especificada");
  linea("Fecha del reporte", fecha);

  // ESTADO ACTUAL
  titulo("Estado actual del sistema");

  linea("Origen de datos", origen);
  linea("Temperatura interior", temperatura(state.temp));
  linea("Temperatura exterior", temperatura(state.outside));
  linea("Puerta", state.door ? "ABIERTA" : "CERRADA");
  linea("Estado", state.alarm ? "ALERTA" : "NORMAL");
  linea("Tiempo fuera de rango", Math.round(state.secondsOut) + " segundos estimados");
  linea("Lecturas registradas", lecturas.length);

  // ESTADÍSTICAS
  if (lecturas.length > 0) {
    const valores = lecturas.map(d => d.temp);
    const minimo = Math.min(...valores);
    const maximo = Math.max(...valores);
    const promedio = valores.reduce((a, b) => a + b, 0) / valores.length;

    titulo("Resumen de temperaturas");

    linea("Temperatura mínima", temperatura(minimo));
    linea("Temperatura máxima", temperatura(maximo));
    linea("Temperatura promedio", temperatura(promedio));
  }

  // GRÁFICA DE TEMPERATURA
  if (lecturas.length > 1) {
    titulo("Gráfica de temperatura");
    nuevaPagina(52);

    try {
      const imagen = $("chart").toDataURL("image/png");
      pdf.addImage(imagen, "PNG", 16, y, 178, 45);
      y += 53;
    } catch (error) {
      linea("Gráfica", "No disponible");
    }
  }

  // HISTORIAL DE LECTURAS
  titulo("Historial de lecturas");

  if (!lecturas.length) {
    linea("Historial", "Aún no existen lecturas");
  }

  lecturas.forEach(d => {
    nuevaPagina(9);

    const hora = new Date(
      state.started + d.s * 1000
    ).toLocaleTimeString("es-MX");

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(40, 60, 80);

    const texto =
      hora +
      "  |  Int: " + temperatura(d.temp) +
      "  |  Ext: " + temperatura(d.outside) +
      "  |  " + (d.door ? "Abierta" : "Cerrada");

    pdf.text(texto, 16, y);
    y += 7;
  });

  // BITÁCORA
  titulo("Registro de eventos");

  if (!state.events.length) {
    linea("Eventos", "Sin eventos registrados");
  }

  state.events.forEach(e => {
    linea(e.time, e.msg);
  });

  // NOTA FINAL
  titulo("Observaciones");

  linea(
    "Aviso",
    "Reporte académico con datos simulados en Wokwi o en la página web. No certifica la conservación ni la inocuidad de los productos."
  );

  // NUMERACIÓN
  const totalPaginas = pdf.getNumberOfPages();

  for (let i = 1; i <= totalPaginas; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8);
    pdf.setTextColor(110, 130, 145);
    pdf.text(
      "FrioGuard 4.0 - Página " + i + " de " + totalPaginas,
      16, 290
    );
  }

  // DESCARGAR PDF
  pdf.save("FrioGuard_Reporte_" +
    new Date().toISOString().slice(0, 10) + ".pdf");
}

// ACTIVAR BOTÓN
$("exportPDF").addEventListener("click", exportarPDF);


})();
