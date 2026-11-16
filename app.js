/* =====================================================================
   지금공원 — app.js  (v3 · 지도·그래픽 중심 개편)
   · 데이터는 api-config.js 의 RadarAPI / data-bundle.js 만 읽는다.
   · 화면은 4개 탭(지금·지도·도감·안내)이고, 상세는 바텀시트로 내린다.
   · 상단 공원 칩에서 공원을 고른다 — 지금은 올림픽공원 데이터로 열려 있다.
   · 지도는 Leaflet(로컬 vendor) + OSM 타일. 타일이 막히면 자체 SVG 공원 지도로 그린다.
   ===================================================================== */
(function () {
  'use strict';

  var D = window.RADAR_DATA || {};
  var GEO = D.geo || {};
  var CFG = window.RADAR_CONFIG || {};

  /* 시연 기준 시각은 고정한다(실데이터 전환 시 RadarAPI.isLive() 가 true) */
  var SAMPLE_NOW = new Date('2026-11-16T19:40:00+09:00');
  var NOW = (window.RadarAPI && window.RadarAPI.isLive && window.RadarAPI.isLive())
    ? new Date() : SAMPLE_NOW;
  var TODAY = isoOf(NOW);
  var WD = ['일', '월', '화', '수', '목', '금', '토'];

  /* 시연 모드 3종 — 히어로 그래픽·지도 혼잡도·추천 코스가 함께 바뀐다 */
  var MODES = {
    clear: { wx: 'clear', park: 'now', note: '맑은 날 가정' },
    busy: { wx: 'today', park: 'sat', note: '토요일 14시 기준' },
    rain: { wx: 'rain', park: 'now', note: '비 오는 날 가정' }
  };

  var state = {
    mode: 'clear',
    parkId: 'olympic',
    view: 'radar',
    course: null,
    gate: null,
    mapCard: 'course',
    guide: 'event'
  };

  /* 공원 목록 — 화면과 계산식은 그대로 두고 데이터만 공원별로 갈아 끼우는 구조.
     지금은 올림픽공원만 공공데이터 8종과 연결되어 실데이터로 열려 있다. */
  var PARKS = [
    { id: 'olympic', name: '올림픽공원', meta: '한국체육산업개발 공공데이터 8종 연동', live: true },
    { id: 'misa', name: '미사경정공원', meta: '같은 기관 데이터로 연동 준비 중', live: false },
    { id: 'sports', name: '분당·일산 올림픽스포츠센터', meta: '시설·이용 데이터 표준 스키마 연계 예정', live: false }
  ];
  function parkById(id) {
    for (var i = 0; i < PARKS.length; i++) if (PARKS[i].id === id) return PARKS[i];
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 도구                                                              */
  /* ------------------------------------------------------------------ */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isoOf(d) {
    var k = new Date(d.getTime() + 9 * 3600 * 1000);
    return k.toISOString().slice(0, 10);
  }
  function dateOf(iso) {
    var p = String(iso).split('-');
    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12));
  }
  function addDays(iso, n) {
    var d = dateOf(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function normDate(s) {
    var t = String(s || '').trim();
    if (/^\d{8}$/.test(t)) return t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8);
    return t;
  }
  function mdOf(iso) { var p = normDate(iso).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function wdOf(iso) { return WD[dateOf(iso).getUTCDay()]; }
  function mdNum(iso) { var p = iso.split('-'); return Number(p[1]) * 100 + Number(p[2]); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function gapDays(a, b) { return Math.round((dateOf(a) - dateOf(b)) / 86400000); }
  function num(n) { return Number(n || 0).toLocaleString('ko-KR'); }

  var ICON = {
    chev: '<path d="m9 6 6 6-6 6"/>',
    route: '<path d="M6.5 19.5c4.5 0 3.6-7 8-7s3.4 5.5 3.4 5.5"/><circle cx="6.5" cy="19.5" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
    pin: '<path d="M12 21s6.5-6.1 6.5-11a6.5 6.5 0 1 0-13 0C5.5 14.9 12 21 12 21Z"/><circle cx="12" cy="10" r="2.2"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.6V12l3 2"/>',
    walk: '<circle cx="13" cy="5" r="1.8"/><path d="M11 21l1.6-5-2.4-2.6.9-4.4 3.4 2.2 2.6.6"/><path d="M9.4 12.4 7.6 16l2 5"/>',
    nav: '<path d="m12 3.4 7 16.4-7-4.1-7 4.1 7-16.4Z"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2V16M12 8.1h.01"/>',
    search: '<circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4 4"/>',
    leaf: '<path d="M19 5c0 8-5.5 14-14 14 0-8 6-14 14-14Z"/><path d="M5 19c2.5-5 6-8.5 10.5-10.5"/>',
    rain: '<path d="M7.5 15.5h9a3.6 3.6 0 0 0 .4-7.2 5.2 5.2 0 0 0-9.9-1.3 4 4 0 0 0 .5 8.5Z"/><path d="M8.5 18.4l-.8 2M12 18.4l-.8 2M15.5 18.4l-.8 2"/>',
    check: '<path d="m5 12.6 4.6 4.6L19 7.4"/>'
  };
  function ico(d, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }

  /* ------------------------------------------------------------------ */
  /* 날씨 → 산책 지수 (기획서 3-2 규칙 그대로)                          */
  /* ------------------------------------------------------------------ */
  var SKY_LABEL = { 1: '맑음', 3: '구름 많음', 4: '흐림' };
  var PTY_LABEL = { 0: '강수 없음', 1: '비', 2: '비/눈', 3: '눈', 4: '소나기' };

  function weatherState(kind) {
    var w = D.weather;
    if (!w) return null;
    if (!kind || kind === 'today' || !w.scenarios || !w.scenarios[kind]) {
      return {
        kind: 'today', label: '오늘 예보',
        now: Object.assign({}, w.now),
        forecast: (w.forecast || []).map(function (f) {
          var c = Object.assign({}, f);
          c.fcstDate = normDate(c.fcstDate);
          return c;
        }),
        simulated: false
      };
    }
    var sc = w.scenarios[kind];
    var fc = (sc.hours || []).map(function (h, i) {
      var t = new Date(NOW.getTime() + (i + 1) * 3600 * 1000);
      var kst = new Date(t.getTime() + 9 * 3600 * 1000);
      return {
        fcstDate: kst.toISOString().slice(0, 10),
        fcstTime: String(kst.getUTCHours()).padStart(2, '0') + '00',
        TMP: h.TMP, POP: h.POP, PTY: h.PTY, SKY: h.SKY, WSD: h.WSD
      };
    });
    return {
      kind: kind, label: sc.label + ' 시뮬레이션',
      now: Object.assign({}, sc.now), forecast: fc, simulated: true
    };
  }

  function computeScore(now, forecast) {
    var s = 100;
    var rows = [];
    function cut(label, cond, ded) { s += ded; rows.push({ label: label, cond: cond, ded: ded }); }
    var t = Number(now.T1H);
    if (t >= 33) cut('기온', t + '℃ (33℃ 이상)', -15);
    else if (t >= 30) cut('기온', t + '℃ (30~33℃)', -8);
    else if (t <= -5) cut('기온', t + '℃ (-5℃ 이하)', -15);
    else if (t <= 5) cut('기온', t + '℃ (0~5℃)', -5);
    var pty = Number(now.PTY);
    var mm = parseFloat(now.RN1) || 0;
    if (pty === 1) {
      cut('강수', '비', -20);
      if (mm >= 3) cut('강수량', mm + 'mm (시간당 3mm 이상)', -5);
    } else if (pty === 3) cut('강수', '눈', -25);
    else if (pty === 4) cut('강수', '소나기', -15);
    else if (pty === 2) cut('강수', '비/눈', -25);
    if (Number(now.SKY) === 4) cut('하늘', '흐림', -3);
    else if (Number(now.SKY) === 3) cut('하늘', '구름 많음', -1);
    var ws = Number(now.WSD);
    if (ws >= 8) cut('바람', ws.toFixed(1) + 'm/s (8m/s 이상)', -10);
    else if (ws >= 4) cut('바람', ws.toFixed(1) + 'm/s (4~8m/s)', -5);
    var pop3 = maxPop(forecast, 3);
    if (pop3 >= 60) cut('예보', '3시간 내 강수확률 ' + pop3 + '%', -10);
    var score = clamp(Math.round(s / 5) * 5, 0, 100);
    return { score: score, rows: rows, pop3: pop3 };
  }

  function maxPop(forecast, hours) {
    var m = 0, h = 0;
    (forecast || []).forEach(function (f) {
      if (h >= hours) return;
      h += 1;
      m = Math.max(m, Number(f.POP) || 0);
    });
    return m;
  }

  function bandOf(score) {
    if (score >= 75) return { key: 'good', short: '좋음', judge: '지금 출발하기 좋습니다' };
    if (score >= 50) return { key: 'ok', short: '무난', judge: '걷기 무난합니다' };
    return { key: 'low', short: '비추', judge: '오늘보다 다른 날을 권합니다' };
  }

  function weatherLine(now) {
    var bits = [Number(now.PTY) > 0 ? PTY_LABEL[Number(now.PTY)] : SKY_LABEL[Number(now.SKY)] || '',
      Number(now.T1H) + '℃', '바람 ' + Number(now.WSD).toFixed(1) + 'm/s'];
    if (Number(now.PTY) > 0) bits.splice(1, 0, '시간당 ' + (parseFloat(now.RN1) || 0) + 'mm');
    return bits.filter(Boolean).join(' · ');
  }

  /* ------------------------------------------------------------------ */
  /* 주차 (CSV 이력 기반 규칙 그대로)                                    */
  /* ------------------------------------------------------------------ */
  var PARK_PRESETS = {
    now: { label: '지금', dayType: 'weekday', hour: 19, src: 'sample', note: '실시간 주차현황 5분 간격 7회의 30분 이동평균' },
    sat: { label: '토 14:00', dayType: 'weekend', hour: 14, src: 'profile', note: '토요일 14시 이력 혼잡도로 계산한 시연값' }
  };
  var SAT_DEV = { '동2문': 0.34, '남2문': 0.1, '북2문': -0.2 };

  function parseRange(raw) {
    var m = String(raw).match(/(\d{2})-(\d{2})\s*~\s*(익년)?\s*(\d{2})-(\d{2})/);
    if (!m) return null;
    return { a: Number(m[1]) * 100 + Number(m[2]), b: Number(m[4]) * 100 + Number(m[5]), wrap: !!m[3] };
  }
  function inRange(r, md) { return r.wrap ? (md >= r.a || md <= r.b) : (md >= r.a && md <= r.b); }
  function lawnState(row, iso) {
    var md = mdNum(iso);
    var raw = row.rawContent || '';
    if (/상시/.test(raw)) return { status: 'open', label: '연중 상시개방', raw: raw };
    var r = parseRange(raw);
    if (!r) return { status: 'unknown', label: raw, raw: raw };
    var deny = /통제|금지/.test((row.rawOpenTime || '') + (row.place || ''));
    var inside = inRange(r, md);
    if (deny) return { status: inside ? 'closed' : 'open', label: inside ? '출입금지 기간' : '통제 기간 아님', raw: raw };
    return { status: inside ? 'open' : 'closed', label: inside ? '개방 기간' : '개방 기간 아님', raw: raw };
  }
  function lawnStateByPlace(place) {
    var rows = (D.lawn && D.lawn.rows) || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].place === place) return lawnState(rows[i], TODAY);
    return null;
  }

  function historyAt(dayType, hour, band) {
    var recs = (D.parkingHistory && D.parkingHistory.records) || [];
    var score = { '원활': 0, '혼잡': 1, '만차': 2 };
    var acc = {};
    band = band || 1;
    recs.forEach(function (r) {
      var wd = dateOf(r.date).getUTCDay();
      var dt = (wd === 0 || wd === 6) ? 'weekend' : 'weekday';
      if (dt !== dayType) return;
      if (Math.abs(Number(r.time.slice(0, 2)) - hour) > band) return;
      var a = acc[r.zone] || (acc[r.zone] = { sum: 0, n: 0 });
      a.sum += score[r.congestion] != null ? score[r.congestion] : 1;
      a.n += 1;
    });
    var out = {};
    Object.keys(acc).forEach(function (z) { out[z] = { mean: acc[z].sum / acc[z].n, n: acc[z].n }; });
    return out;
  }

  function snapshotMean(snapshots, field) {
    var out = {};
    (snapshots || []).forEach(function (s) {
      (s.items || []).forEach(function (it) {
        var z = it.parking_id;
        var v = Number(it[field] != null ? it[field] : it.parking_sum) || 0;
        var a = out[z] || (out[z] = { sum: 0, n: 0 });
        a.sum += v; a.n += 1;
      });
    });
    var res = {};
    Object.keys(out).forEach(function (z) { res[z] = out[z].sum / out[z].n; });
    return res;
  }

  function computeParking(presetKey) {
    var preset = PARK_PRESETS[presetKey] || PARK_PRESETS.now;
    var gates = (D.gates && D.gates.gates) || [];
    var caps = (D.gates && D.gates.capacity) || {};
    var hist = historyAt(preset.dayType, preset.hour, 1);
    var band = 1;
    var need = gates.some(function (g) {
      return g.zones.reduce(function (n, z) { return n + (hist[z] ? hist[z].n : 0); }, 0) < 3;
    });
    if (need) { hist = historyAt(preset.dayType, preset.hour, 3); band = 3; }
    var rt = D.realtime || {};
    var meanNow = snapshotMean(rt._snapshots, 'parking_sum');

    var rows = gates.map(function (g) {
      var cars = 0, base = 0, n = 0;
      var zones = g.zones.map(function (z) {
        var cap = caps[z] ? caps[z].value : null;
        var h = hist[z];
        var occ = h ? 0.35 + (h.mean / 2) * 0.6 : (cap ? 0.55 : null);
        var b = cap && occ != null ? cap * occ : null;
        var nowCars;
        if (preset.src === 'sample') nowCars = meanNow[z] != null ? meanNow[z] : null;
        else nowCars = b != null ? b * (1 + (SAT_DEV[g.name] || 0)) : null;
        if (nowCars != null) cars += nowCars;
        if (b != null) base += b;
        if (h) n += h.n;
        return { zone: z, cap: cap, capSrc: caps[z] ? caps[z].source : '-', hist: h, base: b, now: nowCars };
      });
      var diff = base > 0 && cars > 0 ? ((cars - base) / base) * 100 : null;
      var grade = 'na';
      if (diff != null && n > 0) grade = diff <= -15 ? 'free' : diff >= 15 ? 'busy' : 'mid';
      return { id: gateIdByName(g.name) || g.id, name: g.name, near: g.near, zoneRows: zones,
        cars: cars, base: base, n: n, diff: diff, grade: grade };
    });
    var order = { free: 0, mid: 1, busy: 2, na: 3 };
    rows.sort(function (a, b) {
      if (order[a.grade] !== order[b.grade]) return order[a.grade] - order[b.grade];
      if (a.grade === 'na') return a.cars - b.cars;
      return (a.diff == null ? 0 : a.diff) - (b.diff == null ? 0 : b.diff);
    });
    return { preset: preset, presetKey: presetKey, band: band, rows: rows };
  }

  var GRADE_LABEL = { free: '여유', mid: '보통', busy: '붐빔', na: '자료 없음' };

  /* ------------------------------------------------------------------ */
  /* 코스 · 추천                                                        */
  /* ------------------------------------------------------------------ */
  function courses() { return (GEO.courses || []); }
  function courseById(id) {
    var list = courses();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  function rankCourses(wx) {
    var now = wx.now;
    var pty = Number(now.PTY);
    var ws = Number(now.WSD);
    var t = Number(now.T1H);
    var m = Number(TODAY.slice(5, 7));
    return courses().map(function (c) {
      var tr = c.traits || {};
      var s = 0, why = [];
      if (tr.indoor) {
        if (pty > 0) { s += 6; why.push('비를 피해 박물관·미술관으로 잇는 코스입니다'); }
        else { s -= 3; why.push('맑은 날에는 실내 코스를 권하지 않습니다'); }
      } else if (pty > 0) {
        if (tr.shade >= 0.8) { s += 3; why.push('수목이 길을 덮어 비를 막아 줍니다'); }
        else { s -= 1; }
        if (tr.pave >= 0.8) s += 1;
      } else {
        if (tr.shade >= 0.6) { s += 1; why.push('그늘 구간이 많습니다'); }
        if (tr.pave >= 0.8) s += 1;
        if (tr.bloom) {
          if (m >= 5 && m <= 10) { s += 1; why.push('장미 개화기(5~10월)입니다'); }
          else { s -= 1; why.push('장미 개화기(5~10월)가 아닙니다'); }
        }
      }
      if (ws >= 8) { if (tr.shade >= 0.8) { s += 2; why.push('숲이 바람을 막아 줍니다'); } else s -= 1; }
      if (t >= 30 && tr.shade >= 0.6) { s += 2; why.push('그늘 구간이 많습니다'); }
      if (t <= 2 && tr.shade >= 0.8) { s -= 1; }
      (c.lawnPlaces || []).forEach(function (p) {
        var st = lawnStateByPlace(p);
        if (st && st.status === 'closed') { s -= 1; why.push('오늘은 ' + p + '이 잔디 통제 기간입니다'); }
      });
      return { c: c, s: s, why: why };
    }).sort(function (a, b) {
      if (b.s !== a.s) return b.s - a.s;
      return courses().indexOf(a.c) - courses().indexOf(b.c);
    });
  }

  function courseWhy(r) {
    return r.why[0] || (r.c.traits && r.c.traits.indoor
      ? '실내 위주로 걷는 코스입니다'
      : '오늘 조건에서 무난한 코스입니다');
  }

  function naverSearch(name) {
    return 'https://map.naver.com/p/search/' + encodeURIComponent('올림픽공원 ' + name);
  }
  function naverWalk(from, to) {
    var a = from.lon + ',' + from.lat + ',' + encodeURIComponent(from.name);
    var b = to.lon + ',' + to.lat + ',' + encodeURIComponent(to.name);
    return 'https://map.naver.com/p/directions/' + a + '/' + b + '/-/walk';
  }
  function courseNaver(c) {
    var wp = c.waypoints || [];
    if (wp.length < 2) return naverSearch(c.name);
    return naverWalk({ lon: wp[0].lon, lat: wp[0].lat, name: wp[0].name },
      { lon: wp[wp.length - 1].lon, lat: wp[wp.length - 1].lat, name: wp[wp.length - 1].name });
  }
  function gateInfo(id) {
    var list = GEO.gates || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function gateIdByName(name) {
    var list = GEO.gates || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i].id;
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 탭 1 · 레이더                                                      */
  /* ------------------------------------------------------------------ */
  var lastScore = null;

  var MODE_TAG = { clear: '맑음 기준', busy: '주말 기준', rain: '비 기준' };

  function renderRadar() {
    var mode = MODES[state.mode];
    var wx = weatherState(mode.wx);
    if (!wx) return;
    var got = computeScore(wx.now, wx.forecast);
    var band = bandOf(got.score);
    var park = computeParking(mode.park);
    var ranked = rankCourses(wx);
    var top = ranked[0];
    /* 추천 입구 = 그 코스의 출발 문. 그 문이 붐비면 가장 여유로운 문으로 바꾼다 */
    var bestGate = park.rows[0];
    (park.rows || []).forEach(function (r) {
      if (r.id === top.c.gate && r.grade !== 'busy') bestGate = r;
    });

    /* 히어로 */
    $('#hero').setAttribute('data-mode', state.mode);
    var eyebrow;
    if (state.mode === 'busy') {
      var sat = addDays(TODAY, 6 - dateOf(TODAY).getUTCDay());
      eyebrow = mdOf(sat) + ' ' + wdOf(sat) + '요일 14:00 기준 · 시연';
    } else {
      eyebrow = mdOf(TODAY) + ' ' + wdOf(TODAY) + '요일 · '
        + String(NOW.getHours()).padStart(2, '0') + ':' + String(NOW.getMinutes()).padStart(2, '0')
        + ' · ' + mode.note;
    }
    $('#hero-eyebrow').textContent = eyebrow;
    if (state.mode === 'rain') {
      $('#hero-title').textContent = '실내 문화코스로 바꿨어요';
      $('#hero-sub').textContent = '11℃ · 비 · 실내 2곳 1.5km';
      $('#hero-eyebrow').textContent = mdOf(TODAY) + ' ' + wdOf(TODAY) + '요일 · 19:40 · 실내 전환';
    } else {
      $('#hero-title').textContent = band.judge;
      $('#hero-sub').textContent = weatherLine(wx.now) + (state.mode === 'busy' ? ' · 주말 14시 주차 기준' : '');
    }

    setGauge(got.score, band.key);

    /* 추천 카드 */
    var gateName = bestGate ? bestGate.name : '-';
    var gateMeta = bestGate
      ? GRADE_LABEL[bestGate.grade] + ' · ' + num(Math.round(bestGate.cars)) + '대'
      : '자료 없음';
    /* 코스 출발 문을 골랐는데 다른 문이 더 여유로우면 그 사실을 같이 적는다 */
    var freeGate = park.rows[0];
    if (bestGate && freeGate && freeGate.id !== bestGate.id && freeGate.grade === 'free' && bestGate.grade !== 'free') {
      gateMeta += ' · 주차는 ' + freeGate.name + '이 더 여유';
    }
    var html = '';
    html += '<div class="pick__head"><span class="pick__label">오늘의 추천</span>'
      + '<span class="pick__mode">' + esc(MODE_TAG[state.mode] || '') + '</span></div>';
    html += '<button class="pickrow" type="button" data-pick="gate">'
      + '<span class="pickrow__ico">' + ico(ICON.pin) + '</span>'
      + '<span class="pickrow__body"><span class="pickrow__k">추천 입구</span>'
      + '<b class="pickrow__v">' + esc(gateName) + '</b>'
      + '<span class="pickrow__m">' + esc(gateMeta) + '</span></span>'
      + ico(ICON.chev, 'pickrow__chev') + '</button>';
    html += '<button class="pickrow" type="button" data-pick="course">'
      + '<span class="pickrow__ico">' + ico(ICON.route) + '</span>'
      + '<span class="pickrow__body"><span class="pickrow__k">추천 코스</span>'
      + '<b class="pickrow__v">' + esc(top.c.name) + '</b>'
      + '<span class="pickrow__m">' + esc(top.c.km + 'km · 약 ' + top.c.mins + '분 · 출발 '
        + ((gateInfo(top.c.gate) || {}).name || '') + ' · ' + courseWhy(top)) + '</span></span>'
      + ico(ICON.chev, 'pickrow__chev') + '</button>';
    $('#pick').innerHTML = html;

    state.suggest = { gate: bestGate ? bestGate.id : null, course: top.c.id };
    state.park = park;
    state.wxNow = wx.now;
    state.score = got;

    $$('#pick .pickrow').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-pick');
        if (kind === 'gate') {
          state.gate = state.suggest.gate;
          go('map');
          focusGate(state.gate);
        } else {
          state.course = state.suggest.course;
          state.gate = courseById(state.course).gate;
          go('map');
          selectCourse(state.course, true);
        }
      });
    });
  }

  function setGauge(score, tone) {
    var bar = $('#gauge-bar');
    var box = $('#gauge');
    box.setAttribute('data-tone', tone);
    bar.style.strokeDashoffset = String(264 * (1 - score / 100));
    var el = $('#gauge-score');
    var from = lastScore == null ? 0 : lastScore;
    lastScore = score;
    var t0 = performance.now();
    function tick(t) {
      var k = Math.min(1, (t - t0) / 900);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(from + (score - from) * e));
      if (k < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------------ */
  /* 탭 2 · 지도                                                        */
  /* ------------------------------------------------------------------ */
  var map = null, mapLayers = { courses: {} }, mapReady = false, mapMode = 'leaflet';
  var BASE_VIEW = { center: (GEO.meta && GEO.meta.center) || [37.5207, 127.1215], zoom: 15 };
  var OFFLINE = false;

  var COURSE_TONE = { mongchon: '#1E5B43', rose: '#B85C78', indoor: '#3C6E8F' };

  function ensureMap() {
    if (mapReady) return;
    mapReady = true;
    var wrap = $('#mapwrap');
    if (!window.L) { mapMode = 'svg'; buildSvgMap(); return; }
    try {
      map = window.L.map('map', {
        center: BASE_VIEW.center, zoom: BASE_VIEW.zoom,
        zoomControl: false, attributionControl: false,
        scrollWheelZoom: false, zoomSnap: 0.25, maxZoom: 18, minZoom: 13
      });
      addTiles();
      drawGeo();
      refreshPins();
    } catch (err) {
      mapMode = 'svg';
      buildSvgMap();
    }
  }

  function addTiles() {
    if (!map) return;
    window.L.control.attribution({ prefix: false, position: 'bottomright' })
      .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>')
      .addTo(map);
    var ok = 0;
    var osm = window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '', crossOrigin: true
    });
    osm.on('tileload', function () { ok += 1; });
    osm.on('tileerror', function () { if (ok === 0) markOffline(); });
    osm.addTo(map);
    setTimeout(function () { if (ok === 0) markOffline(); }, 4500);
  }

  function markOffline() {
    if (OFFLINE) return;
    OFFLINE = true;
    var wrap = $('#mapwrap');
    wrap.classList.add('map--offline');
    $('#map-badge').hidden = false;
    if (map) {
      map.eachLayer(function (l) { if (l instanceof window.L.TileLayer) map.removeLayer(l); });
      map.getContainer().style.background = '#EDF1E6';
    }
  }

  function drawGeo() {
    if (!map) return;
    var L = window.L;
    var park = (GEO.park || []).map(function (p) { return [p[0], p[1]]; });
    L.polygon(park, {
      color: '#4C7A52', weight: 1.6, opacity: .75,
      fillColor: '#9CC194', fillOpacity: .42, interactive: false
    }).addTo(map);
    (GEO.water || []).forEach(function (w) {
      L.polygon(w.map(function (p) { return [p[0], p[1]]; }), {
        color: '#7FA9C0', weight: 1, opacity: .8,
        fillColor: '#BFD9E6', fillOpacity: .8, interactive: false
      }).addTo(map);
    });
    (GEO.paths || []).forEach(function (line) {
      L.polyline(line.map(function (p) { return [p[0], p[1]]; }), {
        color: '#7E8F79', weight: 1, opacity: .35, interactive: false
      }).addTo(map);
    });
    courses().forEach(function (c) {
      var pts = (c.points || []).map(function (p) { return [p[0], p[1]]; });
      var halo = L.polyline(pts, {
        color: '#FFFFFF', weight: 9, opacity: .8, lineCap: 'round', interactive: false, smoothFactor: 1.6
      });
      var line = L.polyline(pts, {
        color: COURSE_TONE[c.id] || '#1E5B43', weight: 4.5, opacity: .96,
        lineCap: 'round', lineJoin: 'round', smoothFactor: 1.6
      });
      line.on('click', function () { selectCourse(c.id, false); });
      mapLayers.courses[c.id] = { halo: halo, line: line, pts: pts };
    });

    /* 출발 지점 표시 */
    map.fitBounds(L.latLngBounds(park).pad(0.06), { animate: false });
  }

  function pinHtml(g, row) {
    var grade = row ? row.grade : 'na';
    var cls = grade === 'free' ? 'free' : grade === 'busy' ? 'busy' : grade === 'mid' ? 'mid' : 'na';
    return '<span class="pin pin--' + cls + '">'
      + '<i class="pin__pulse"></i><i class="pin__pulse pin__pulse--2"></i>'
      + '<b class="pin__dot"></b><em class="pin__name">' + esc(g.name) + '</em></span>';
  }

  function refreshPins() {
    if (!map) return;
    var L = window.L;
    if (mapLayers.pins) {
      mapLayers.pins.forEach(function (m) { map.removeLayer(m); });
    }
    mapLayers.pins = [];
    var rows = (state.park && state.park.rows) || [];
    var byName = {};
    rows.forEach(function (r) { byName[r.name] = r; });
    (GEO.gates || []).forEach(function (g) {
      var row = g.congestion ? byName[g.name] : null;
      var icon = L.divIcon({
        className: 'pinwrap', html: pinHtml(g, row), iconSize: [14, 14], iconAnchor: [7, 7]
      });
      var mk = L.marker([g.lat, g.lon], { icon: icon, keyboard: false, title: g.name }).addTo(map);
      mk.on('click', function () { openGateSheet(g.id); });
      mapLayers.pins.push(mk);
    });
  }

  function selectCourse(id, fitView) {
    state.course = id;
    state.mapCard = 'course';
    var c = courseById(id);
    if (!c) return;
    if (mapMode === 'svg') { markSvgCourse(id); }
    else if (map) {
      Object.keys(mapLayers.courses).forEach(function (k) {
        var l = mapLayers.courses[k];
        if (k === id) { l.halo.addTo(map); l.line.addTo(map); l.line.bringToFront(); }
        else { map.removeLayer(l.halo); map.removeLayer(l.line); }
      });
      if (fitView && mapLayers.courses[id]) {
        map.fitBounds(window.L.latLngBounds(mapLayers.courses[id].pts).pad(0.28), { animate: true });
      }
    }
    $$('#course-chips .chip').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-course') === id);
    });
    renderMapCard();
  }

  function focusGate(id) {
    state.gate = id;
    state.mapCard = 'gate';
    var g = gateInfo(id);
    if (!g) return;
    if (mapMode !== 'svg' && map) map.setView([g.lat, g.lon], 16.4, { animate: true });
    renderMapCard();
  }

  function renderChips() {
    var html = '';
    courses().forEach(function (c) {
      html += '<button class="chip' + (c.id === state.course ? ' is-on' : '')
        + (c.traits && c.traits.indoor ? ' chip--indoor' : '')
        + '" type="button" data-course="' + c.id + '">'
        + '<i class="chip__dot" style="--tone:' + (COURSE_TONE[c.id] || '#1E5B43') + '"></i>'
        + esc(c.short) + ' ' + c.km + 'km</button>';
    });
    $('#course-chips').innerHTML = html;
    $$('#course-chips .chip').forEach(function (b) {
      b.addEventListener('click', function () { selectCourse(b.getAttribute('data-course'), true); });
    });
  }

  function renderMapCard() {
    var box = $('#mapcard');
    if (!box) return;
    if (state.mapCard === 'gate' && state.gate) { renderGateCard(box); return; }
    var c = state.course ? courseById(state.course) : null;
    if (!c) { box.innerHTML = ''; return; }
    var route = (c.waypoints || []).map(function (w) { return esc(w.name); }).join(' <i>›</i> ');
    box.innerHTML =
      '<div class="mapcard__top"><span class="mapcard__tag">' + esc(c.km + 'km · 약 ' + c.mins + '분') + '</span>'
      + (c.traits && c.traits.indoor ? '<span class="mapcard__tag mapcard__tag--tone">실내</span>' : '')
      + '</div>'
      + '<h2 class="mapcard__title">' + esc(c.name) + '</h2>'
      + '<p class="mapcard__route">' + route + '</p>'
      + '<div class="mapcard__actions">'
      + '<a class="btn btn--ghost" href="' + esc(courseNaver(c)) + '" target="_blank" rel="noopener">네이버 지도</a>'
      + '<button class="btn btn--primary" type="button" data-open-course="' + c.id + '">'
      + '코스 자세히</button></div>';
    var btn = $('[data-open-course]', box);
    if (btn) btn.addEventListener('click', function () { openCourseSheet(c.id); });
  }

  function renderGateCard(box) {
    var g = gateInfo(state.gate);
    if (!g) { box.innerHTML = ''; return; }
    var row = null;
    ((state.park && state.park.rows) || []).forEach(function (r) { if (r.name === g.name) row = r; });
    var html = '<div class="mapcard__top">';
    if (g.congestion && row) {
      html += '<span class="pill pill--' + row.grade + '">' + GRADE_LABEL[row.grade] + '</span>'
        + '<span class="mapcard__tag">' + num(Math.round(row.cars)) + '대</span>';
    } else {
      html += '<span class="pill pill--na">자료 없음</span>';
    }
    html += '</div><h2 class="mapcard__title">' + esc(g.name) + '</h2>'
      + '<p class="mapcard__route">' + esc((g.near || []).slice(0, 3).join(' · ')) + ' 쪽 입구</p>'
      + '<div class="mapcard__actions">'
      + '<a class="btn btn--ghost" href="' + esc(naverSearch(g.name)) + '" target="_blank" rel="noopener">네이버 지도</a>'
      + '<button class="btn btn--primary" type="button" id="mapcard-gate-detail">입구 자세히</button></div>';
    box.innerHTML = html;
    var btn = $('#mapcard-gate-detail');
    if (btn) btn.addEventListener('click', function () { openGateSheet(g.id); });
  }

  /* ── Leaflet 이 없을 때: 자체 SVG 공원 지도 ───────────────────── */
  function svgProject() {
    var pts = [];
    (GEO.park || []).forEach(function (p) { pts.push(p); });
    (GEO.gates || []).forEach(function (g) { pts.push([g.lat, g.lon]); });
    var lats = pts.map(function (p) { return p[0]; });
    var lons = pts.map(function (p) { return p[1]; });
    var padLat = (Math.max.apply(null, lats) - Math.min.apply(null, lats)) * 0.08;
    var padLon = (Math.max.apply(null, lons) - Math.min.apply(null, lons)) * 0.08;
    var minLat = Math.min.apply(null, lats) - padLat, maxLat = Math.max.apply(null, lats) + padLat;
    var minLon = Math.min.apply(null, lons) - padLon, maxLon = Math.max.apply(null, lons) + padLon;
    var k = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
    var W = 360, H = 460;
    var sx = W / ((maxLon - minLon) * k), sy = H / (maxLat - minLat);
    var s = Math.min(sx, sy);
    var ox = (W - (maxLon - minLon) * k * s) / 2;
    var oy = (H - (maxLat - minLat) * s) / 2;
    return function (lat, lon) {
      return [ox + (lon - minLon) * k * s, oy + (maxLat - lat) * s];
    };
  }

  function buildSvgMap() {
    var pr = svgProject();
    function poly(points, attrs) {
      return '<polygon points="' + points.map(function (p) {
        var q = pr(p[0], p[1]);
        return q[0].toFixed(1) + ',' + q[1].toFixed(1);
      }).join(' ') + '" ' + attrs + '/>';
    }
    function line(points, attrs) {
      return '<polyline points="' + points.map(function (p) {
        var q = pr(p[0], p[1]);
        return q[0].toFixed(1) + ',' + q[1].toFixed(1);
      }).join(' ') + '" fill="none" ' + attrs + '/>';
    }
    var svg = '<svg viewBox="0 0 360 460" preserveAspectRatio="xMidYMid slice" role="img" aria-label="올림픽공원 약도">';
    svg += '<rect width="360" height="460" fill="#EAF0E6"/>';
    if ((GEO.park || []).length) {
      svg += poly(GEO.park, 'fill="#E3EDDA" stroke="#8FB287" stroke-width="1.4"');
    }
    (GEO.water || []).forEach(function (w) {
      svg += poly(w, 'fill="#CFE3EE" stroke="#9EC3D6" stroke-width="1"');
    });
    (GEO.paths || []).forEach(function (p) {
      svg += line(p, 'stroke="#C3CFBB" stroke-width="1" stroke-linecap="round"');
    });
    courses().forEach(function (c) {
      var pts = (c.points || []);
      svg += '<g data-svg-course="' + c.id + '" style="opacity:0">';
      svg += line(pts, 'stroke="#FFFFFF" stroke-width="9" stroke-linecap="round"');
      svg += line(pts, 'stroke="' + (COURSE_TONE[c.id] || '#1E5B43') + '" stroke-width="4" stroke-linecap="round"');
      svg += '</g>';
    });
    var rows = (state.park && state.park.rows) || [];
    (GEO.gates || []).forEach(function (g) {
      var row = null;
      rows.forEach(function (r) { if (r.name === g.name) row = r; });
      var grade = g.congestion && row ? row.grade : 'na';
      var col = grade === 'free' ? '#2E9E6A' : grade === 'mid' ? '#DE9A35' : grade === 'busy' ? '#D4563D' : '#9AA69F';
      var q = pr(g.lat, g.lon);
      var anchor = q[0] > 300 ? 'end' : 'start';
      var dx = q[0] > 300 ? -8 : 8;
      svg += '<g class="svgpin" data-svg-gate="' + g.id + '" transform="translate(' + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + ')">'
        + '<circle r="9" fill="' + col + '" opacity=".2"><animate attributeName="r" values="6;13;6" dur="2.8s" repeatCount="indefinite"/>'
        + '<animate attributeName="opacity" values=".3;0;.3" dur="2.8s" repeatCount="indefinite"/></circle>'
        + '<circle r="4.6" fill="' + col + '" stroke="#fff" stroke-width="2"/>'
        + '<text x="' + dx + '" y="-7" font-size="9" font-weight="700" text-anchor="' + anchor + '" fill="#13201A">' + esc(g.name) + '</text></g>';
    });
    svg += '</svg>';
    var box = $('#map-fallback');
    box.innerHTML = svg;
    box.hidden = false;
    $('#map').style.display = 'none';
    $('#map-badge').hidden = false;
    $('#map-badge').textContent = '자체 지도';
    $$('#map-fallback [data-svg-gate]').forEach(function (n) {
      n.style.cursor = 'pointer';
      n.addEventListener('click', function () { openGateSheet(n.getAttribute('data-svg-gate')); });
    });
  }

  function markSvgCourse(id) {
    $$('#map-fallback [data-svg-course]').forEach(function (n) {
      n.style.opacity = n.getAttribute('data-svg-course') === id ? '1' : '0';
    });
  }

  /* ------------------------------------------------------------------ */
  /* 탭 3 · 도감                                                        */
  /* ------------------------------------------------------------------ */
  function renderSpots() {
    var list = GEO.spots || [];
    var html = '';
    list.forEach(function (s) {
      html += '<button class="spot" type="button" data-spot="' + s.id + '">'
        + '<img class="spot__img" src="' + esc(s.img) + '" alt="' + esc(s.name) + ' 일러스트" loading="lazy">'
        + '<span class="spot__body"><span class="spot__name">' + esc(s.name) + '</span>'
        + '<span class="spot__season">' + esc(s.season) + '</span></span></button>';
    });
    $('#spot-grid').innerHTML = html;
    $$('#spot-grid .spot').forEach(function (b) {
      b.addEventListener('click', function () { openSpotSheet(b.getAttribute('data-spot')); });
    });
    var roses = (D.roses && D.roses.items) || [];
    var trees = (D.trees && D.trees.items) || [];
    $('#name-finder').innerHTML = '<button class="rowbtn" id="open-names" type="button">'
      + '<span class="rowbtn__ico">' + ico(ICON.leaf) + '</span>'
      + '<span class="rowbtn__body"><b>꽃·나무 이름 찾기</b>'
      + '<em>장미 ' + roses.length + '종 · 수목 ' + trees.length + '종</em></span>'
      + ico(ICON.chev, 'rowbtn__chev') + '</button>';
    $('#open-names').addEventListener('click', openNamesSheet);
  }

  function openNamesSheet() {
    var roses = (D.roses && D.roses.items) || [];
    var trees = (D.trees && D.trees.items) || [];
    var html = '<p class="section-label">장미광장 장미 ' + roses.length + '종</p>';
    roses.forEach(function (r) {
      html += '<dl class="kv"><dt>' + esc(r['장미명']) + '</dt><dd>' + esc([r['품명'], r['꽃색'], r['계통']].filter(Boolean).join(' · '))
        + (r['특성'] ? '<br><span style="color:var(--ink3)">' + esc(r['특성']) + '</span>' : '') + '</dd></dl>';
    });
    html += '<p class="section-label">공원 수목 ' + trees.length + '종</p>';
    trees.forEach(function (t) {
      html += '<dl class="kv"><dt>' + esc(t['수목명']) + '</dt><dd>' + esc(t['수목종류'] || '')
        + (t['설명'] ? '<br><span style="color:var(--ink3)">' + esc(t['설명']) + '</span>' : '') + '</dd></dl>';
    });
    html += '<div class="sheet__note">품종·계통 값은 공개 스펙에 맞춘 샘플이고, 장미광장 개화 시기(5~6월·9~10월)만 실데이터 안내입니다.</div>';
    openSheet('이름 찾기', html);
  }

  /* ------------------------------------------------------------------ */
  /* 탭 4 · 안내                                                        */
  /* ------------------------------------------------------------------ */
  function periodOf(ev) {
    var m = String(ev['행사기간'] || '').match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
    if (m) return { start: m[1], end: m[2] };
    var one = String(ev['행사기간'] || '').match(/(\d{4}-\d{2}-\d{2})/);
    return one ? { start: one[1], end: one[1] } : null;
  }

  function upcomingEvents() {
    var items = (D.events && D.events.items) || [];
    return items.map(function (e) {
      var p = periodOf(e) || { start: TODAY, end: TODAY };
      var d = gapDays(p.start, TODAY);
      return { e: e, p: p, d: d, live: d <= 0 && gapDays(p.end, TODAY) >= 0 };
    }).filter(function (x) { return gapDays(x.p.end, TODAY) >= 0; })
      .sort(function (a, b) { return a.d - b.d; });
  }

  function renderNowbar() {
    var box = $('#nowbar');
    if (!box) return;
    var evs = upcomingEvents();
    var todayEv = evs.filter(function (x) { return x.live; }).length;
    var rows = (D.lawn && D.lawn.rows) || [];
    var open = 0, shut = 0;
    rows.forEach(function (r) {
      if (r.place === '잔디통제시기') return;
      var st = lawnState(r, TODAY);
      if (st.status === 'open') open += 1; else if (st.status === 'closed') shut += 1;
    });
    box.innerHTML = '<span class="nowbar__item">오늘 공연 <b>' + (todayEv ? todayEv + '건' : '없음') + '</b></span>'
      + '<span class="nowbar__item"><i class="nowbar__dot nowbar__dot--open"></i>잔디 개방 <b>' + open + '곳</b></span>'
      + '<span class="nowbar__item"><i class="nowbar__dot nowbar__dot--off"></i>통제 <b>' + shut + '곳</b></span>';
  }

  function renderGuide() {
    var body = $('#guide-body');
    if (state.guide === 'event') body.innerHTML = guideEvent();
    else if (state.guide === 'lawn') body.innerHTML = guideLawn();
    else body.innerHTML = guideFaq();
    bindGuide();
  }

  function guideEvent() {
    var list = upcomingEvents();
    if (!list.length) return '<p class="empty">예정된 공연 정보가 없습니다.</p>';
    var html = '<p class="section-label">이번 주 · 다음 주</p><div class="list">';
    list.slice(0, 5).forEach(function (x) {
      var p = x.p;
      var when = mdOf(p.start) + (p.start === p.end ? '' : '~' + mdOf(p.end));
      html += '<button class="row" type="button" data-event="' + esc(x.e['행사명']) + '">'
        + '<span class="row__body"><span class="row__title">' + esc(x.e['행사명']) + '</span>'
        + '<span class="row__meta">' + esc(when + ' (' + wdOf(p.start) + ') · ' + (x.e['행사장소'] || '')) + '</span></span>'
        + '<span class="row__side">'
        + (x.live ? '<span class="pill pill--busy">오늘</span>' : '<span class="pill pill--na">' + (x.d === 1 ? '내일' : x.d + '일 뒤') + '</span>')
        + ico(ICON.chev, 'row__chev') + '</span></button>';
    });
    html += '</div>';
    html += '<a class="rowbtn" href="https://www.ksponco.or.kr/olympicpark/menu.es?mid=a20301010100" target="_blank" rel="noopener">'
      + '<span class="rowbtn__ico">' + ico(ICON.info) + '</span>'
      + '<span class="rowbtn__body"><b>기관 일정안내 전체 보기</b><em>공연·행사 원문 확인</em></span>'
      + ico(ICON.chev, 'rowbtn__chev') + '</a>';
    html += '<p class="fineprint">공연정보는 기관 홈페이지 일정안내를 옮긴 샘플 10건입니다. 대형 공연이 있는 날은 북2문·P4·P5 가 먼저 찹니다.</p>';
    return html;
  }

  function guideLawn() {
    var rows = (D.lawn && D.lawn.rows) || [];
    var html = '<p class="section-label">잔디시설 8곳 (중복 1건 포함)</p><div class="list">';
    rows.forEach(function (r) {
      var st = lawnState(r, TODAY);
      var cls = st.status === 'open' ? 'free' : st.status === 'closed' ? 'busy' : 'na';
      html += '<button class="row" type="button" data-lawn="' + esc(r.place) + '">'
        + '<span class="row__body"><span class="row__title">' + esc(r.place) + '</span>'
        + '<span class="row__meta">' + esc(st.raw || st.label) + '</span></span>'
        + '<span class="row__side"><span class="pill pill--' + cls + '">' + esc(st.status === 'open' ? '개방' : st.status === 'closed' ? '통제' : '확인 필요') + '</span>'
        + ico(ICON.chev, 'row__chev') + '</span></button>';
    });
    html += '</div>';
    html += '<p class="section-label">알아 두기</p><div class="list">';
    html += '<button class="row" type="button" data-rule="dog"><span class="row__body">'
      + '<span class="row__title">반려견</span><span class="row__meta">목줄·입마개·배변봉투 지참 시 산책 가능</span></span>'
      + ico(ICON.chev, 'row__chev') + '</button>';
    html += '<button class="row" type="button" data-rule="bike"><span class="row__body">'
      + '<span class="row__title">자전거·인라인</span><span class="row__meta">몽촌토성 안 산책로는 통행 제한</span></span>'
      + ico(ICON.chev, 'row__chev') + '</button>';
    html += '</div>';
    return html;
  }

  function guideFaq() {
    var items = (D.faq && D.faq.items) || [];
    var q = (state.faqQ || '').trim();
    var list = q ? items.filter(function (it) { return (it.question + it.answer).indexOf(q) >= 0; }) : items;
    var html = '<div class="searchbar">' + ico(ICON.search)
      + '<input id="faq-q" type="search" inputmode="search" placeholder="주차·장미·잔디 검색" value="' + esc(q) + '"></div>';
    if (!list.length) return html + '<p class="empty">검색 결과가 없습니다.</p>';
    html += '<div class="list">';
    list.slice(0, 8).forEach(function (it, i) {
      html += '<div class="faqq" data-idx="' + i + '">'
        + '<button class="faqq__q" type="button"><span>' + esc(it.question) + '</span>' + ico(ICON.chev, 'faqq__chev') + '</button>'
        + '<div class="faqq__a">' + esc(it.answer) + '</div></div>';
    });
    html += '</div>';
    if (list.length > 8) {
      html += '<button class="btn btn--ghost" style="width:100%;margin-top:14px" type="button" id="faq-all">'
        + '질문 ' + list.length + '건 모두 보기</button>';
    }
    state.faqList = list;
    return html;
  }

  function bindGuide() {
    $$('#guide-body [data-event]').forEach(function (b) {
      b.addEventListener('click', function () { openEventSheet(b.getAttribute('data-event')); });
    });
    $$('#guide-body [data-lawn]').forEach(function (b) {
      b.addEventListener('click', function () { openLawnSheet(b.getAttribute('data-lawn')); });
    });
    $$('#guide-body [data-rule]').forEach(function (b) {
      b.addEventListener('click', function () { openRuleSheet(b.getAttribute('data-rule')); });
    });
    $$('#guide-body .faqq__q').forEach(function (b) {
      b.addEventListener('click', function () {
        b.parentNode.classList.toggle('is-open');
      });
    });
    var q = $('#faq-q');
    if (q) {
      q.addEventListener('input', function () {
        state.faqQ = q.value;
        var pos = q.selectionStart;
        renderGuide();
        var n = $('#faq-q');
        if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
      });
    }
    var all = $('#faq-all');
    if (all) all.addEventListener('click', openFaqSheet);
  }

  /* ------------------------------------------------------------------ */
  /* 바텀시트                                                           */
  /* ------------------------------------------------------------------ */
  var sheet = $('#sheet');
  var lastFocus = null;
  var sheetTimer = null;

  function openSheet(title, html) {
    if (sheetTimer) { clearTimeout(sheetTimer); sheetTimer = null; }
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = html;
    lastFocus = document.activeElement;
    sheet.hidden = false;
    requestAnimationFrame(function () { sheet.classList.add('is-open'); });
    document.body.style.overflow = 'hidden';
    $$('#sheet-body [data-close]').forEach(function (b) {
      b.addEventListener('click', closeSheet);
    });
  }
  function closeSheet() {
    sheet.classList.remove('is-open');
    var chip = $('#btn-park');
    if (chip) chip.setAttribute('aria-expanded', 'false');
    if (sheetTimer) clearTimeout(sheetTimer);
    sheetTimer = setTimeout(function () {
      sheetTimer = null;
      sheet.hidden = true;
      $('#sheet-body').innerHTML = '';
      document.body.style.overflow = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }, 360);
  }
  $$('#sheet [data-close]').forEach(function (b) { b.addEventListener('click', closeSheet); });

  function openParkSheet() {
    var now = parkById(state.parkId) || PARKS[0];
    var html = '<p class="sheet__p">공원을 고르면 그 공원의 날씨·혼잡도·도감·안내로 바뀝니다. 지금은 <b>'
      + esc(now.name) + '</b> 데이터로 열려 있어요.</p>';
    html += '<div class="list parklist">';
    PARKS.forEach(function (p) {
      var on = p.id === state.parkId;
      html += '<button class="row parkrow' + (on ? ' is-on' : '') + '" type="button" data-park="' + esc(p.id) + '"'
        + (on ? ' aria-current="true"' : '') + '>'
        + '<span class="row__body"><span class="row__title">' + esc(p.name) + '</span>'
        + '<span class="row__meta">' + esc(p.meta) + '</span></span>'
        + '<span class="row__side">'
        + (on ? '<span class="pill pill--free">보는 중</span>' + ico(ICON.check, 'row__check')
              : '<span class="pill pill--na">확장 예정</span>')
        + '</span></button>';
    });
    html += '</div>';
    html += '<p class="sheet__note" id="park-note">공원이 늘어나도 화면과 계산식은 그대로 두고 데이터만 갈아 끼웁니다. 1차 실증은 올림픽공원입니다.</p>';
    openSheet('공원 선택', html);
    var chip = $('#btn-park');
    if (chip) chip.setAttribute('aria-expanded', 'true');
    $$('#sheet-body [data-park]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = parkById(b.getAttribute('data-park'));
        if (!p) return;
        if (p.live) { closeSheet(); return; }
        var n = $('#park-note');
        if (!n) return;
        n.classList.remove('is-flash');
        void n.offsetWidth;
        n.classList.add('is-flash');
        n.innerHTML = '<b>' + esc(p.name) + '</b>은 아직 연동 준비 중이에요. 지금은 올림픽공원 데이터로 열려 있습니다.';
      });
    });
  }

  function openInfoSheet() {
    var w = D.weather && D.weather.source;
    var html = '<p class="sheet__p"><b>지금공원</b>은 고른 공원의 날씨·혼잡도·코스·안내를 한 화면에 보여 주는 서비스입니다. 지금은 1차 실증 공원인 <b>올림픽공원</b> 데이터로 열려 있고, 상단의 공원 이름을 누르면 다른 공원의 준비 상황을 볼 수 있습니다.</p>';
    html += '<p class="sheet__p">화면의 숫자는 <b>기상청 단기예보 계산식</b>과 <b>한국체육산업개발 공공데이터</b>로만 만듭니다. 점수를 손으로 넣지 않습니다.</p>';
    html += '<dl class="kv"><dt>산책 지수</dt><dd>100점에서 기온·강수·하늘·바람·3시간 강수확률을 항목별로 깎고 5점 단위로 반올림합니다.</dd></dl>';
    html += '<dl class="kv"><dt>주차 등급</dt><dd>실시간 구역 대수의 30분 이동평균을 이력 혼잡도로 만든 통상 대수와 비교해 −15% 이하 여유 / +15% 이상 붐빔으로 나눕니다.</dd></dl>';
    html += '<dl class="kv"><dt>코스 거리</dt><dd>OpenStreetMap 보행로(산책로·계단·공원도로) 위 최단 경로를 계산한 값입니다. 손으로 그린 선이 아닙니다.</dd></dl>';
    html += '<dl class="kv"><dt>데이터</dt><dd>주차장 혼잡도 699행(2026-08-12까지) · 잔디시설 8행 · FAQ 49건은 실데이터, 실시간 주차·날씨·공연·수목·장미는 API 규격에 맞춘 샘플입니다.</dd></dl>';
    html += '<div class="sheet__note"><b>한계</b> — 실시간 주차현황에는 구역별 주차대수만 있고 총 면수가 없어 포화율은 계산하지 않습니다. 서2문(올림픽파크텔 주차장)은 CSV 에 구역 코드가 없어 등급을 내지 않고 “자료 없음”으로 둡니다. 혼잡도 이력 최신값은 ' + esc((D.parkingHistory && D.parkingHistory.meta.dateRange[1]) || '-') + ' 입니다.'
      + (w && w.isSample ? ' 날씨는 ' + esc(w.updatedAt.slice(0, 16).replace('T', ' ')) + ' 기준 샘플입니다.' : '') + '</div>';
    html += '<div class="sheet__actions"><a class="btn btn--ghost" href="mailto:data@ksponco.or.kr?subject=%5B%EC%A7%80%EA%B8%88%EA%B3%B5%EC%9B%90%5D%20%EB%8D%B0%EC%9D%B4%ED%84%B0%20%EC%98%A4%EB%A5%98">데이터 오류 신고</a></div>';
    openSheet('데이터·계산', html);
  }

  function openCourseSheet(id) {
    var c = courseById(id);
    if (!c) return;
    var rank = rankCourses(weatherState(MODES[state.mode].wx));
    var idx = rank.map(function (r) { return r.c.id; }).indexOf(id);
    var r = idx >= 0 ? rank[idx] : null;
    var html = '<div class="mapcard__top"><span class="mapcard__tag">' + esc(c.km + 'km · 약 ' + c.mins + '분') + '</span>'
      + (c.traits && c.traits.indoor ? '<span class="mapcard__tag mapcard__tag--tone">실내</span>' : '')
      + (r && idx === 0 ? '<span class="mapcard__tag">지금 1순위</span>' : '') + '</div>';
    html += '<div class="steps">';
    (c.waypoints || []).forEach(function (w, i) {
      html += '<div class="step"><span class="step__i">' + (i + 1) + '</span>'
        + '<span><span class="step__t">' + esc(w.name) + '</span></span></div>';
    });
    html += '</div>';
    html += '<p class="sheet__p">' + esc((r ? courseWhy(r) : '') + '. ') + esc(c.traits && c.traits.indoor
      ? '비·미세먼지가 심한 날에도 젖지 않고 걷는 구간입니다.'
      : '동선은 공원 보행로를 따라 계산했습니다.') + '</p>';
    html += '<div class="sheet__note">거리 ' + esc(c.km + 'km') + ' · 예상 ' + esc(c.mins) + '분 · 출발 ' + esc((gateInfo(c.gate) || {}).name || '')
      + '<br>계산 근거: ' + esc(c.source || 'OpenStreetMap 보행로') + ' (ODbL)</div>';
    html += '<div class="sheet__actions">'
      + '<a class="btn btn--primary" href="' + esc(courseNaver(c)) + '" target="_blank" rel="noopener">' + ico(ICON.nav) + '네이버 지도 길찾기</a>'
      + '<button class="btn btn--ghost" type="button" data-close="1" id="sheet-to-map">지도에서 보기</button></div>';
    openSheet(c.name, html);
    var btn = $('#sheet-to-map');
    if (btn) btn.addEventListener('click', function () {
      state.course = id;
      closeSheet();
      go('map');
      selectCourse(id, false);
    });
  }

  function openGateSheet(id) {
    var g = gateInfo(id);
    if (!g) return;
    var row = null;
    ((state.park && state.park.rows) || []).forEach(function (r) { if (r.name === g.name) row = r; });
    var html = '<div class="mapcard__top">';
    if (g.congestion && row) {
      html += '<span class="pill pill--' + row.grade + '">' + GRADE_LABEL[row.grade] + '</span>';
      html += '<span class="mapcard__tag">' + num(Math.round(row.cars)) + '대 · 통상보다 ' +
        (row.diff == null ? '-' : (row.diff > 0 ? '+' : '') + Math.round(row.diff) + '%') + '</span>';
    } else {
      html += '<span class="pill pill--na">주차 혼잡도 자료 없음</span>';
    }
    html += '</div>';
    html += '<dl class="kv"><dt>위치</dt><dd>' + esc(g.near.join(' · ')) + ' 쪽</dd></dl>';
    html += '<dl class="kv"><dt>주차구역</dt><dd>' + esc(g.congestion ? g.zones.join(' · ') : '올림픽파크텔 주차장') + '</dd></dl>';
    html += '<dl class="kv"><dt>안내</dt><dd>' + esc(g.note) + '</dd></dl>';
    if (row && row.zoneRows && row.zoneRows.length) {
      html += '<p class="section-label">구역별</p>';
      row.zoneRows.forEach(function (z) {
        html += '<dl class="kv"><dt>' + esc(z.zone) + (z.capSrc === '추정' ? ' (용량 추정)' : '') + '</dt><dd>'
          + (z.now == null ? '-' : num(Math.round(z.now)) + '대') + ' / 통상 ' + (z.base == null ? '-' : num(Math.round(z.base)) + '대')
          + '</dd></dl>';
      });
    }
    html += '<div class="sheet__note">' + (g.congestion
      ? '표본 ' + (row ? row.n : 0) + '건 · 같은 요일유형·같은 시간대(±' + ((state.park && state.park.band) || 1) + '시간) 기준'
      : '기관 주차안내에는 서2문에 올림픽파크텔 주차장이 있다고만 나오고, 혼잡도 CSV 에는 해당 구역 코드가 없습니다. 그래서 등급을 계산하지 않습니다.') + '</div>';
    html += '<div class="sheet__actions"><a class="btn btn--primary" href="' + esc(naverSearch(g.name)) + '" target="_blank" rel="noopener">'
      + ico(ICON.nav) + '네이버 지도에서 보기</a></div>';
    openSheet(g.name, html);
  }

  function openSpotSheet(id) {
    var s = null;
    (GEO.spots || []).forEach(function (x) { if (x.id === id) s = x; });
    if (!s) return;
    var html = '<img class="sheet__img" src="' + esc(s.img) + '" alt="' + esc(s.name) + ' 일러스트">';
    html += '<p class="sheet__p"><b>' + esc(s.line) + '</b></p>';
    html += '<p class="sheet__p">' + esc(s.body) + '</p>';
    html += '<dl class="kv"><dt>계절</dt><dd>' + esc(s.season) + '</dd></dl>';
    html += '<dl class="kv"><dt>좌표</dt><dd>' + s.lat.toFixed(5) + ', ' + s.lon.toFixed(5) + '</dd></dl>';
    html += '<div class="sheet__note">근거: ' + esc(s.tag) + '</div>';
    html += '<div class="sheet__actions"><a class="btn btn--primary" href="' + esc(naverSearch(s.name)) + '" target="_blank" rel="noopener">'
      + ico(ICON.nav) + '네이버 지도에서 보기</a></div>';
    openSheet(s.name, html);
  }

  function openEventSheet(name) {
    var list = upcomingEvents();
    var x = null;
    list.forEach(function (e) { if (e.e['행사명'] === name) x = e; });
    if (!x) return;
    var p = x.p;
    var html = '<div class="mapcard__top"><span class="mapcard__tag">' + esc(mdOf(p.start) + (p.start === p.end ? '' : '~' + mdOf(p.end))) + '</span>'
      + (x.live ? '<span class="pill pill--busy">오늘</span>' : '') + '</div>';
    html += '<dl class="kv"><dt>회차</dt><dd>' + esc(x.e['행사시간'] || '공지된 회차 없음') + '</dd></dl>';
    html += '<dl class="kv"><dt>장소</dt><dd>' + esc(x.e['행사장소'] || '-') + '</dd></dl>';
    html += '<div class="sheet__note">대형 공연이 있는 날은 KSPO DOME·P4·P5 가 먼저 차므로 북2문 대신 남2문·동2문을 권합니다.</div>';
    if (x.e['홈페이지URL']) {
      html += '<div class="sheet__actions"><a class="btn btn--primary" href="' + esc(x.e['홈페이지URL']) + '" target="_blank" rel="noopener">기관 일정 보기</a></div>';
    }
    openSheet(x.e['행사명'], html);
  }

  function openLawnSheet(place) {
    var rows = (D.lawn && D.lawn.rows) || [];
    var row = null;
    rows.forEach(function (r) { if (r.place === place) row = r; });
    if (!row) return;
    var st = lawnState(row, TODAY);
    var html = '<div class="mapcard__top"><span class="pill pill--' + (st.status === 'open' ? 'free' : 'busy') + '">'
      + esc(st.status === 'open' ? '오늘 개방' : '오늘 통제') + '</span></div>';
    html += '<dl class="kv"><dt>개방내용</dt><dd>' + esc(row.rawContent) + '</dd></dl>';
    html += '<dl class="kv"><dt>원문 열</dt><dd>' + esc(row.rawOpenTime) + ' (라벨 열)</dd></dl>';
    html += '<div class="sheet__note">잔디시설정보 CSV 의 `개방시간` 열에는 시각이 아니라 라벨이 들어 있어 `개방내용` 열을 근거로 오늘 상태를 계산했습니다.</div>';
    if (row.link) html += '<div class="sheet__actions"><a class="btn btn--ghost" href="' + esc(row.link) + '" target="_blank" rel="noopener">기관 안내 보기</a></div>';
    openSheet(place, html);
  }

  function openRuleSheet(kind) {
    var html = '';
    if (kind === 'dog') {
      html = '<p class="sheet__p">반려견과 산책·조깅은 가능하지만 위생과 안전을 위해 <b>목줄·입마개·배변봉투</b>를 지참한 경우에만 허용합니다. 공원 출입구와 산책로 주변 7개소에 준수사항이 게시되어 있습니다.</p>'
        + '<p class="sheet__p">장미광장은 산책길이 좁고 이용 인원이 많아 반려동물 동반 입장을 제한합니다.</p>';
      openSheet('반려견', html);
    } else {
      html = '<p class="sheet__p">공원 안에서 자전거·인라인은 안내방송과 경비 안내로 계도하고 있습니다. 특히 <b>몽촌토성 안 산책로는 자전거·인라인 통행이 제한</b>됩니다.</p>'
        + '<p class="sheet__p">비 오는 날에는 포장로(장미~나홀로나무 구간)와 실내 문화코스를 권합니다.</p>';
      openSheet('자전거·인라인', html);
    }
  }

  function openFaqSheet() {
    var list = state.faqList || ((D.faq && D.faq.items) || []);
    var html = '<div class="list">';
    list.forEach(function (it, i) {
      html += '<div class="faqq" data-idx="' + i + '"><button class="faqq__q" type="button"><span>' + esc(it.question) + '</span>'
        + ico(ICON.chev, 'faqq__chev') + '</button><div class="faqq__a">' + esc(it.answer) + '</div></div>';
    });
    html += '</div>';
    openSheet('자주 묻는 질문 ' + list.length + '건', html);
    $$('#sheet-body .faqq__q').forEach(function (b) {
      b.addEventListener('click', function () { b.parentNode.classList.toggle('is-open'); });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 탭 이동 · 이벤트                                                   */
  /* ------------------------------------------------------------------ */
  function go(view) {
    state.view = view;
    $$('.view').forEach(function (v) { v.classList.toggle('is-on', v.id === 'view-' + view); });
    $$('.tabbar__btn').forEach(function (b) {
      var on = b.getAttribute('data-view') === view;
      b.classList.toggle('is-on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (view === 'map') {
      ensureMap();
      setTimeout(function () {
        if (mapMode === 'svg') {
          if (!state.mapDrawn) { state.mapDrawn = true; }
          if (state.course) markSvgCourse(state.course);
          return;
        }
        if (!map) return;
        map.invalidateSize();
        if (!state.mapDrawn) {
          state.mapDrawn = true;
          map.fitBounds(window.L.latLngBounds((GEO.park || []).map(function (p) { return [p[0], p[1]]; })).pad(0.06), { animate: false });
          if (state.course) selectCourse(state.course, false);

        }
      }, 80);
    }
  }

  function setMode(mode) {
    state.mode = mode;
    $$('.demo__btn').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-demo') === mode);
    });
    renderRadar();
    if (mapReady) {
      if (mapMode === 'svg') { buildSvgMap(); if (state.course) markSvgCourse(state.course); }
      else refreshPins();
    }
    renderMapCard();
  }

  function bind() {
    $$('.tabbar__btn').forEach(function (b) {
      b.addEventListener('click', function () { go(b.getAttribute('data-view')); });
    });
    $$('.demo__btn').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-demo')); });
    });
    $$('#guide-seg .segmented__item').forEach(function (b) {
      b.addEventListener('click', function () {
        state.guide = b.getAttribute('data-guide');
        $$('#guide-seg .segmented__item').forEach(function (x) {
          var on = x === b;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        state.faqQ = '';
        renderGuide();
      });
    });
    $('#btn-info').addEventListener('click', openInfoSheet);
    $('#btn-park').addEventListener('click', openParkSheet);
    $('#map-recenter').addEventListener('click', function () {
      if (mapMode === 'svg') return;
      if (map) map.fitBounds(window.L.latLngBounds((GEO.park || []).map(function (p) { return [p[0], p[1]]; })).pad(0.06));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !sheet.hidden) closeSheet();
    });
  }

  /* ------------------------------------------------------------------ */
  function init() {
    state.course = (courses()[0] || {}).id;
    bind();
    renderRadar();
    renderChips();
    renderSpots();
    renderNowbar();
    renderGuide();
    renderMapCard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
