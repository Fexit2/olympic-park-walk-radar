/* =====================================================================
   지금공원 — API 설정·어댑터  (1차 실증: 올림픽공원)
   ---------------------------------------------------------------------
   지금 화면은 mode:'sample' 로 돌아간다. 활용신청을 받아 키를 넣고
   mode:'live' 로 바꾸면, 아래 어댑터가 실제 응답을 화면이 쓰는 모양으로
   바꿔 끼운다. 화면 코드(app.js)는 sample/live 를 구분하지 않는다.

   · data.go.kr 오픈API 5종은 모두 API 유형 LINK 라서 포털에 요청/응답
     명세표가 없다. 실제 스펙은 문화공공데이터광장(culture.go.kr) 또는
     기관 페이지(ksponco.or.kr/pubData/64)에 있고, 활용신청 후 받는
     명세서로 태그 이름을 확정해야 한다. 확정 전에는 tags 로 이름을
     바꿔 끼울 수 있게 해 두었다.
   ===================================================================== */
window.RADAR_CONFIG = {
  mode: 'sample', // 'sample' | 'live'

  /* 화면 하단·데이터 패널에 그대로 보여 줄 문구 */
  copyright: '데이터 출처: 한국체육산업개발(주) 개방 데이터 8종 · 기상청 단기예보. 오류·개선 신고: data@ksponco.or.kr',

  datasets: {
    /* 1. 실시간 주차현황 — 요청변수 ApiKey, 출력 parking_sum (포털 표기 확인) */
    parkingRealtime: {
      label: '실시간 주차현황',
      url: 'https://www.ksponco.or.kr/pubData/64',
      format: 'xml',
      keyParam: 'ApiKey',
      key: '',
      tags: { sum: 'parking_sum', zone: 'parking_id', updated: 'updt_dt', root: 'item' },
      note: '키를 넣고 mode 를 live 로 바꾸면 5분마다 호출해 30분 이동평균을 만든다.',
    },
    /* 2. 올림픽공원 공연정보 — 문화공공데이터광장 id=96 */
    events: {
      label: '올림픽공원 공연정보',
      url: 'https://www.culture.go.kr/openapi/rest/publicperformancedisplays/realm',
      format: 'xml',
      keyParam: 'serviceKey',
      key: '',
      extraParams: { id: '96' },
      tags: { title: '행사명', period: '행사기간', place: '행사장소', link: '홈페이지URL', root: 'item' },
    },
    /* 3. 올림픽공원 수목정보 — 문화공공데이터광장 */
    trees: {
      label: '올림픽공원 수목정보',
      url: 'https://www.culture.go.kr/openapi/rest/olympicpark/tree',
      format: 'xml',
      keyParam: 'serviceKey',
      key: '',
      extraParams: { id: '29' },
      tags: { name: '수목명', kind: '수목종류', desc: '설명', root: 'item' },
    },
    /* 4. 올림픽공원 장미광장 — 문화공공데이터광장 */
    roses: {
      label: '올림픽공원 장미광장',
      url: 'https://www.culture.go.kr/openapi/rest/olympicpark/rose',
      format: 'xml',
      keyParam: 'serviceKey',
      key: '',
      extraParams: { id: '31' },
      tags: { name: '장미명', cultivar: '품명', lineage: '계통', color: '꽃색', origin: '육성국', feature: '특성', root: 'item' },
    },
    /* 5. 올림픽공원 생태공원 갤러리 — 문화공공데이터광장 */
    ecoGallery: {
      label: '올림픽공원 생태공원 갤러리',
      url: 'https://www.culture.go.kr/openapi/rest/olympicpark/ecology',
      format: 'xml',
      keyParam: 'serviceKey',
      key: '',
      extraParams: { id: '30' },
      tags: { plant: '식물명', photo: '식물사진', link: 'URL', root: 'item' },
    },
    /* 기상청 단기예보 — 격자 nx·ny 는 올림픽공원 인근 */
    weather: {
      label: '기상청_단기예보 조회서비스',
      url: 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst',
      format: 'json',
      keyParam: 'serviceKey',
      key: '',
      grid: { nx: 62, ny: 126 },
    },
  },

  /* 샘플 JSON 경로 (data.go.kr 파일데이터에서 받아 만든 것 + 스펙 샘플) */
  sample: {
    parkingHistory: 'data/parking_history.json',
    realtime: 'data/sample_parking_realtime.json',
    lawn: 'data/lawn.json',
    faq: 'data/faq.json',
    weather: 'data/sample_weather.json',
    events: 'data/sample_events.json',
    trees: 'data/sample_trees.json',
    roses: 'data/sample_roses.json',
    ecoGallery: 'data/sample_eco_gallery.json',
    gates: 'data/gates.json',
  },
};

/* ---------------------------------------------------------------------
   XML → 배열 (태그 이름은 config.tags 로 지정)
   --------------------------------------------------------------------- */
function parseXmlItems(text, tags) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML 파싱 실패');
  const items = Array.from(doc.getElementsByTagName(tags.root || 'item'));
  return items.map((el) => {
    const row = {};
    Array.from(el.children).forEach((c) => {
      row[c.tagName] = (c.textContent || '').trim();
    });
    return row;
  });
}

/* ---------------------------------------------------------------------
   실시간 주차현황: 응답 1회분 → { snapshots:[{updt_dt, items:[…]}] }
   ---------------------------------------------------------------
   API 가 현재값만 주므로, 앱이 5분마다 호출해 스냅샷을 쌓아
   30분 이동평균을 만든다. 누적분은 localStorage 에 남긴다.
   --------------------------------------------------------------------- */
function adaptParking(text, conf) {
  const t = conf.tags;
  const rows = parseXmlItems(text, t);
  const items = rows.map((r) => ({
    parking_id: r[t.zone] || r.parking_id || '',
    parking_sum: r[t.sum] || '0',
  }));
  if (!items.length) throw new Error('주차현황 응답에 item 이 없습니다');
  const stamp = rows[0][t.updated] || new Date().toISOString();
  return { snapshots: [{ updt_dt: stamp, items }] };
}

/* 단기예보 발표시각 계산 */
function kmaBaseTime(d) {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const slots = [2, 5, 8, 11, 14, 17, 20, 23];
  let h = kst.getUTCHours();
  let m = kst.getUTCMinutes();
  let day = new Date(kst);
  let chosen = slots.filter((s) => s < h || (s === h && m >= 10)).pop();
  if (chosen === undefined) {
    day.setUTCDate(day.getUTCDate() - 1);
    chosen = 23;
  }
  const ymd = day.toISOString().slice(0, 10).replace(/-/g, '');
  return { date: ymd, time: String(chosen).padStart(2, '0') + '00' };
}

/* 문화공공데이터광장 응답 → 앱 모양 */
function adaptCultureItems(text, conf, mapper) {
  const rows = parseXmlItems(text, conf.tags);
  return rows.map((r) => mapper(r, conf.tags));
}

/* ---------------------------------------------------------------------
   로더 — 화면은 이 함수만 부른다
   --------------------------------------------------------------------- */
window.RadarAPI = {
  isLive() {
    return window.RADAR_CONFIG.mode === 'live';
  },

  /* sample 모드에서는 data-bundle.js(window.RADAR_DATA) 를 먼저 쓴다.
     file:// 로 열어도 <script> 로 이미 읽혀 있기 때문이다. 없으면 fetch. */
  async sampleData(key) {
    const map = window.RADAR_DATA || {};
    if (map[key]) return map[key];
    const res = await fetch(window.RADAR_CONFIG.sample[key], { cache: 'no-store' });
    if (!res.ok) throw new Error(`${key} 불러오기 실패 (${res.status})`);
    return res.json();
  },

  async parkingSnapshots() {
    if (!this.isLive()) {
      const s = await this.sampleData('realtime');
      return s;
    }
    const c = window.RADAR_CONFIG.datasets.parkingRealtime;
    const url = `${c.url}?${c.keyParam}=${encodeURIComponent(c.key)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`주차현황 응답 ${res.status}`);
    const text = await res.text();
    const one = adaptParking(text, c);
    /* 누적: 5분 간격 최대 7개(30분)만 보관 */
    const KEY = 'radar.parking.snapshots';
    const kept = JSON.parse(localStorage.getItem(KEY) || '[]');
    const last = kept[kept.length - 1];
    if (!last || last.updt_dt !== one.snapshots[0].updt_dt) kept.push(one.snapshots[0]);
    const trimmed = kept.slice(-7);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    return { snapshots: trimmed, source: { isSample: false } };
  },

  /* 기상청 단기예보: 발표시각(02·05·08·11·14·17·20·23시 +10분) 중 지난 것 하나를 고른다 */
  async weather() {
    if (!this.isLive()) return this.sampleData('weather');
    const c = window.RADAR_CONFIG.datasets.weather;
    const base = kmaBaseTime(new Date());
    const p = new URLSearchParams({
      [c.keyParam]: c.key, pageNo: '1', numOfRows: '400', dataType: 'JSON',
      base_date: base.date, base_time: base.time, nx: String(c.grid.nx), ny: String(c.grid.ny),
    });
    const res = await fetch(`${c.url}?${p}`);
    if (!res.ok) throw new Error(`단기예보 응답 ${res.status}`);
    const json = await res.json();
    const rows = json?.response?.body?.items?.item || [];
    if (!rows.length) throw new Error('단기예보 항목이 없습니다');

    const byTime = new Map();
    rows.forEach((r) => {
      const k = `${r.fcstDate}${r.fcstTime}`;
      if (!byTime.has(k)) byTime.set(k, { fcstDate: r.fcstDate, fcstTime: r.fcstTime });
      byTime.get(k)[r.category] = r.fcstValue;
    });
    const forecast = Array.from(byTime.values()).sort((a, b) =>
      `${a.fcstDate}${a.fcstTime}`.localeCompare(`${b.fcstDate}${b.fcstTime}`));

    const nowKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 13).replace(/[-T]/g, '');
    const nearest = forecast.find((f) => `${f.fcstDate}${f.fcstTime.slice(0, 2)}` >= nowKst.slice(0, 10)) || forecast[0];
    return {
      now: {
        fcstDate: nearest.fcstDate,
        fcstTime: nearest.fcstTime,
        T1H: Number(nearest.TMP),
        PTY: Number(nearest.PTY || 0),
        RN1: nearest.PCP || '0',
        SKY: Number(nearest.SKY || 1),
        WSD: Number(nearest.WSD || 0),
        REH: Number(nearest.REH || 0),
      },
      forecast: forecast.map((f) => ({
        fcstDate: f.fcstDate, fcstTime: f.fcstTime, TMP: Number(f.TMP),
        POP: Number(f.POP || 0), PTY: Number(f.PTY || 0),
        SKY: Number(f.SKY || 1), WSD: Number(f.WSD || 0),
      })),
      source: { isSample: false, updatedAt: new Date().toISOString(), grid: c.grid },
    };
  },

  async events() {
    if (!this.isLive()) return this.sampleData('events');
    const c = window.RADAR_CONFIG.datasets.events;
    const p = new URLSearchParams({ [c.keyParam]: c.key, numOfRows: '30', pageNo: '1', ...c.extraParams });
    const res = await fetch(`${c.url}?${p}`);
    if (!res.ok) throw new Error(`공연정보 응답 ${res.status}`);
    const items = adaptCultureItems(await res.text(), c, (r, t) => ({
      행사명: r[t.title], 행사기간: r[t.period], 행사장소: r[t.place], 홈페이지URL: r[t.link],
    }));
    return { items, source: { isSample: false, updatedAt: new Date().toISOString() } };
  },

  async trees() {
    if (!this.isLive()) return this.sampleData('trees');
    const c = window.RADAR_CONFIG.datasets.trees;
    const p = new URLSearchParams({ [c.keyParam]: c.key, numOfRows: '200', pageNo: '1', ...c.extraParams });
    const res = await fetch(`${c.url}?${p}`);
    if (!res.ok) throw new Error(`수목정보 응답 ${res.status}`);
    const items = adaptCultureItems(await res.text(), c, (r, t) => ({
      수목명: r[t.name], 수목종류: r[t.kind], 설명: r[t.desc],
    }));
    return { items, source: { isSample: false, updatedAt: new Date().toISOString() } };
  },

  async roses() {
    if (!this.isLive()) return this.sampleData('roses');
    const c = window.RADAR_CONFIG.datasets.roses;
    const p = new URLSearchParams({ [c.keyParam]: c.key, numOfRows: '300', pageNo: '1', ...c.extraParams });
    const res = await fetch(`${c.url}?${p}`);
    if (!res.ok) throw new Error(`장미광장 응답 ${res.status}`);
    const items = adaptCultureItems(await res.text(), c, (r, t) => ({
      장미명: r[t.name], 품명: r[t.cultivar], 계통: r[t.lineage], 꽃색: r[t.color], 육성국: r[t.origin], 특성: r[t.feature],
    }));
    return { items, source: { isSample: false, updatedAt: new Date().toISOString() } };
  },

  async ecoGallery() {
    if (!this.isLive()) return this.sampleData('ecoGallery');
    const c = window.RADAR_CONFIG.datasets.ecoGallery;
    const p = new URLSearchParams({ [c.keyParam]: c.key, numOfRows: '300', pageNo: '1', ...c.extraParams });
    const res = await fetch(`${c.url}?${p}`);
    if (!res.ok) throw new Error(`생태공원 갤러리 응답 ${res.status}`);
    const items = adaptCultureItems(await res.text(), c, (r, t) => ({
      식물명: r[t.plant], 식물사진: r[t.photo], URL: r[t.link],
    }));
    return { items, source: { isSample: false, updatedAt: new Date().toISOString() } };
  },
};
