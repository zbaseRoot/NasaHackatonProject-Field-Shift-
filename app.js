(function () {
  "use strict";

  const DATA = window.FIELD_SHIFT_DATA;
  const STORAGE_KEY = "field_shift_fields_v2";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const SCLEROTINIA_GROUP = new Set(["sunflower", "soybean", "rapeseed", "chickpea", "lentil", "field_pea"]);
  const CEREAL_GROUP = new Set(["winter_wheat", "winter_barley", "corn", "sorghum", "millet"]);
  const UK_ALIAS_MAP = {
    "черкаси": "Cherkasy",
    "одеса": "Odesa",
    "київ": "Kyiv Ukraine",
    "полтава": "Poltava Ukraine",
    "вінниця": "Vinnytsia Ukraine",
    "харків": "Kharkiv Ukraine",
    "дніпро": "Dnipro Ukraine",
    "львів": "Lviv Ukraine",
    "миколаїв": "Mykolaiv Ukraine",
    "херсон": "Kherson Ukraine",
    "канзас": "Kansas",
    "андалусія": "Andalusia",
    "бразилія": "Mato Grosso",
    "кенія": "Nakuru Kenya"
  };

  const EXTRA_NASA_ZONES = [
    { name: "Poltava Loam Belt", name_ua: "Полтавський суглинковий пояс", lat: 49.58, lon: 34.55, moisturePct: 33, balanceMm: -58, risk: "mod" },
    { name: "Saskatchewan Prairies", name_ua: "Прерії Саскачевану", lat: 50.45, lon: -104.61, moisturePct: 26, balanceMm: -135, risk: "high" },
    { name: "Castilla y Leon Dryland", name_ua: "Богарні землі Кастилії-і-Леону", lat: 41.65, lon: -4.72, moisturePct: 21, balanceMm: -210, risk: "high" },
    { name: "Pampas Pergamino", name_ua: "Пампа Пергаміно", lat: -33.89, lon: -60.57, moisturePct: 39, balanceMm: 45, risk: "low" },
    { name: "Murray-Darling Basin", name_ua: "Басейн Муррей-Дарлінг", lat: -34.18, lon: 142.16, moisturePct: 19, balanceMm: -245, risk: "high" },
    { name: "Punjab Alluvial Plain", name_ua: "Алювіальна рівнина Пенджабу", lat: 30.90, lon: 75.85, moisturePct: 29, balanceMm: -120, risk: "mod" }
  ];

  const state = {
    lang: localStorage.getItem("field_shift_lang") || "en",
    fields: [],
    activeFieldId: null,
    activeView: "workspace",
    activeTab: "climate",
    sortBy: "default",
    basemap: "sat",
    showLabels: true,
    showZones: true,
    isDrawing: false,
    redrawTargetId: null,
    drawPoints: [],
    priorityMode: "water_first",
    weights: { water: 45, soil: 30, profit: 25 },
    useCoverCrop: true,
    coverCropId: "rye_vetch",
    useNoTill: true,
    planSequence: ["winter_wheat", "chickpea", "sorghum", "winter_barley"],
    overrides: null,
    printMode: "field",
    theme: (() => {
      try {
        return localStorage.getItem("field_shift_theme") === "dark" ? "dark" : "light";
      } catch (_e) {
        return "light";
      }
    })(),
    telemetryLoading: false,
    activeRequestSeq: 0,
    liveForecast: null,
    liveCurrent: null,
    liveSoilGrids: null,
    livePowerStats: null,
    nasaCache: new Map(),
    powerCache: new Map(),
    toastTimer: null
  };

  let map = null;
  let layerSat = null;
  let layerTer = null;
  let layerLabels = null;
  let fieldsLayerGroup = null;
  let zonesLayerGroup = null;
  let drawLayerGroup = null;
  let searchDebounce = null;
  let mapClickLocked = false;
  let pendingMapClickTimer = null;
  let activeProbeSeq = 0;
  let probePopup = null;

  const $ = (id) => document.getElementById(id);

  function t(key, fallback = "") {
    const lang = state.lang || "en";
    return DATA.i18n?.[lang]?.[key] || DATA.i18n?.en?.[key] || fallback || key;
  }

  function getCropName(cropId) {
    const c = DATA.crops[cropId];
    if (!c) return cropId || "";
    if (state.lang === "ua" && DATA.i18n?.crops?.[cropId]?.name_ua) {
      return DATA.i18n.crops[cropId].name_ua;
    }
    return c.name;
  }

  function getCropShortName(cropId) {
    const c = DATA.crops[cropId];
    if (!c) return cropId || "";
    if (state.lang === "ua" && DATA.i18n?.crops?.[cropId]?.shortName_ua) {
      return DATA.i18n.crops[cropId].shortName_ua;
    }
    return c.shortName;
  }

  function getCropBadge(cropId) {
    const c = DATA.crops[cropId];
    if (!c) return "";
    if (state.lang === "ua" && DATA.i18n?.crops?.[cropId]?.badge_ua) {
      return DATA.i18n.crops[cropId].badge_ua;
    }
    return c.categoryBadge;
  }

  function getSoilName(soilId) {
    const s = DATA.soilTypes[soilId];
    if (!s) return soilId || "";
    if (state.lang === "ua" && DATA.i18n?.soils?.[soilId]?.name_ua) {
      return DATA.i18n.soils[soilId].name_ua;
    }
    return s.name;
  }

  function getCoverCropName(coverId) {
    const cb = DATA.coverCropBridges[coverId];
    if (!cb) return coverId || "";
    if (state.lang === "ua" && DATA.i18n?.cover?.[coverId]?.name_ua) {
      return DATA.i18n.cover[coverId].name_ua;
    }
    return cb.name;
  }

  function getFieldName(field) {
    if (!field) return "";
    if (state.lang === "ua" && field.name_ua) return field.name_ua;
    return field.name || "";
  }

  function getFieldRegion(field) {
    if (!field) return "";
    if (state.lang === "ua" && field.region_ua) return field.region_ua;
    return field.region || "";
  }

  function getFieldCountry(field) {
    if (!field) return "";
    if (state.lang === "ua" && field.country_ua) return field.country_ua;
    return field.country || "";
  }

  function getFieldDiagnosis(field) {
    if (!field) return "";
    if (state.lang === "ua" && field.humanDiagnosis_ua) return field.humanDiagnosis_ua;
    return field.humanDiagnosis || "";
  }

  function getCropFamily(cropId) {
    const c = DATA.crops[cropId];
    if (!c) return "";
    if (state.lang === "ua" && DATA.i18n?.crops?.[cropId]?.family_ua) {
      return DATA.i18n.crops[cropId].family_ua;
    }
    return c.family || "";
  }

  function getCropWindow(cropId) {
    const c = DATA.crops[cropId];
    if (!c) return "";
    if (state.lang === "ua" && DATA.i18n?.crops?.[cropId]?.windowLabel_ua) {
      return DATA.i18n.crops[cropId].windowLabel_ua;
    }
    return c.windowLabel || "";
  }

  function getPriorityModeLabel(modeId) {
    const m = DATA.priorityModes[modeId];
    if (!m) return modeId || "";
    if (state.lang === "ua" && DATA.i18n?.modes?.[modeId]?.label_ua) {
      return DATA.i18n.modes[modeId].label_ua;
    }
    return m.label;
  }

  function getPriorityModeDesc(modeId) {
    const m = DATA.priorityModes[modeId];
    if (!m) return "";
    if (state.lang === "ua" && DATA.i18n?.modes?.[modeId]?.desc_ua) {
      return DATA.i18n.modes[modeId].desc_ua;
    }
    return m.shortDesc;
  }

  function formatUsd(val, suffix = "") {
    const num = Math.round(Number(val) || 0);
    return `${num < 0 ? "-" : ""}$${Math.abs(num).toLocaleString()}${suffix}`;
  }

  function formatSignedUsd(val, suffix = "") {
    const num = Math.round(Number(val) || 0);
    return `${num < 0 ? "-" : "+"}$${Math.abs(num).toLocaleString()}${suffix}`;
  }

  function updateThemeButtonUi() {
    const btn = $("themeToggleBtn");
    if (!btn) return;
    const isDark = state.theme === "dark";
    btn.setAttribute("aria-pressed", String(isDark));
    btn.title = t(isDark ? "themeToLightTitle" : "themeToDarkTitle");
  }

  function applyTheme(themeName, announce = false, persist = true) {
    state.theme = themeName === "dark" ? "dark" : "light";
    if (state.theme === "dark") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.content = state.theme === "dark" ? "#0B1220" : "#DCEFFB";
    }
    if (persist) {
      try {
        localStorage.setItem("field_shift_theme", state.theme);
      } catch (_e) {}
    }
    updateThemeButtonUi();
    if (typeof redrawVisibleCharts === "function") redrawVisibleCharts();
    if (announce) {
      const msg = state.lang === "ua"
        ? (state.theme === "dark" ? "Увімкнено темну тему" : "Увімкнено світлу тему")
        : (state.theme === "dark" ? "Switched to Dark Theme" : "Switched to Light Theme");
      showToast(msg);
    }
  }

  function applyStaticTranslations() {
    const isUa = state.lang === "ua";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      const text = t(key);
      if (text) el.textContent = text;
    });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      const key = el.dataset.i18nPh;
      const text = t(key);
      if (text) el.placeholder = text;
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.dataset.i18nTitle;
      const text = t(key);
      if (text) el.title = text;
    });

    const ganttHead = $("ganttMonthsHead");
    if (ganttHead) {
      const letters = isUa
        ? ["С", "Л", "Б", "К", "Т", "Ч", "Л", "С", "В", "Ж", "Л", "Г"]
        : ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
      ganttHead.innerHTML = letters.map((l) => `<span>${l}</span>`).join("");
    }

    const btnEn = $("langBtnEn");
    const btnUa = $("langBtnUa");
    if (btnEn) btnEn.classList.toggle("is-active", !isUa);
    if (btnUa) btnUa.classList.toggle("is-active", isUa);
    document.documentElement.lang = isUa ? "uk" : "en";
    updateThemeButtonUi();
    if (typeof updateLeftNavLabel === "function") updateLeftNavLabel();
    if (typeof syncCustomSelects === "function") syncCustomSelects();
  }

  function setLanguage(newLang) {
    if (state.lang === newLang) return;
    state.lang = newLang;
    try {
      localStorage.setItem("field_shift_lang", newLang);
    } catch (_e) {}
    applyStaticTranslations();
    populateStaticSelects();
    renderAll();
    renderFieldPolygons(false);
    renderZonesOverlay();
    if (typeof refreshTourLanguage === "function") refreshTourLanguage();
    showToast(newLang === "ua" ? "Мову інтерфейсу переключено на українську" : "Interface language switched to English");
  }

  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  function deepClone(obj) {
    if (obj === undefined || obj === null) return obj;
    return JSON.parse(JSON.stringify(obj));
  }

  function getPresetSequence(field, modeId) {
    const modeObj = DATA.priorityModes[modeId];
    const targetKey = modeObj?.targetPresetKey || modeId;
    const seq = field?.presets?.[targetKey] || field?.presets?.water_saver || Object.values(field?.presets || {})[0];
    return seq ? deepClone(seq) : ["winter_wheat", "chickpea", "sorghum", "winter_barley"];
  }

  function showToast(msg) {
    const toast = $("appToast");
    toast.textContent = msg;
    toast.classList.remove("is-hidden");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      toast.classList.add("is-hidden");
    }, 3200);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function computePolygonAreaHa(latlngs) {
    if (!Array.isArray(latlngs) || latlngs.length < 3) return 0;
    const R = 6378137;
    const rad = Math.PI / 180;
    let total = 0;
    for (let i = 0; i < latlngs.length; i += 1) {
      const p1 = latlngs[i];
      const p2 = latlngs[(i + 1) % latlngs.length];
      const lat1 = p1[0] * rad;
      const lat2 = p2[0] * rad;
      const dLon = (p2[1] - p1[1]) * rad;
      total += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    const sqm = Math.abs(total * R * R / 2);
    return Math.max(0.5, Number((sqm / 10000).toFixed(1)));
  }

  function computePolygonCentroid(latlngs) {
    if (!Array.isArray(latlngs) || latlngs.length === 0) return [49.38, 31.95];
    let sumLat = 0;
    let sumLon = 0;
    for (const pt of latlngs) {
      sumLat += pt[0];
      sumLon += pt[1];
    }
    return [
      Number((sumLat / latlngs.length).toFixed(5)),
      Number((sumLon / latlngs.length).toFixed(5))
    ];
  }

  function createRectPolygon(lat, lon, targetHa) {
    const sideMeters = Math.sqrt(Math.max(4, targetHa) * 10000);
    const halfLat = (sideMeters * 0.5) / 111320;
    const cosLat = Math.max(0.25, Math.cos((lat * Math.PI) / 180));
    const halfLon = (sideMeters * 0.5) / (111320 * cosLat);
    return [
      [Number((lat + halfLat).toFixed(5)), Number((lon - halfLon).toFixed(5))],
      [Number((lat + halfLat).toFixed(5)), Number((lon + halfLon).toFixed(5))],
      [Number((lat - halfLat).toFixed(5)), Number((lon + halfLon).toFixed(5))],
      [Number((lat - halfLat).toFixed(5)), Number((lon - halfLon).toFixed(5))]
    ];
  }

  function buildFieldThumbSvg(polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) {
      return "<svg viewBox=\"0 0 40 40\" width=\"34\" height=\"34\"><rect x=\"8\" y=\"8\" width=\"24\" height=\"24\" rx=\"3\" fill=\"rgba(185,237,110,0.22)\" stroke=\"#B9ED6E\" stroke-width=\"2\"/></svg>";
    }
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const [lat, lon] of polygon) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    const spanLat = Math.max(0.0001, maxLat - minLat);
    const spanLon = Math.max(0.0001, maxLon - minLon);
    const span = Math.max(spanLat, spanLon);
    const padX = (span - spanLon) * 0.5;
    const padY = (span - spanLat) * 0.5;
    const pts = polygon
      .map(([lat, lon]) => {
        const x = 6 + ((lon - minLon + padX) / span) * 28;
        const y = 34 - ((lat - minLat + padY) / span) * 28;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return `<svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true"><polygon points="${pts}" fill="rgba(185,237,110,0.25)" stroke="#B9ED6E" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }

  function loadStoredFields() {
    const demos = DATA.globalLocations.map((loc) => ({
      ...deepClone(loc),
      isDemo: true,
      selectedPlan: getPresetSequence(loc, state.priorityMode),
      coverCropId: "rye_vetch",
      useCoverCrop: true,
      useNoTill: true
    }));

    let custom = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          custom = parsed.filter((f) => f && f.id && !String(f.id).startsWith("custom_sample_") && Array.isArray(f.polygon));
        }
      }
    } catch (_err) {
      custom = [];
    }

    const demoOverrides = {};
    try {
      const rawOv = localStorage.getItem(`${STORAGE_KEY}_overrides`);
      if (rawOv) Object.assign(demoOverrides, JSON.parse(rawOv));
    } catch (_err) {
      Object.keys(demoOverrides).forEach((k) => delete demoOverrides[k]);
    }

    const mergedDemos = demos.map((d) => {
      const saved = demoOverrides[d.id];
      return saved ? { ...d, ...saved, isDemo: true } : d;
    });

    state.fields = [...custom, ...mergedDemos];
    state.activeFieldId = state.fields[0] ? state.fields[0].id : null;
  }

  function saveFieldsToStorage() {
    try {
      const customFields = state.fields.filter((f) => !f.isDemo);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customFields));

      const demoMeta = {};
      for (const f of state.fields) {
        if (f.isDemo) {
          demoMeta[f.id] = {
            selectedPlan: f.selectedPlan,
            coverCropId: f.coverCropId,
            useCoverCrop: f.useCoverCrop,
            useNoTill: f.useNoTill,
            polygon: f.polygon,
            lat: f.lat,
            lon: f.lon,
            defaultAreaHa: f.defaultAreaHa,
            defaultSoilType: f.defaultSoilType,
            defaultPrevCrop: f.defaultPrevCrop,
            defaultSomPct: f.defaultSomPct,
            defaultSoilPh: f.defaultSoilPh
          };
        }
      }
      localStorage.setItem(`${STORAGE_KEY}_overrides`, JSON.stringify(demoMeta));
    } catch (_err) {
      showToast(state.lang === "ua" ? "Перевищено ліміт пам'яті браузера" : "Browser storage quota reached");
    }
  }

  function getActiveField() {
    return state.fields.find((f) => f.id === state.activeFieldId) || state.fields[0];
  }

  function getEffectiveSoilAndField(field) {
    const soilTypeId = state.overrides?.soilTypeId || field.defaultSoilType || "chernozem";
    const somPct = state.overrides?.somPct ?? field.defaultSomPct ?? 3.2;
    const ph = state.overrides?.ph ?? field.defaultSoilPh ?? 6.6;
    const prevCrop = state.overrides?.prevCrop || field.defaultPrevCrop || "corn";
    const areaHa = state.overrides?.areaHa ?? field.defaultAreaHa ?? 40;
    const soil = DATA.soilTypes[soilTypeId] || DATA.soilTypes.chernozem;
    return { soilTypeId, soil, somPct, ph, prevCrop, areaHa };
  }

  function formatPowerYmd(dateObj) {
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getUTCDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }

  function getPowerDateWindow() {
    const now = new Date();
    const lastCompleteYear = Math.max(2020, now.getUTCFullYear() - 1);
    const startYear = Math.max(1991, lastCompleteYear - 34);
    const endDaily = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 4));
    const startDaily = new Date(endDaily.getTime() - 372 * 86400000);
    return {
      startYear,
      lastCompleteYear,
      dailyStartYmd: formatPowerYmd(startDaily),
      dailyEndYmd: formatPowerYmd(endDaily)
    };
  }

  function avgValid(values, minAllowed = -900) {
    let sum = 0;
    let count = 0;
    for (const v of values) {
      if (typeof v === "number" && Number.isFinite(v) && v > minAllowed) {
        sum += v;
        count += 1;
      }
    }
    return count > 0 ? sum / count : null;
  }

  function computeFao56DailyEt0(tMeanC, rsMjDay, rhPct, wind2mMs, latDeg, doy) {
    const t = clamp(Number(tMeanC) || 12, -30, 50);
    const rh = clamp(Number(rhPct) || 65, 12, 100);
    const u2 = clamp(Number(wind2mMs) || 2.0, 0.3, 12);
    const rs = Math.max(0.5, Number(rsMjDay) || 5);
    const es = 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
    const ea = es * (rh / 100);
    const delta = (4098 * es) / Math.pow(t + 237.3, 2);
    const gamma = 0.0665;
    const phi = (clamp(latDeg, -66, 66) * Math.PI) / 180;
    const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
    const decl = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
    const ws = Math.acos(clamp(-Math.tan(phi) * Math.tan(decl), -1, 1));
    const ra = ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.sin(ws));
    const rso = Math.max(0.5, 0.75 * ra);
    const rns = 0.77 * rs;
    const tk4 = Math.pow(t + 273.16, 4);
    const rnl = 4.903e-9 * tk4 * (0.34 - 0.14 * Math.sqrt(Math.max(0.01, ea))) * (1.35 * Math.min(1, rs / rso) - 0.35);
    const rn = Math.max(0, rns - rnl);
    const num = 0.408 * delta * rn + gamma * (900 / (t + 273)) * u2 * Math.max(0, es - ea);
    const den = delta + gamma * (1 + 0.34 * u2);
    return Math.max(0.1, num / den);
  }

  function buildDynamicBaseline(lat, lon, powerBundle, soilGridsData) {
    const absLat = Math.abs(lat);
    const { lastCompleteYear } = getPowerDateWindow();
    const monthly = powerBundle?.monthly || null;
    const daily = powerBundle?.daily || null;
    const clim = powerBundle?.climatology || (powerBundle && powerBundle.PRECTOTCORR ? powerBundle : null);

    const mKeys = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const daysInMo = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const doyMid = [15, 46, 75, 105, 135, 166, 196, 227, 258, 288, 319, 349];
    const recentYears = Array.from({ length: 10 }, (_, idx) => lastCompleteYear - 9 + idx);

    let monthlyPrecipMm = [36, 34, 38, 44, 58, 66, 56, 48, 45, 42, 39, 34];
    let monthlyTempMaxC = [0, 2, 8, 15, 22, 26, 29, 28, 22, 14, 7, 2];
    let rootMoisturePct = 28;
    let deepMoisturePct = 36;
    let hasLiveNasa = false;

    if (monthly?.PRECTOTCORR) {
      hasLiveNasa = true;
      monthlyPrecipMm = Array.from({ length: 12 }, (_, mIdx) => {
        const mmStr = String(mIdx + 1).padStart(2, "0");
        const avgDaily = avgValid(recentYears.map((y) => monthly.PRECTOTCORR[`${y}${mmStr}`]), -0.001);
        return avgDaily != null ? Math.round(avgDaily * daysInMo[mIdx]) : monthlyPrecipMm[mIdx];
      });
    } else if (clim?.PRECTOTCORR) {
      hasLiveNasa = true;
      monthlyPrecipMm = mKeys.map((mk, idx) => {
        const val = clim.PRECTOTCORR[mk];
        return val != null && val >= 0 ? Math.round(val * daysInMo[idx]) : monthlyPrecipMm[idx];
      });
    } else {
      const latFactor = clamp((48 - absLat) / 48, 0, 1);
      const fallbackAnnual = Math.round(420 + (1 - latFactor) * 260);
      monthlyPrecipMm = monthlyPrecipMm.map((v) => Math.round((v / 540) * fallbackAnnual));
    }
    const annualPrecipMm = monthlyPrecipMm.reduce((a, b) => a + b, 0);

    let extremeHeatDays = null;
    if (daily?.T2M_MAX) {
      hasLiveNasa = true;
      const validDailyTmax = Object.entries(daily.T2M_MAX)
        .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v > -900)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-365);

      if (validDailyTmax.length >= 30) {
        extremeHeatDays = validDailyTmax.reduce((acc, [, v]) => acc + (v >= 30 ? 1 : 0), 0);
        const byMonth = Array.from({ length: 12 }, () => []);
        for (const [ymd, v] of validDailyTmax) {
          const mIdx = Number(ymd.slice(4, 6)) - 1;
          if (mIdx >= 0 && mIdx < 12) byMonth[mIdx].push(v);
        }
        monthlyTempMaxC = byMonth.map((vals, mIdx) => {
          const mAvg = avgValid(vals, -900);
          if (mAvg != null) return Number(mAvg.toFixed(1));
          const cVal = clim?.T2M_MAX?.[mKeys[mIdx]];
          return cVal != null && cVal > -60 ? Number(cVal.toFixed(1)) : monthlyTempMaxC[mIdx];
        });
      }
    } else if (clim?.T2M_MAX) {
      hasLiveNasa = true;
      monthlyTempMaxC = mKeys.map((mk, idx) => {
        const val = clim.T2M_MAX[mk];
        return val != null && val > -60 ? Number(val.toFixed(1)) : monthlyTempMaxC[idx];
      });
    }

    let monthlyEtMm = null;
    if (monthly?.T2M && monthly?.ALLSKY_SFC_SW_DWN && monthly?.RH2M && monthly?.WS2M) {
      monthlyEtMm = Array.from({ length: 12 }, (_, mIdx) => {
        const mmStr = String(mIdx + 1).padStart(2, "0");
        const tAvg = avgValid(recentYears.map((y) => monthly.T2M[`${y}${mmStr}`]), -900);
        const rsAvg = avgValid(recentYears.map((y) => monthly.ALLSKY_SFC_SW_DWN[`${y}${mmStr}`]), -0.001);
        const rhAvg = avgValid(recentYears.map((y) => monthly.RH2M[`${y}${mmStr}`]), -0.001);
        const u2Avg = avgValid(recentYears.map((y) => monthly.WS2M[`${y}${mmStr}`]), -0.001);
        if (tAvg == null || rsAvg == null || rhAvg == null || u2Avg == null) return null;
        const et0 = computeFao56DailyEt0(tAvg, rsAvg, rhAvg, u2Avg, lat, doyMid[mIdx]);
        return Math.round(et0 * daysInMo[mIdx] * 0.78);
      });
      if (monthlyEtMm.some((v) => v == null)) monthlyEtMm = null;
    }

    if (!monthlyEtMm) {
      monthlyEtMm = monthlyTempMaxC.map((tMax, i) => {
        const baseEt = Math.max(12, (tMax + 4) * 3.9 + (absLat < 35 ? 25 : 8));
        const seasonBoost = i >= 4 && i <= 7 ? 1.24 : 0.85;
        return Math.round(baseEt * seasonBoost);
      });
    }
    const annualEtDemandMm = monthlyEtMm.reduce((a, b) => a + b, 0);
    const seasonalWaterBalanceMm = annualPrecipMm - annualEtDemandMm;

    if (extremeHeatDays == null) {
      const hotMonths = monthlyTempMaxC.filter((temp) => temp >= 28).length;
      extremeHeatDays = clamp(hotMonths * 7 + (seasonalWaterBalanceMm < -120 ? 12 : 3), 0, 90);
    }

    let rootWetness = null;
    let profWetness = null;
    if (daily?.GWETROOT) {
      const vals = Object.entries(daily.GWETROOT)
        .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v >= 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-14)
        .map(([, v]) => v);
      rootWetness = avgValid(vals, -0.001);
    }
    if (rootWetness == null && monthly?.GWETROOT) {
      const vals = Object.entries(monthly.GWETROOT)
        .filter(([k, v]) => !k.endsWith("13") && typeof v === "number" && Number.isFinite(v) && v >= 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-3)
        .map(([, v]) => v);
      rootWetness = avgValid(vals, -0.001);
    }
    if (rootWetness == null && clim?.GWETROOT) {
      rootWetness = avgValid(mKeys.map((mk) => clim.GWETROOT[mk]), -0.001);
    }

    if (daily?.GWETPROF) {
      const vals = Object.entries(daily.GWETPROF)
        .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v >= 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-14)
        .map(([, v]) => v);
      profWetness = avgValid(vals, -0.001);
    }
    if (profWetness == null && monthly?.GWETPROF) {
      const vals = Object.entries(monthly.GWETPROF)
        .filter(([k, v]) => !k.endsWith("13") && typeof v === "number" && Number.isFinite(v) && v >= 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-3)
        .map(([, v]) => v);
      profWetness = avgValid(vals, -0.001);
    }
    if (profWetness == null && clim?.GWETPROF) {
      profWetness = avgValid(mKeys.map((mk) => clim.GWETPROF[mk]), -0.001);
    }

    if (rootWetness != null) {
      hasLiveNasa = true;
      rootMoisturePct = clamp(Math.round(rootWetness * 62), 12, 56);
    }
    if (profWetness != null) {
      hasLiveNasa = true;
      deepMoisturePct = clamp(Math.round(profWetness * 68), 16, 60);
    }

    let warmingAnomalyC = Number((1.15 + clamp((absLat - 20) / 50, 0.1, 0.7)).toFixed(1));
    if (monthly?.T2M) {
      const annualEntries = Object.entries(monthly.T2M)
        .filter(([k, v]) => k.endsWith("13") && typeof v === "number" && Number.isFinite(v) && v > -900)
        .map(([k, v]) => [Number(k.slice(0, 4)), v])
        .sort(([a], [b]) => a - b);
      const baseCutYear = Math.min(2020, lastCompleteYear - 5);
      const baseTemps = annualEntries.filter(([y]) => y >= 1991 && y <= baseCutYear).map(([, v]) => v);
      const recentTemps = annualEntries.filter(([y]) => y > lastCompleteYear - 5).map(([, v]) => v);
      const baseMean = avgValid(baseTemps, -900);
      const recentMean = avgValid(recentTemps, -900);
      if (baseMean != null && recentMean != null && baseTemps.length >= 5 && recentTemps.length >= 2) {
        warmingAnomalyC = Number((recentMean - baseMean).toFixed(1));
      }
    }

    const aridityRatio = clamp((annualEtDemandMm - annualPrecipMm) / Math.max(annualEtDemandMm, 300), -0.5, 0.9);
    const moistureDeficit = clamp((38 - rootMoisturePct) * 1.15, -18, 30);
    const heatStressPts = clamp(extremeHeatDays * 0.22, 0, 26);
    const droughtRiskScore = clamp(Math.round(36 + aridityRatio * 48 + moistureDeficit + heatStressPts), 14, 96);

    const sourceTag = hasLiveNasa
      ? (monthly && daily ? "NASA POWER Daily+Monthly" : "NASA POWER Live")
      : "NASA POWER + Model";

    let defaultSoilType = absLat > 44 ? "chernozem" : absLat < 24 ? "oxisol" : "silt_loam";
    let defaultSomPct = absLat > 44 ? 3.5 : 2.3;
    let defaultSoilPh = 6.7;

    if (soilGridsData) {
      if (soilGridsData.somPct != null) defaultSomPct = soilGridsData.somPct;
      if (soilGridsData.ph != null) defaultSoilPh = soilGridsData.ph;
      if (soilGridsData.clayPct != null && soilGridsData.sandPct != null) {
        if (soilGridsData.clayPct >= 34 && defaultSomPct >= 3.2) defaultSoilType = "chernozem";
        else if (soilGridsData.clayPct >= 32) defaultSoilType = "calcareous_clay";
        else if (soilGridsData.sandPct >= 54) defaultSoilType = "sandy_clay";
        else defaultSoilType = "silt_loam";
      }
    }

    const climateZone = absLat < 23.5 ? "Tropical / Cerrado" : absLat < 38 ? "Mediterranean / Semi-Arid" : "Temperate Continental";

    return {
      climateZone,
      defaultSoilType,
      defaultSomPct,
      defaultSoilPh,
      sourceTag,
      hasLiveNasa,
      nasaBaseline: {
        rootMoisturePct,
        deepMoisturePct,
        rootAvailableWaterMm: Math.round(rootMoisturePct * 3.1),
        annualPrecipMm,
        annualEtDemandMm,
        seasonalWaterBalanceMm,
        warmingAnomalyC,
        extremeHeatDays,
        droughtRiskScore,
        monthlyPrecipMm,
        monthlyEtMm,
        monthlyTempMaxC
      }
    };
  }

  function buildLiveFieldDiagnosis(field, base, sourceTag) {
    const balSign = base.seasonalWaterBalanceMm >= 0 ? "+" : "";
    const anomSign = base.warmingAnomalyC >= 0 ? "+" : "";
    const prevId = field.defaultPrevCrop || "corn";
    const prevEn = DATA.crops[prevId]?.shortName || prevId;
    const prevUa = DATA.i18n?.crops?.[prevId]?.shortName_ua || prevEn;
    const stratEn = base.seasonalWaterBalanceMm < -120 || base.extremeHeatDays >= 35
      ? "Prioritizing drought-tolerant legumes and deep C4/winter grains restores root-zone stability."
      : "Balancing legume nitrogen fixation with cover mulch protects profile moisture across seasons.";
    const stratUa = base.seasonalWaterBalanceMm < -120 || base.extremeHeatDays >= 35
      ? "Пріоритет посухостійких бобових та озимих/C4-культур відновлює стійкість водного балансу."
      : "Поєднання азотфіксуючих бобових і мульчування стабілізує запаси вологи між сезонами.";

    return {
      humanDiagnosis: `Live NASA POWER (${sourceTag}) reports ${base.rootMoisturePct}% root / ${base.deepMoisturePct}% profile soil wetness following ${prevEn}, with ${balSign}${base.seasonalWaterBalanceMm} mm annual P\u2212ET balance (${anomSign}${base.warmingAnomalyC}\u00B0C warming vs 1991\u20132020, ${base.extremeHeatDays} days \u2265 30\u00B0C). ${stratEn}`,
      humanDiagnosis_ua: `Живі дані NASA POWER (${sourceTag}): вологість коренів ${base.rootMoisturePct}% / глибшого профілю ${base.deepMoisturePct}% після ${prevUa}, річний баланс P\u2212ET ${balSign}${base.seasonalWaterBalanceMm} мм (${anomSign}${base.warmingAnomalyC}\u00B0C до 1991\u20132020 рр., ${base.extremeHeatDays} дн. \u2265 30\u00B0C). ${stratUa}`
    };
  }

  function applyLiveTelemetryToField(field, powerBundle, soilGridsData) {
    if (!field || (!powerBundle && !soilGridsData)) return null;
    const updated = buildDynamicBaseline(field.lat, field.lon, powerBundle, soilGridsData);
    if (powerBundle && updated.hasLiveNasa) {
      field.nasaBaseline = updated.nasaBaseline;
      field.liveTelemetrySynced = true;
      const diag = buildLiveFieldDiagnosis(field, updated.nasaBaseline, updated.sourceTag);
      field.humanDiagnosis = diag.humanDiagnosis;
      field.humanDiagnosis_ua = diag.humanDiagnosis_ua;
    }
    if (!field.isDemo) {
      field.climateZone = updated.climateZone;
      if (!state.overrides && soilGridsData) {
        field.defaultSoilType = updated.defaultSoilType;
        field.defaultSomPct = updated.defaultSomPct;
        field.defaultSoilPh = updated.defaultSoilPh;
      }
    }
    return updated;
  }

  function buildCustomFieldObject(name, lat, lon, polygon, telemetryBundle) {
    const areaHa = computePolygonAreaHa(polygon);
    const dyn = buildDynamicBaseline(lat, lon, telemetryBundle?.power, telemetryBundle?.soilGrids);
    const dryBias = dyn.nasaBaseline.seasonalWaterBalanceMm < -90;
    const prevCropId = dryBias ? "sunflower" : "corn";
    const diag = buildLiveFieldDiagnosis({ defaultPrevCrop: prevCropId }, dyn.nasaBaseline, dyn.sourceTag);
    const seqWater = dryBias
      ? ["winter_barley", "chickpea", "sorghum", "lentil"]
      : ["winter_wheat", "chickpea", "corn", "soybean"];
    const seqSoil = ["alfalfa", "winter_wheat", "field_pea", "winter_barley"];
    const seqProfit = dryBias
      ? ["rapeseed", "winter_wheat", "chickpea", "sorghum"]
      : ["soybean", "winter_wheat", "rapeseed", "corn"];

    return {
      id: `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name,
      region: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
      country: dyn.climateZone,
      iso: "USER",
      isDemo: false,
      lat,
      lon,
      zoom: 14,
      polygon,
      climateZone: dyn.climateZone,
      defaultSoilType: dyn.defaultSoilType,
      defaultSomPct: dyn.defaultSomPct,
      defaultSoilPh: dyn.defaultSoilPh,
      defaultPrevCrop: prevCropId,
      defaultAreaHa: areaHa,
      liveTelemetrySynced: dyn.hasLiveNasa,
      nasaBaseline: dyn.nasaBaseline,
      humanDiagnosis: diag.humanDiagnosis,
      humanDiagnosis_ua: diag.humanDiagnosis_ua,
      traditionalRotation: dryBias
        ? ["sunflower", "winter_wheat", "sunflower", "corn"]
        : ["corn", "corn", "soybean", "corn"],
      presets: {
        water_saver: seqWater,
        soil_builder: seqSoil,
        balanced: seqProfit,
        low_input: ["winter_barley", "field_pea", "millet", "chickpea"]
      },
      selectedPlan: seqWater,
      coverCropId: "rye_vetch",
      useCoverCrop: true,
      useNoTill: true
    };
  }

  function simulateRotation(field, sequence, useCoverCrop, coverCropId, useNoTill) {
    const { soil, somPct, ph, prevCrop } = getEffectiveSoilAndField(field);
    const base = field.nasaBaseline;
    const cover = DATA.coverCropBridges[coverCropId] || DATA.coverCropBridges.rye_vetch;
    const maxHoldingMm = soil.waterHoldingMmPerM + (somPct - 2.0) * 6.5;

    let rootWater = clamp(base.rootAvailableWaterMm, 32, maxHoldingMm * 0.92);
    let nitrogenCarryKg = 14;
    let currentSom = somPct;
    let prev = prevCrop;
    const history = [prevCrop];

    let totalMarginUsdHa = 0;
    let totalStressScore = 0;
    const yearly = [];
    const alerts = [];

    const maxPeakTemp = Math.max(...(base.monthlyTempMaxC || [28]));
    const siteWetness = clamp(base.annualPrecipMm / 560, 0.55, 1.35);

    for (let yr = 0; yr < 4; yr += 1) {
      const cropId = sequence[yr] || "winter_wheat";
      const crop = DATA.crops[cropId] || DATA.crops.winter_wheat;

      const infMmHr = parseFloat(String(soil.infiltrationRate).match(/\d+/)?.[0] || 22);
      const coverWaterGain = useCoverCrop ? (cover.waterRetentionBonusMm || 0) * siteWetness : 0;
      const tillWaterGain = useNoTill ? (14 * infMmHr) / 24 : 0;
      const effectivePrecip = base.annualPrecipMm * (0.64 + (useCoverCrop ? 0.05 : 0) + (useNoTill ? 0.05 : 0));
      const rootReachBonus = (crop.rootDepthCm - 85) * 0.16;

      const availableWater = Math.min(maxHoldingMm, rootWater + effectivePrecip + coverWaterGain + tillWaterGain + rootReachBonus);
      const waterRatio = clamp(availableWater / crop.waterNeedMm, 0.42, 1.18);

      const heatOvershoot = Math.max(0, maxPeakTemp - crop.heatLimitC);
      const heatPenalty = heatOvershoot * 0.032 + (base.extremeHeatDays > 28 && crop.droughtTolerance < 65 ? 0.08 : 0);

      let rotationMod = 1.0;
      const prevCropObj = DATA.crops[prev];
      const isUa = state.lang === "ua";
      const cropName = getCropName(cropId);
      const prevCropName = getCropName(prev);

      if (prev === cropId) {
        rotationMod -= 0.16;
        if (yr < 3) alerts.push({
          level: "bad",
          text: isUa
            ? `${2027 + yr} рік: повторний посів ${cropName} поспіль різко підвищує ризик кореневих гнилей і втрати врожаю.`
            : `Year ${2027 + yr} repeats ${crop.name} back-to-back, sharply raising root disease and yield loss.`
        });
      } else if (SCLEROTINIA_GROUP.has(prev) && SCLEROTINIA_GROUP.has(cropId)) {
        rotationMod -= 0.09;
        alerts.push({
          level: "warn",
          text: isUa
            ? `${2027 + yr}: ${cropName} після ${prevCropName} — спільний ризик білої гнилі (склеротиніозу).`
            : `${2027 + yr}: ${crop.name} follows ${prevCropObj?.name || prev} — shared Sclerotinia pathogen risk.`
        });
      } else if (crop.badPredecessors.includes(prev)) {
        rotationMod -= 0.07;
        alerts.push({
          level: "warn",
          text: isUa
            ? `${2027 + yr}: Небажаний попередник після ${prevCropName}.`
            : `${2027 + yr}: Sub-optimal transition after ${prevCropObj?.name || prev}.`
        });
      } else if (crop.greatPredecessors.includes(prev)) {
        rotationMod += 0.06;
        if (yr === 0) alerts.push({
          level: "good",
          text: isUa
            ? `Вдалий старт: ${cropName} добре поєднується з рештками ${prevCropName}.`
            : `Strong opening: ${crop.name} pairs well after ${prevCropObj?.name || prev} residue.`
        });
      }

      const repeatIdx = history.lastIndexOf(cropId);
      if (repeatIdx !== -1) {
        const gap = history.length - repeatIdx;
        if (gap < crop.minReturnYears) {
          rotationMod -= 0.08;
          alerts.push({
            level: "warn",
            text: isUa
              ? `${2027 + yr}: ${cropName} повертається через ${gap} р. (рекомендований мін. інтервал ${crop.minReturnYears} р.).`
              : `${2027 + yr}: ${crop.name} returns in ${gap} yr (recommended min ${crop.minReturnYears} yr interval).`
          });
        }
      }

      if (crop.nitrogenBalanceKg > 30 && CEREAL_GROUP.has(sequence[yr + 1])) {
        const nextCropShort = getCropShortName(sequence[yr + 1]);
        if (yr < 3) alerts.push({
          level: "good",
          text: isUa
            ? `${2027 + yr} ${cropName} забезпечує біологічний азот (+N) для ${2028 + yr} (${nextCropShort}).`
            : `${2027 + yr} ${crop.name} supplies biological N carryover for ${2028 + yr} ${DATA.crops[sequence[yr + 1]].shortName}.`
        });
      }

      const phPenalty = ph < 5.3 || ph > 8.2 ? 0.05 : 0;
      const somYieldBoost = clamp((currentSom - 2.5) * 0.025, -0.05, 0.08);
      const tolNorm = (crop.droughtTolerance || 60) / 100;
      const droughtShield = waterRatio < 0.88 ? (0.88 - waterRatio) * (1 - tolNorm * 0.72) : 0;

      const yieldFactor = clamp((0.88 * Math.min(1.06, waterRatio) + somYieldBoost - heatPenalty - droughtShield - phPenalty) * rotationMod, 0.35, 1.15);

      const nFromCover = useCoverCrop ? (cover.nBonusKg || 0) : 0;
      const coverCost = useCoverCrop ? (cover.costUsdHa || 0) : 0;
      const fertCreditUsd = Math.min(nitrogenCarryKg + nFromCover, 65) * 0.95;
      const revenueUsdHa = Math.round(crop.baseRevenueUsdHa * yieldFactor);
      const costUsdHa = Math.round(crop.baseCostUsdHa - fertCreditUsd + coverCost - (useNoTill ? 24 : 0));
      const marginUsdHa = revenueUsdHa - costUsdHa;
      totalMarginUsdHa += marginUsdHa;

      const waterRemaining = clamp(availableWater - crop.waterNeedMm * 0.62, 18, maxHoldingMm);
      rootWater = waterRemaining;

      nitrogenCarryKg = clamp(nitrogenCarryKg * 0.35 + crop.nitrogenBalanceKg + nFromCover * 0.5, -10, 95);
      currentSom = clamp(currentSom + crop.somDeltaPct + (useCoverCrop ? (cover.somBonusPct || 0) : 0) + (useNoTill ? 0.04 : -0.02), 0.9, 7.2);

      const yrStress = clamp((waterRemaining / maxHoldingMm) * 55 + (crop.droughtTolerance / 10) * 3.8 - (heatOvershoot * 4), 10, 100);
      totalStressScore += yrStress;

      yearly.push({
        year: 2027 + yr,
        cropId,
        cropName: getCropName(cropId),
        shortName: getCropShortName(cropId),
        yieldFactor: Number(yieldFactor.toFixed(2)),
        waterEndMm: Math.round(waterRemaining),
        marginUsdHa,
        nCarryKg: Math.round(nitrogenCarryKg),
        somPct: Number(currentSom.toFixed(2))
      });

      prev = cropId;
      history.push(cropId);
    }

    const avgWaterEnd = yearly.reduce((s, y) => s + y.waterEndMm, 0) / 4;
    const somDelta = Number((currentSom - somPct).toFixed(2));
    const waterScore = clamp(Math.round((avgWaterEnd / Math.max(85, maxHoldingMm * 0.72)) * 85), 15, 100);
    const soilScore = clamp(Math.round(52 + somDelta * 95), 15, 100);
    const profitScore = clamp(Math.round((totalMarginUsdHa / 2100) * 85), 15, 100);

    const wSum = Math.max(1, state.weights.water + state.weights.soil + state.weights.profit);
    const compositeScore = clamp(
      Math.round(
        (waterScore * state.weights.water + soilScore * state.weights.soil + profitScore * state.weights.profit) / wSum
      ),
      18,
      98
    );

    const uniqueAlerts = [];
    const seenTexts = new Set();
    for (const a of alerts) {
      if (!seenTexts.has(a.text)) {
        seenTexts.add(a.text);
        uniqueAlerts.push(a);
      }
    }
    if (uniqueAlerts.length === 0) {
      uniqueAlerts.push({
        level: "good",
        text: state.lang === "ua"
          ? "Збалансоване 4-річне чергування родин культур без повторного ризику патогенів."
          : "Balanced 4-year crop family diversity with zero consecutive pathogen overlaps."
      });
    }

    return {
      yearly,
      totalMarginUsdHa,
      finalWaterMm: yearly[3].waterEndMm,
      avgWaterMm: Math.round(avgWaterEnd),
      somDelta,
      endSomPct: yearly[3].somPct,
      waterScore,
      soilScore,
      profitScore,
      compositeScore,
      resilienceAvg: Math.round(totalStressScore / 4),
      alerts: uniqueAlerts.slice(0, 5),
      wiltingThresholdMm: Math.round(maxHoldingMm * 0.34)
    };
  }

  function autoOptimizeRotation() {
    const field = getActiveField();
    const candidates = Object.keys(DATA.crops).filter((cid) => {
      const c = DATA.crops[cid];
      if (state.weights.water >= 45 && field.nasaBaseline.seasonalWaterBalanceMm < -120 && c.waterNeedMm > 540) {
        return false;
      }
      return true;
    });
    const pool = candidates.length >= 6 ? candidates : Object.keys(DATA.crops);
    let bestSeq = [...state.planSequence];
    let bestScore = -1;

    const topRated = [...pool]
      .sort((a, b) => {
        const ca = DATA.crops[a];
        const cb = DATA.crops[b];
        const sA = ca.droughtTolerance * state.weights.water + (ca.somDeltaPct * 120 + ca.nitrogenBalanceKg) * (state.weights.soil / 4) + (ca.baseRevenueUsdHa - ca.baseCostUsdHa) * 0.08 * state.weights.profit;
        const sB = cb.droughtTolerance * state.weights.water + (cb.somDeltaPct * 120 + cb.nitrogenBalanceKg) * (state.weights.soil / 4) + (cb.baseRevenueUsdHa - cb.baseCostUsdHa) * 0.08 * state.weights.profit;
        return sB - sA;
      })
      .slice(0, 8);

    for (let a = 0; a < topRated.length; a += 1) {
      for (let b = 0; b < topRated.length; b += 1) {
        if (b === a) continue;
        for (let c = 0; c < topRated.length; c += 1) {
          if (c === b || c === a) continue;
          for (let d = 0; d < topRated.length; d += 1) {
            if (d === c || d === b) continue;
            const seq = [topRated[a], topRated[b], topRated[c], topRated[d]];
            const sim = simulateRotation(field, seq, state.useCoverCrop, state.coverCropId, state.useNoTill);
            if (sim.compositeScore > bestScore) {
              bestScore = sim.compositeScore;
              bestSeq = seq;
            }
          }
        }
      }
    }

    state.planSequence = bestSeq;
    field.selectedPlan = [...bestSeq];
    saveFieldsToStorage();
    renderAll();
    showToast(state.lang === "ua" ? `Оптимізовано 4-річний план (Оцінка ${bestScore}/100)` : `Optimized 4-yr plan (Score ${bestScore}/100)`);
  }

  async function fetchWithTimeout(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  const powerInflight = new Map();

  async function fetchPowerOnly(lat, lon) {
    const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (state.powerCache.has(cacheKey)) {
      return state.powerCache.get(cacheKey);
    }
    if (powerInflight.has(cacheKey)) {
      return powerInflight.get(cacheKey);
    }

    const reqPromise = (async () => {
      const { startYear, lastCompleteYear, dailyStartYmd, dailyEndYmd } = getPowerDateWindow();
      const monthlyUrl = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR,GWETROOT,GWETPROF,ALLSKY_SFC_SW_DWN,RH2M,WS2M&community=AG&longitude=${lon}&latitude=${lat}&start=${startYear}&end=${lastCompleteYear}&format=JSON`;
      const dailyUrl = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MAX,PRECTOTCORR,GWETROOT,GWETPROF&community=AG&longitude=${lon}&latitude=${lat}&start=${dailyStartYmd}&end=${dailyEndYmd}&format=JSON`;

      const [monthlyRes, dailyRes] = await Promise.allSettled([
        fetchWithTimeout(monthlyUrl, 11000),
        fetchWithTimeout(dailyUrl, 11000)
      ]);

      const monthly = monthlyRes.status === "fulfilled" ? monthlyRes.value?.properties?.parameter || null : null;
      const daily = dailyRes.status === "fulfilled" ? dailyRes.value?.properties?.parameter || null : null;

      let climatology = null;
      if (!monthly && !daily) {
        const climUrl = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M_MAX,PRECTOTCORR,GWETROOT,GWETPROF&community=AG&longitude=${lon}&latitude=${lat}&format=JSON`;
        try {
          const climJson = await fetchWithTimeout(climUrl, 9000);
          climatology = climJson?.properties?.parameter || null;
        } catch (_err) {
          climatology = null;
        }
      }

      if (!monthly && !daily && !climatology) return null;
      const bundle = { monthly, daily, climatology };
      state.powerCache.set(cacheKey, bundle);
      return bundle;
    })().finally(() => {
      powerInflight.delete(cacheKey);
    });

    powerInflight.set(cacheKey, reqPromise);
    return reqPromise;
  }

  async function fetchRawBundle(lat, lon) {
    const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (state.nasaCache.has(cacheKey)) {
      return state.nasaCache.get(cacheKey);
    }

    const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,precipitation,soil_temperature_0cm,soil_moisture_0_to_1cm,soil_moisture_9_to_27cm,soil_moisture_27_to_81cm&daily=precipitation_sum,temperature_2m_max,et0_fao_evapotranspiration&forecast_days=7&timezone=auto`;
    const soilUrl = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}&property=clay&property=sand&property=phh2o&property=soc&depth=0-5cm&value=mean`;

    const [meteoRes, powerRes, soilRes] = await Promise.allSettled([
      fetchWithTimeout(meteoUrl, 8000),
      fetchPowerOnly(lat, lon),
      fetchWithTimeout(soilUrl, 12000)
    ]);

    let meteo = null;
    if (meteoRes.status === "fulfilled" && meteoRes.value) {
      meteo = meteoRes.value;
    }

    const power = powerRes.status === "fulfilled" ? powerRes.value || null : null;

    let soilGrids = null;
    if (soilRes.status === "fulfilled" && soilRes.value?.properties?.layers) {
      const parsed = { clayPct: null, sandPct: null, ph: null, somPct: null };
      for (const layer of soilRes.value.properties.layers) {
        const val = layer?.depths?.[0]?.values?.mean;
        if (val == null) continue;
        if (layer.name === "clay") parsed.clayPct = Number((val / 10).toFixed(1));
        if (layer.name === "sand") parsed.sandPct = Number((val / 10).toFixed(1));
        if (layer.name === "phh2o") parsed.ph = Number((val / 10).toFixed(1));
        if (layer.name === "soc") {
          const socPct = val / 100;
          parsed.somPct = Number(clamp(socPct * 1.724 * 0.48, 0.9, 6.2).toFixed(1));
        }
      }
      if (parsed.clayPct !== null || parsed.ph !== null || parsed.somPct !== null) {
        soilGrids = parsed;
      }
    }

    const bundle = { meteo, power, soilGrids, fetchedAt: Date.now() };
    if (meteo || power || soilGrids) {
      state.nasaCache.set(cacheKey, bundle);
    }
    return bundle;
  }

  async function syncActiveFieldTelemetry(forceRefresh) {
    const field = getActiveField();
    if (!field) return;

    const seq = ++state.activeRequestSeq;
    const cacheKey = `${field.lat.toFixed(2)},${field.lon.toFixed(2)}`;
    if (forceRefresh) {
      state.nasaCache.delete(cacheKey);
      state.powerCache.delete(cacheKey);
    }

    state.telemetryLoading = !state.nasaCache.has(cacheKey);
    renderTelemetryStatus();

    const bundle = await fetchRawBundle(field.lat, field.lon);
    if (bundle.power || bundle.soilGrids) {
      applyLiveTelemetryToField(field, bundle.power, bundle.soilGrids);
      if (!field.isDemo) saveFieldsToStorage();
    }
    if (seq !== state.activeRequestSeq) return;

    state.telemetryLoading = false;
    state.liveCurrent = bundle.meteo?.current || null;
    state.liveForecast = bundle.meteo?.daily || null;
    state.liveSoilGrids = bundle.soilGrids || null;
    state.livePowerStats = bundle.power || null;

    renderAll();
    if (!tourActive) renderZonesOverlay();
  }

  async function hydratePortfolioAndZonesTelemetry() {
    const tasks = [
      ...state.fields.map((f) => ({ kind: "field", target: f })),
      ...EXTRA_NASA_ZONES.map((z) => ({ kind: "zone", target: z }))
    ];
    let idx = 0;
    let changedCustom = false;

    const runWorker = async () => {
      while (idx < tasks.length) {
        const item = tasks[idx];
        idx += 1;
        const { kind, target } = item;
        try {
          const powerBundle = await fetchPowerOnly(target.lat, target.lon);
          if (!powerBundle) continue;
          if (kind === "field") {
            const applied = applyLiveTelemetryToField(target, powerBundle, null);
            if (applied?.hasLiveNasa && !target.isDemo) changedCustom = true;
          } else {
            const dyn = buildDynamicBaseline(target.lat, target.lon, powerBundle, null);
            if (dyn.hasLiveNasa) {
              target.moisturePct = dyn.nasaBaseline.rootMoisturePct;
              target.balanceMm = dyn.nasaBaseline.seasonalWaterBalanceMm;
              target.risk = dyn.nasaBaseline.droughtRiskScore >= 68 ? "high" : dyn.nasaBaseline.droughtRiskScore >= 45 ? "mod" : "low";
              target.liveSynced = true;
            }
          }
        } catch (_err) {
          // Keep offline benchmark defaults when a background NASA lookup fails.
        }
      }
    };

    await Promise.all([runWorker(), runWorker()]);
    if (changedCustom) saveFieldsToStorage();
    if (tourActive) return;

    const active = getActiveField();
    if (active && !state.livePowerStats) {
      const activeKey = `${active.lat.toFixed(2)},${active.lon.toFixed(2)}`;
      if (state.powerCache.has(activeKey)) {
        state.livePowerStats = state.powerCache.get(activeKey);
      }
    }
    renderAll();
    renderZonesOverlay();
    if (state.activeView === "portfolio") renderPortfolioModal();
  }

  function renderTelemetryStatus() {
    const badge = $("hudSyncBadge");
    const weatherBadge = $("liveWeatherBadge");
    const stripStatus = $("stripSourcesStatus");
    const isUa = state.lang === "ua";
    if (state.telemetryLoading) {
      badge.textContent = isUa ? "Синхронізація..." : "Syncing...";
      badge.classList.add("is-syncing");
      weatherBadge.textContent = isUa ? "Синхронізація Open-Meteo..." : "Syncing Open-Meteo...";
      stripStatus.textContent = isUa ? "СИНХРОНІЗАЦІЯ NASA POWER + OPEN-METEO ECMWF + SOILGRIDS v2.0..." : "SYNCING NASA POWER + OPEN-METEO ECMWF + SOILGRIDS v2.0...";
      return;
    }
    badge.classList.remove("is-syncing");
    const parts = [];
    if (state.livePowerStats) parts.push("NASA");
    if (state.liveCurrent) parts.push("Meteo");
    if (state.liveSoilGrids) parts.push("SoilGrids");
    badge.textContent = parts.length ? parts.join(" + ") : (isUa ? "Еталон" : "Benchmark");
    weatherBadge.textContent = state.liveForecast ? (isUa ? "Наживо ECMWF 7 днів" : "Live ECMWF 7-Day") : (isUa ? "Автономний прогноз" : "Offline Forecast");

    const stripParts = [];
    if (state.livePowerStats) stripParts.push("NASA POWER (FAO-56)");
    if (state.liveCurrent || state.liveForecast) stripParts.push("OPEN-METEO ECMWF");
    if (state.liveSoilGrids) stripParts.push("SOILGRIDS v2.0");
    stripStatus.textContent = stripParts.length
      ? stripParts.join(" \u00B7 ")
      : (isUa ? "АВТОНОМНИЙ ДОВІДНИК" : "OFFLINE REFERENCE");
  }

  function normalizeLat(lat) {
    const n = Number(lat);
    if (!Number.isFinite(n)) return 0;
    return clamp(n, -90, 90);
  }

  function normalizeLng(lng) {
    const n = Number(lng);
    if (!Number.isFinite(n)) return 0;
    let w = ((((n + 180) % 360) + 360) % 360) - 180;
    if (w === -180 && n > 0) w = 180;
    return Object.is(w, -0) ? 0 : w;
  }

  function updateMicroStripCoords(lat, lon) {
    if (!map) return;
    const raw = lat != null && lon != null ? { lat, lng: lon } : map.getCenter();
    const safeLat = normalizeLat(raw.lat);
    const safeLng = normalizeLng(raw.lng);
    const latNs = safeLat >= 0 ? "N" : "S";
    const lonEw = safeLng >= 0 ? "E" : "W";
    $("hudCoordLat").textContent = `${Math.abs(safeLat).toFixed(4)}\u00B0 ${latNs}`;
    $("hudCoordLon").textContent = `${Math.abs(safeLng).toFixed(4)}\u00B0 ${lonEw}`;
    $("hudMapZoom").textContent = map.getZoom().toFixed(1);
  }

  function initMap() {
    map = L.map("globalMap", {
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: true,
      minZoom: 2
    }).setView([49.38, 31.95], 13);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    layerSat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 18
    });
    layerTer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 18
    });
    layerLabels = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 18,
      opacity: 0.85
    });

    layerSat.addTo(map);
    layerLabels.addTo(map);

    fieldsLayerGroup = L.layerGroup().addTo(map);
    zonesLayerGroup = L.layerGroup().addTo(map);
    drawLayerGroup = L.layerGroup().addTo(map);

    map.on("mousemove", (ev) => {
      updateMicroStripCoords(ev.latlng.lat, ev.latlng.lng);
    });

    map.on("move zoom", () => {
      updateMicroStripCoords();
    });

    map.on("movestart zoomstart dragstart", () => {
      if (pendingMapClickTimer) {
        clearTimeout(pendingMapClickTimer);
        pendingMapClickTimer = null;
      }
      activeProbeSeq += 1;
    });

    map.on("moveend zoomend", () => {
      const center = map.getCenter();
      if (Math.abs(center.lat) > 85.05) {
        map.panTo([clamp(center.lat, -84.5, 84.5), normalizeLng(center.lng)], { animate: false });
      }
      updateMicroStripCoords();
      if (state.showZones) renderZonesOverlay();
    });

    map.on("click", (ev) => {
      const clickLat = normalizeLat(ev.latlng.lat);
      const clickLon = normalizeLng(ev.latlng.lng);
      if (state.isDrawing) {
        state.drawPoints.push([Number(clickLat.toFixed(6)), Number(clickLon.toFixed(6))]);
        renderDrawingOverlay();
        return;
      }
      if (mapClickLocked) return;
      if (pendingMapClickTimer) {
        clearTimeout(pendingMapClickTimer);
        pendingMapClickTimer = null;
      }
      const rawLon = ev.latlng.lng;
      pendingMapClickTimer = setTimeout(() => {
        pendingMapClickTimer = null;
        if (!state.isDrawing && !mapClickLocked) {
          probeMapPoint(clickLat, clickLon, rawLon);
        }
      }, 260);
    });

    map.on("dblclick", (ev) => {
      if (pendingMapClickTimer) {
        clearTimeout(pendingMapClickTimer);
        pendingMapClickTimer = null;
      }
      activeProbeSeq += 1;
      if (!state.isDrawing) return;
      L.DomEvent.stopPropagation(ev);
      if (state.drawPoints.length >= 3) {
        finishDrawingPolygon();
      }
    });

    map.on("zoomend", () => {
      renderFieldPolygons(false);
    });

    updateMicroStripCoords();
    renderZonesOverlay();
  }

  async function probeMapPoint(lat, lon, anchorLon) {
    if (!map) return;
    const cleanLat = Number(normalizeLat(lat).toFixed(4));
    const cleanLon = Number(normalizeLng(lon).toFixed(4));
    const popupLon = anchorLon != null && Number.isFinite(Number(anchorLon)) ? Number(anchorLon) : cleanLon;
    const seq = ++activeProbeSeq;
    const isUa = state.lang === "ua";

    if (!probePopup) {
      probePopup = L.popup({ className: "probe-popup", maxWidth: 260 });
    }
    probePopup
      .setLatLng([cleanLat, popupLon])
      .setContent(
        `<div class="probe-title">${isUa ? "Точковий аналіз телеметрії" : "Point Telemetry Probe"}</div>
         <div class="probe-coords">${cleanLat.toFixed(4)}°, ${cleanLon.toFixed(4)}°</div>
         <div style="color:var(--ink-muted);font-size:11px;">${isUa ? "Запит до NASA POWER, Open-Meteo та SoilGrids..." : "Querying NASA POWER, Open-Meteo &amp; SoilGrids..."}</div>`
      )
      .openOn(map);

    const bundle = await fetchRawBundle(cleanLat, cleanLon);
    if (seq !== activeProbeSeq || state.activeView !== "workspace") return;

    const mmUnit = isUa ? "мм" : "mm";
    const temp = bundle.meteo?.current?.temperature_2m != null ? `${Math.round(bundle.meteo.current.temperature_2m)}°C` : "--";
    const rainSum = Array.isArray(bundle.meteo?.daily?.precipitation_sum)
      ? `${bundle.meteo.daily.precipitation_sum.reduce((a, b) => a + (Number(b) || 0), 0).toFixed(1)} ${mmUnit}`
      : "--";
    const smTopRaw = bundle.meteo?.current?.soil_moisture_0_to_1cm;
    const smTop = smTopRaw != null ? `${Math.round(Number(smTopRaw) * 100)}%` : "--";
    const phVal = bundle.soilGrids?.ph != null ? Number(bundle.soilGrids.ph).toFixed(1) : "--";
    const dynPower = bundle.power ? buildDynamicBaseline(cleanLat, cleanLon, bundle.power, bundle.soilGrids) : null;
    const nasaRootStr = dynPower?.hasLiveNasa ? `${dynPower.nasaBaseline.rootMoisturePct}%` : "--";
    const nasaRainStr = dynPower?.hasLiveNasa ? `${dynPower.nasaBaseline.annualPrecipMm} ${mmUnit}` : "--";

    probePopup.setContent(
      `<div class="probe-title">${isUa ? "Точковий аналіз NASA / ECMWF" : "NASA / ECMWF Point Probe"}</div>
       <div class="probe-coords">${cleanLat.toFixed(4)}°, ${cleanLon.toFixed(4)}°</div>
       <div class="probe-grid">
         <div class="probe-cell"><span>${isUa ? "Темп. зараз" : "Temp Now"}</span><strong>${temp}</strong></div>
         <div class="probe-cell"><span>${isUa ? "Опади 7д" : "7d Precip"}</span><strong>${rainSum}</strong></div>
         <div class="probe-cell"><span>${isUa ? "Волога 0–1 см" : "0–1 cm Moist."}</span><strong>${smTop}</strong></div>
         <div class="probe-cell"><span>${isUa ? "pH SoilGrids" : "SoilGrids pH"}</span><strong>${phVal}</strong></div>
         <div class="probe-cell"><span>${isUa ? "Волога кор. NASA" : "NASA Root Moist."}</span><strong>${nasaRootStr}</strong></div>
         <div class="probe-cell"><span>${isUa ? "Опади / рік NASA" : "NASA Rain / yr"}</span><strong>${nasaRainStr}</strong></div>
       </div>`
    );
  }

  function startDrawingPolygon(redrawId) {
    state.isDrawing = true;
    state.redrawTargetId = redrawId || null;
    state.drawPoints = [];
    map.doubleClickZoom.disable();
    $("globalMap").classList.add("is-drawing");
    $("drawHud").classList.remove("is-hidden");
    $("mapIdleHint").classList.add("is-hidden");
    $("drawHudTitle").textContent = redrawId ? t("drawRedrawPrompt") : t("drawPrompt");
    renderDrawingOverlay();
  }

  function cancelDrawingPolygon() {
    state.isDrawing = false;
    state.redrawTargetId = null;
    state.drawPoints = [];
    map.doubleClickZoom.enable();
    $("globalMap").classList.remove("is-drawing");
    $("drawHud").classList.add("is-hidden");
    $("mapIdleHint").classList.remove("is-hidden");
    drawLayerGroup.clearLayers();
  }

  function renderDrawingOverlay() {
    drawLayerGroup.clearLayers();
    const pts = state.drawPoints;
    const areaHa = pts.length >= 3 ? computePolygonAreaHa(pts) : 0;

    $("drawVertexCount").textContent = String(pts.length);
    $("drawAreaReadout").textContent = `${areaHa.toFixed(1)} ${state.lang === "ua" ? "га" : "ha"}`;
    $("drawFinishBtn").disabled = pts.length < 3;

    if (pts.length >= 3) {
      L.polygon(pts, {
        color: "#07917B",
        weight: 2.5,
        fillColor: "#22C55E",
        fillOpacity: 0.22
      }).addTo(drawLayerGroup);
    } else if (pts.length === 2) {
      L.polyline(pts, { color: "#B9ED6E", weight: 2.5, dashArray: "5, 5" }).addTo(drawLayerGroup);
    }

    for (let i = 0; i < pts.length; i += 1) {
      L.circleMarker(pts[i], {
        radius: 5.5,
        color: "#FFFFFF",
        weight: 2,
        fillColor: i === 0 ? "#F59E0B" : "#07917B",
        fillOpacity: 1
      }).addTo(drawLayerGroup);
    }
  }

  function finishDrawingPolygon() {
    const pts = [...state.drawPoints];
    if (pts.length < 3) return;
    const areaHa = computePolygonAreaHa(pts);
    const [centLat, centLon] = computePolygonCentroid(pts);
    const targetId = state.redrawTargetId;
    cancelDrawingPolygon();

    if (targetId) {
      const target = state.fields.find((f) => f.id === targetId);
      if (target) {
        target.polygon = pts;
        target.lat = centLat;
        target.lon = centLon;
        target.defaultAreaHa = areaHa;
        state.overrides = null;
        saveFieldsToStorage();
        renderAll();
        renderFieldPolygons(true);
        syncActiveFieldTelemetry(true);
        showToast(state.lang === "ua" ? `Оновлено межі (${areaHa.toFixed(1)} га)` : `Updated boundary (${areaHa.toFixed(1)} ha)`);
      }
      return;
    }

    pendingDrawnData = { pts, areaHa, centLat, centLon };
    const count = state.fields.filter((f) => !f.isDemo).length + 1;
    const isUa = state.lang === "ua";
    $("newFieldNameInput").value = isUa ? `Польова ділянка #${count}` : `Field Parcel #${count}`;
    $("newFieldAreaBadge").textContent = isUa
      ? `Геодезична площа полігону: ${areaHa.toFixed(1)} га (${pts.length} точок)`
      : `Geodesic polygon area: ${areaHa.toFixed(1)} ha (${pts.length} vertices)`;
    $("nameFieldModal").classList.remove("is-hidden");
    syncCustomSelects();
    $("newFieldNameInput").focus();
    $("newFieldNameInput").select();
  }

  let pendingDrawnData = null;

  async function confirmSaveNewField() {
    if (!pendingDrawnData) return;
    const { pts, areaHa, centLat, centLon } = pendingDrawnData;
    const customName = $("newFieldNameInput").value.trim() || (state.lang === "ua" ? `Польова ділянка #${state.fields.length + 1}` : `Field Parcel #${state.fields.length + 1}`);
    const prevCrop = $("newFieldPrevCropSelect").value || "corn";
    pendingDrawnData = null;
    $("nameFieldModal").classList.add("is-hidden");

    const newField = buildCustomFieldObject(customName, centLat, centLon, pts, null);
    newField.defaultAreaHa = areaHa;
    newField.defaultPrevCrop = prevCrop;

    state.fields.unshift(newField);
    state.activeFieldId = newField.id;
    state.overrides = null;
    state.planSequence = [...newField.selectedPlan];
    saveFieldsToStorage();
    renderAll();
    renderFieldPolygons(true);
    await syncActiveFieldTelemetry(true);
    showToast(state.lang === "ua" ? `Збережено «${customName}» (${areaHa.toFixed(1)} га)` : `Saved ${customName} (${areaHa.toFixed(1)} ha)`);
  }

  function renderFieldPolygons(fitToActive) {
    if (!fieldsLayerGroup) return;
    fieldsLayerGroup.clearLayers();
    const active = getActiveField();

    const zoom = map ? map.getZoom() : 13;
    const sidebarOpen = !$("appShell").classList.contains("sidebar-collapsed") && window.innerWidth > 1024;

    for (const f of state.fields) {
      if (!Array.isArray(f.polygon) || f.polygon.length < 3) continue;
      const isSelected = active && f.id === active.id;
      const poly = L.polygon(f.polygon, {
        color: isSelected ? "#B9ED6E" : "#38BDF8",
        weight: isSelected ? 2.8 : 1.7,
        dashArray: isSelected ? "6, 4" : null,
        fillColor: isSelected ? "#07917B" : "#60A5FA",
        fillOpacity: isSelected ? 0.24 : 0.1
      });

      poly.on("click", (ev) => {
        if (state.isDrawing) return;
        L.DomEvent.stopPropagation(ev);
        if (pendingMapClickTimer) {
          clearTimeout(pendingMapClickTimer);
          pendingMapClickTimer = null;
        }
        activeProbeSeq += 1;
        mapClickLocked = true;
        setTimeout(() => { mapClickLocked = false; }, 350);
        if (state.activeFieldId !== f.id) {
          selectField(f.id, true);
        }
      });

      poly.on("dblclick", () => {
        if (pendingMapClickTimer) {
          clearTimeout(pendingMapClickTimer);
          pendingMapClickTimer = null;
        }
        activeProbeSeq += 1;
        mapClickLocked = true;
        setTimeout(() => { mapClickLocked = false; }, 350);
      });

      if (zoom >= 9) {
        poly.bindTooltip(`${Number(f.defaultAreaHa).toFixed(1)} ${state.lang === "ua" ? "га" : "ha"}`, {
          permanent: true,
          direction: "center",
          className: "parcel-ha-tag"
        });
      } else {
        poly.bindTooltip(`${getFieldName(f)} (${f.defaultAreaHa} ${state.lang === "ua" ? "га" : "ha"})`, {
          direction: "top",
          offset: [0, -4]
        });
      }

      poly.addTo(fieldsLayerGroup);

      if (isSelected && fitToActive && map) {
        map.fitBounds(poly.getBounds(), {
          paddingTopLeft: [sidebarOpen ? 312 : 40, 56],
          paddingBottomRight: [40, 68],
          maxZoom: 14,
          animate: true,
          duration: 0.55
        });
      }
    }
  }

  function renderZonesOverlay() {
    if (!zonesLayerGroup || !map) return;
    zonesLayerGroup.clearLayers();
    if (!state.showZones) return;

    const zoom = map.getZoom();
    const showPermanent = zoom <= 6;

    const zones = [
      ...state.fields.map((f) => ({
        id: f.id,
        name: getFieldName(f),
        lat: f.lat,
        lon: f.lon,
        moisturePct: f.nasaBaseline.rootMoisturePct,
        balanceMm: f.nasaBaseline.seasonalWaterBalanceMm,
        risk: f.nasaBaseline.droughtRiskScore >= 68 ? "high" : f.nasaBaseline.droughtRiskScore >= 45 ? "mod" : "low"
      })),
      ...EXTRA_NASA_ZONES.map((z) => ({
        ...z,
        name: state.lang === "ua" && z.name_ua ? z.name_ua : z.name,
        id: null
      }))
    ];

    for (const z of zones) {
      const color = z.risk === "high" ? "#EF4444" : z.risk === "mod" ? "#F59E0B" : "#07917B";
      const marker = L.circleMarker([z.lat, z.lon], {
        radius: zoom <= 6 ? 7 : 5,
        color: "#FFFFFF",
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.9
      });

      const sign = z.balanceMm >= 0 ? "+" : "";
      const balLabel = state.lang === "ua" ? "Баланс" : "Bal";
      const waterUnit = state.lang === "ua" ? "мм" : "mm";
      const labelHtml = `<strong>${escapeHtml(z.name)}</strong><br>NASA ${z.moisturePct}% &middot; ${balLabel} ${sign}${z.balanceMm} ${waterUnit}`;

      marker.bindTooltip(showPermanent ? `${z.moisturePct}% NASA` : labelHtml, {
        permanent: showPermanent,
        direction: "right",
        offset: [6, 0]
      });

      marker.on("click", (ev) => {
        if (state.isDrawing) return;
        L.DomEvent.stopPropagation(ev);
        if (pendingMapClickTimer) {
          clearTimeout(pendingMapClickTimer);
          pendingMapClickTimer = null;
        }
        activeProbeSeq += 1;
        mapClickLocked = true;
        setTimeout(() => { mapClickLocked = false; }, 350);
        if (z.id) {
          selectField(z.id, true);
        } else {
          map.setView([z.lat, z.lon], Math.max(map.getZoom(), 9), { animate: true });
          probeMapPoint(z.lat, z.lon);
        }
      });

      marker.addTo(zonesLayerGroup);
    }
  }

  function selectField(fieldId, fitMap) {
    const target = state.fields.find((f) => f.id === fieldId);
    if (!target) return;
    state.activeFieldId = target.id;
    state.overrides = null;
    state.planSequence = target.selectedPlan ? deepClone(target.selectedPlan) : getPresetSequence(target, state.priorityMode);
    state.useCoverCrop = target.useCoverCrop !== false;
    state.coverCropId = target.coverCropId || "rye_vetch";
    state.useNoTill = target.useNoTill !== false;

    renderAll();
    renderFieldPolygons(fitMap);
    syncActiveFieldTelemetry(false);
  }

  function renderSidebarFields() {
    const list = $("fieldList");
    const filterQ = $("locationSearchInput").value.trim().toLowerCase();
    let arr = [...state.fields];

    if (filterQ) {
      arr = arr.filter((f) => {
        const fn = getFieldName(f);
        const fr = getFieldRegion(f);
        const fc = getFieldCountry(f);
        return `${f.name} ${fn} ${f.region} ${fr} ${f.country} ${fc}`.toLowerCase().includes(filterQ);
      });
    }

    if (state.sortBy === "risk") {
      arr.sort((a, b) => b.nasaBaseline.droughtRiskScore - a.nasaBaseline.droughtRiskScore);
    } else if (state.sortBy === "area") {
      arr.sort((a, b) => b.defaultAreaHa - a.defaultAreaHa);
    } else if (state.sortBy === "name") {
      arr.sort((a, b) => getFieldName(a).localeCompare(getFieldName(b)));
    }

    const totalHa = state.fields.reduce((s, f) => s + Number(f.defaultAreaHa || 0), 0);
    const parcelUnit = state.lang === "ua" ? "ділянок" : "parcels";
    $("sidebarTotalHa").textContent = `${totalHa.toFixed(1)} ${state.lang === "ua" ? "га" : "ha"} \u00B7 ${state.fields.length} ${parcelUnit}`;
    $("headerParcelsLabel").textContent = `${t("parcelsHeader")} (${state.fields.length})`;

    if (!arr.length) {
      list.innerHTML = `<div class="panel-card" style="text-align:center;color:var(--ink-muted);">${state.lang === "ua" ? "Немає відповідних ділянок. Оберіть місце вище або клацніть на карту." : "No matching local parcels. Pick a global place above or click the map."}</div>`;
      return;
    }

    list.innerHTML = arr
      .map((f) => {
        const isActive = f.id === state.activeFieldId;
        const score = f.nasaBaseline.droughtRiskScore;
        const riskCls = score >= 68 ? "dot-high" : score >= 45 ? "dot-mod" : "dot-low";
        const prevCropName = getCropShortName(f.defaultPrevCrop);
        const prevLabel = state.lang === "ua" ? "Попер" : "Prev";
        const badge = f.isDemo
          ? `<span class="tag-demo">${state.lang === "ua" ? "Еталон" : "Benchmark"}</span>`
          : `<span class="tag-custom">${state.lang === "ua" ? "Збережено" : "Saved"}</span>`;
        const delBtn = !f.isDemo
          ? `<button type="button" class="field-del-btn" data-del-id="${f.id}" title="${state.lang === "ua" ? "Видалити ділянку" : "Delete parcel"}">\u00D7</button>`
          : "";

        return `<div class="field-card ${isActive ? "is-active" : ""}" data-field-id="${f.id}" role="listitem" tabindex="0">
          <div class="field-thumb">${buildFieldThumbSvg(f.polygon)}</div>
          <div class="field-card-main">
            <div class="field-card-top">
              <span class="field-card-name">${escapeHtml(getFieldName(f))}</span>
              ${badge}
            </div>
            <div class="field-card-sub">${Number(f.defaultAreaHa).toFixed(1)} ${state.lang === "ua" ? "га" : "ha"} &middot; ${prevLabel}: ${escapeHtml(prevCropName)}</div>
          </div>
          <div class="field-card-right">
            <span class="risk-dot-row" title="${state.lang === "ua" ? "Ризик посухи" : "Drought risk"} ${score}/100"><i class="dot-risk ${riskCls}"></i>${score}</span>
            ${delBtn}
          </div>
        </div>`;
      })
      .join("");
  }

  function renderInspectorHeaderAndHud(field, recSim) {
    const eff = getEffectiveSoilAndField(field);
    const riskScore = field.nasaBaseline.droughtRiskScore;
    const riskBadge = $("inspectorRiskBadge");
    riskBadge.className = `risk-pill ${riskScore >= 68 ? "risk-high" : riskScore >= 45 ? "risk-mod" : "risk-low"}`;
    riskBadge.textContent = `${state.lang === "ua" ? "Ризик" : "Risk"} ${riskScore}/100`;

    const soilShort = state.lang === "ua" && DATA.i18n?.soils?.[eff.soil.id]?.shortName_ua
      ? DATA.i18n.soils[eff.soil.id].shortName_ua
      : eff.soil.shortName;

    $("inspectorFieldName").textContent = getFieldName(field);
    const regionStr = getFieldRegion(field);
    const countryStr = getFieldCountry(field);
    const placeStr = regionStr ? `${regionStr}, ${countryStr}` : countryStr;
    const isUa = state.lang === "ua";
    const haUnit = isUa ? "га" : "ha";
    const mmUnit = isUa ? "мм" : "mm";
    const speedUnit = isUa ? "м/с" : "m/s";
    const cmUnit = isUa ? "см" : "cm";

    $("inspectorFieldMeta").textContent = `${Number(eff.areaHa).toFixed(1)} ${haUnit} \u00B7 ${placeStr} \u00B7 ${soilShort}`;

    $("hudFieldTitle").textContent = getFieldName(field);
    if (state.liveCurrent) {
      const t = state.liveCurrent.temperature_2m;
      const rain7d = state.liveForecast?.precipitation_sum
        ? state.liveForecast.precipitation_sum.reduce((a, b) => a + (b || 0), 0)
        : state.liveCurrent.precipitation || 0;
      const windMs = state.liveCurrent.wind_speed_10m != null ? (state.liveCurrent.wind_speed_10m / 3.6).toFixed(1) : "--";
      $("hudTempVal").textContent = `${t >= 0 ? "+" : ""}${Math.round(t)}\u00B0C`;
      $("hudPrecipVal").textContent = `${rain7d.toFixed(1)} ${mmUnit}`;
      $("hudWindVal").textContent = `${windMs} ${speedUnit}`;
    } else {
      $("hudTempVal").textContent = state.telemetryLoading ? "..." : "--\u00B0C";
      $("hudPrecipVal").textContent = state.telemetryLoading ? "..." : `-- ${mmUnit}`;
      $("hudWindVal").textContent = `-- ${speedUnit}`;
    }

    $("hudMoistureVal").textContent = `${field.nasaBaseline.rootMoisturePct}%`;
    const planLabel = isUa ? "План" : "Plan";
    $("hudSoilSummary").textContent = `AWC ${Math.round(eff.soil.waterHoldingMmPerM)} ${mmUnit} \u00B7 ${planLabel} ${recSim.compositeScore}/100`;
    renderTelemetryStatus();
  }

  function renderClimateTab(field) {
    const isUa = state.lang === "ua";
    const mmUnit = isUa ? "мм" : "mm";
    const cmUnit = isUa ? "см" : "cm";
    const b = field.nasaBaseline;
    const eff = getEffectiveSoilAndField(field);

    $("kpiMoistureVal").textContent = state.telemetryLoading && !field.isDemo ? "..." : `${b.rootMoisturePct}%`;
    $("kpiMoistureSub").textContent = isUa
      ? `${b.rootAvailableWaterMm} мм доступно / глиб ${b.deepMoisturePct}%`
      : `${b.rootAvailableWaterMm} mm available / deep ${b.deepMoisturePct}%`;

    const balSign = b.seasonalWaterBalanceMm >= 0 ? "+" : "";
    $("kpiBalanceVal").textContent = state.telemetryLoading && !field.isDemo ? "..." : `${balSign}${b.seasonalWaterBalanceMm} ${mmUnit}`;
    $("kpiBalanceSub").textContent = isUa
      ? `${b.annualPrecipMm} мм опадів vs ${b.annualEtDemandMm} мм ET`
      : `${b.annualPrecipMm} rain vs ${b.annualEtDemandMm} ET`;

    $("kpiAnomalyVal").textContent = `${b.warmingAnomalyC >= 0 ? "+" : ""}${b.warmingAnomalyC}\u00B0C`;
    $("kpiAnomalySub").textContent = isUa
      ? `${b.extremeHeatDays} дн. \u2265 30\u00B0C`
      : `${b.extremeHeatDays} days \u2265 30\u00B0C`;

    const fcStrip = $("liveForecastStrip");
    if (state.liveForecast?.time?.length) {
      fcStrip.innerHTML = state.liveForecast.time
        .slice(0, 7)
        .map((dateStr, i) => {
          const dt = new Date(`${dateStr}T12:00:00`);
          const dow = dt.toLocaleDateString(isUa ? "uk-UA" : "en-US", { weekday: "short" });
          const tmax = Math.round(state.liveForecast.temperature_2m_max[i] ?? 0);
          const pr = Number(state.liveForecast.precipitation_sum[i] ?? 0).toFixed(1);
          return `<div class="fc-day"><span class="fc-dow">${dow}</span><strong class="fc-temp">${tmax}\u00B0</strong><span class="fc-rain">${pr} ${mmUnit}</span></div>`;
        })
        .join("");
    } else {
      fcStrip.innerHTML = Array.from({ length: 7 }, (_, i) => `<div class="fc-day"><span class="fc-dow">D+${i + 1}</span><strong class="fc-temp">--\u00B0</strong><span class="fc-rain">-- ${mmUnit}</span></div>`).join("");
    }

    const sm0 = state.liveCurrent?.soil_moisture_0_to_1cm;
    const sm9 = state.liveCurrent?.soil_moisture_9_to_27cm;
    const sm27 = state.liveCurrent?.soil_moisture_27_to_81cm;
    $("soilDepthStrip").innerHTML = `
      <div class="depth-chip"><span>0\u20131 ${cmUnit}</span><strong>${sm0 != null ? Math.round(sm0 * 100) + "%" : "--"}</strong></div>
      <div class="depth-chip"><span>9\u201327 ${cmUnit}</span><strong>${sm9 != null ? Math.round(sm9 * 100) + "%" : "--"}</strong></div>
      <div class="depth-chip"><span>27\u201381 ${cmUnit}</span><strong>${sm27 != null ? Math.round(sm27 * 100) + "%" : "--"}</strong></div>
    `;

    const sg = state.liveSoilGrids;
    $("soilSourceTag").textContent = sg ? "SoilGrids v2.0 Live" : (state.lang === "ua" ? "Регіональний довідник" : "Regional Reference");
    $("clayStatVal").textContent = `${sg?.clayPct ?? eff.soil.defaultClayPct}%`;
    $("sandStatVal").textContent = `${sg?.sandPct ?? eff.soil.defaultSandPct}%`;
    $("phStatVal").textContent = String(sg?.ph ?? eff.ph);
    $("somStatVal").textContent = `${sg?.somPct ?? eff.somPct}%`;

    $("soilTypeSelect").value = eff.soilTypeId;
    $("prevCropSelect").value = eff.prevCrop;
    $("fieldAreaInput").value = eff.areaHa;
    $("soilPhInput").value = eff.ph;
    $("somSlider").value = eff.somPct;
    $("somReadout").textContent = `${Number(eff.somPct).toFixed(1)}%`;

    $("fieldDiagnosisText").textContent = getFieldDiagnosis(field);
    drawClimateChart(field);
  }

  function renderRotationTab(field, recSim, tradSim) {
    const isUa = state.lang === "ua";
    const scoreWord = isUa ? "Бал плану" : "Plan Score";
    $("rotationScoreBadge").textContent = `${scoreWord} ${recSim.compositeScore}/100`;

    const ganttHead = $("ganttMonthsHead");
    if (ganttHead) {
      const letters = isUa
        ? ["С", "Л", "Б", "К", "Т", "Ч", "Л", "С", "В", "Ж", "Л", "Г"]
        : ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
      ganttHead.innerHTML = letters.map((l) => `<span>${l}</span>`).join("");
    }

    const modeContainer = $("priorityModeGroup");
    modeContainer.innerHTML = Object.values(DATA.priorityModes)
      .map((m) => `<button type="button" class="preset-btn ${state.priorityMode === m.id ? "is-active" : ""}" data-mode="${m.id}">${escapeHtml(getPriorityModeLabel(m.id))}</button>`)
      .join("");

    $("weightWaterSlider").value = state.weights.water;
    $("weightWaterVal").textContent = `${state.weights.water}%`;
    $("weightSoilSlider").value = state.weights.soil;
    $("weightSoilVal").textContent = `${state.weights.soil}%`;
    $("weightProfitSlider").value = state.weights.profit;
    $("weightProfitVal").textContent = `${state.weights.profit}%`;

    $("coverCropToggle").checked = state.useCoverCrop;
    $("coverCropSelect").value = state.coverCropId;
    $("coverCropSelect").disabled = !state.useCoverCrop;
    $("noTillToggle").checked = state.useNoTill;

    const waterDiff = recSim.avgWaterMm - tradSim.avgWaterMm;
    const profitDiff = recSim.totalMarginUsdHa - tradSim.totalMarginUsdHa;
    const vsTrad = isUa ? "проти традиційної" : "vs. traditional";
    const rootMoistAvg = isUa ? "вологи коренів (сер.)" : "root moisture avg";
    const over4yr = isUa ? "за 4 роки" : "over 4 years";
    const waterUnit = isUa ? "мм" : "mm";
    const haUnit = isUa ? "га" : "ha";
    const cmUnit = isUa ? "см" : "cm";
    const kgUnit = isUa ? "кг" : "kg";
    $("rotationDeltaNote").textContent = `${vsTrad} (${tradSim.compositeScore}/100): ${waterDiff >= 0 ? "+" : ""}${waterDiff} ${waterUnit} ${rootMoistAvg} \u00B7 ${formatSignedUsd(profitDiff, "/" + haUnit)} ${over4yr}`;

    const monthsArr = isUa
      ? ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"]
      : MONTHS;
    const coverLeafSvg = "<svg viewBox=\"0 0 16 16\" width=\"11\" height=\"11\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12.8 3.2C8.4 3.2 4.8 6 4.2 10.6c-.1.7.5 1.3 1.2 1.2 4.6-.6 7.4-4.2 7.4-8.6Z\"/><path d=\"M3.2 12.8 8.8 7.2\"/></svg>";

    for (let yr = 0; yr < 4; yr += 1) {
      const sel = $(`year${yr + 1}Select`);
      const cropId = state.planSequence[yr] || "winter_wheat";
      sel.value = cropId;
      const crop = DATA.crops[cropId] || DATA.crops.winter_wheat;
      const simYr = recSim.yearly[yr];
      const cropShort = getCropShortName(cropId);
      const cropWin = getCropWindow(cropId);

      const nVal = crop.nitrogenBalanceKg;
      const nCls = nVal > 0 ? "is-pos" : (nVal < 0 ? "is-warn" : "");
      const mVal = simYr.marginUsdHa;
      const mCls = mVal >= 0 ? "is-pos" : "is-neg";
      $(`ganttMeta${yr + 1}`).innerHTML =
        `<span class="gantt-chip">${crop.rootDepthCm} ${cmUnit}</span>` +
        `<span class="gantt-chip ${nCls}">${nVal >= 0 ? "+" : ""}${nVal} ${kgUnit} N</span>` +
        `<span class="gantt-chip ${mCls}">${formatSignedUsd(mVal, "/" + haUnit)}</span>`;

      const track = $(`ganttTrack${yr + 1}`);
      const grid = `<div class="gantt-grid-lines">${"<span></span>".repeat(12)}</div>`;
      const isCereal = crop.family.includes("Cereal") || crop.categoryBadge.includes("Cereal");
      const isLegume = crop.family.includes("Legume") || crop.categoryBadge.includes("Legume");
      const catCls = isCereal ? "cat-cereal" : isLegume ? "cat-legume" : "cat-oilseed";
      const coverWord = isUa ? "Покрив" : "Cover";

      let barsHtml = "";
      if (!crop.overwinters) {
        const spanMonths = crop.harvestMonth - crop.sowMonth + 1;
        const leftPct = ((crop.sowMonth - 1) / 12) * 100;
        const widthPct = (spanMonths / 12) * 100;
        const winSpan = `${monthsArr[crop.sowMonth - 1]}\u2013${monthsArr[crop.harvestMonth - 1]}`;
        const barLabel = spanMonths >= 4 ? `${escapeHtml(cropShort)} \u00B7 ${winSpan}` : escapeHtml(cropShort);
        barsHtml += `<div class="gantt-bar ${catCls}" style="left:${leftPct.toFixed(2)}%;width:${widthPct.toFixed(2)}%;" title="${escapeHtml(getCropName(cropId))} (${escapeHtml(cropWin)})">${barLabel}</div>`;
        if (state.useCoverCrop && crop.harvestMonth < 12) {
          const covMonths = 12 - crop.harvestMonth;
          const covLeft = (crop.harvestMonth / 12) * 100;
          const covW = (covMonths / 12) * 100;
          const covSpan = `${monthsArr[crop.harvestMonth]}\u2013${monthsArr[11]}`;
          const covTip = `${isUa ? "Покривна культура" : "Winter Cover Crop"} (${covSpan})`;
          const covContent = covMonths >= 4
            ? `${coverLeafSvg}<span>${coverWord} \u00B7 ${covSpan}</span>`
            : covMonths >= 2
              ? `${coverLeafSvg}<span>${coverWord}</span>`
              : coverLeafSvg;
          barsHtml += `<div class="gantt-bar cat-cover${covMonths < 2 ? " is-compact" : ""}" style="left:${covLeft.toFixed(2)}%;width:${covW.toFixed(2)}%;" title="${covTip}">${covContent}</div>`;
        }
      } else {
        const springW = (crop.harvestMonth / 12) * 100;
        const fallMonths = 13 - crop.sowMonth;
        const fallLeft = ((crop.sowMonth - 1) / 12) * 100;
        const fallW = (fallMonths / 12) * 100;
        const harvWord = isUa ? "Збір" : "Harvest";
        const sowWord = isUa ? "Сівба" : "Sow";
        const springSpan = `${monthsArr[0]}\u2013${monthsArr[crop.harvestMonth - 1]}`;
        const fallSpan = `${monthsArr[crop.sowMonth - 1]}\u2013${monthsArr[11]}`;
        const springLabel = crop.harvestMonth >= 5
          ? `${escapeHtml(cropShort)} \u00B7 ${harvWord} (${springSpan})`
          : `${escapeHtml(cropShort)} \u00B7 ${harvWord}`;
        const fallLabel = fallMonths >= 4 ? `${sowWord} \u00B7 ${fallSpan}` : sowWord;

        barsHtml += `<div class="gantt-bar ${catCls}" style="left:0%;width:${springW.toFixed(2)}%;" title="${escapeHtml(getCropName(cropId))} \u00B7 ${harvWord} (${springSpan})">${springLabel}</div>`;
        if (state.useCoverCrop && crop.harvestMonth + 1 < crop.sowMonth) {
          const gapMonths = crop.sowMonth - 1 - crop.harvestMonth;
          const gapLeft = (crop.harvestMonth / 12) * 100;
          const gapW = (gapMonths / 12) * 100;
          const gapSpan = gapMonths === 1 ? monthsArr[crop.harvestMonth] : `${monthsArr[crop.harvestMonth]}\u2013${monthsArr[crop.sowMonth - 2]}`;
          const gapTip = `${isUa ? "Проміжний сидерат" : "Summer Catch Cover"} (${gapSpan})`;
          const gapContent = gapMonths >= 2 ? `${coverLeafSvg}<span>${coverWord}</span>` : coverLeafSvg;
          barsHtml += `<div class="gantt-bar cat-cover${gapMonths < 2 ? " is-compact" : ""}" style="left:${gapLeft.toFixed(2)}%;width:${gapW.toFixed(2)}%;" title="${gapTip}">${gapContent}</div>`;
        }
        barsHtml += `<div class="gantt-bar ${catCls}" style="left:${fallLeft.toFixed(2)}%;width:${fallW.toFixed(2)}%;" title="${sowWord} ${monthsArr[crop.sowMonth - 1]} (${fallSpan})">${fallLabel}</div>`;
      }

      track.innerHTML = grid + barsHtml;
    }

    $("agronomyAlerts").innerHTML = recSim.alerts
      .map((a) => `<div class="alert-row alert-${a.level}">${escapeHtml(a.text)}</div>`)
      .join("");
  }

  function renderImpactTab(field, recSim, tradSim) {
    const { areaHa } = getEffectiveSoilAndField(field);
    const waterDiffMm = recSim.avgWaterMm - tradSim.avgWaterMm;
    const marginDiffHa = recSim.totalMarginUsdHa - tradSim.totalMarginUsdHa;
    const totalParcelUsd = Math.round(marginDiffHa * areaHa);
    const somGainDiff = Number((recSim.somDelta - tradSim.somDelta).toFixed(2));
    const scoreDiff = recSim.compositeScore - tradSim.compositeScore;

    const isUa = state.lang === "ua";
    const waterUnit = isUa ? "мм" : "mm";
    const haUnit = isUa ? "га" : "ha";
    const ptsUnit = isUa ? "бал." : "pts";

    $("impactWaterDelta").textContent = `${waterDiffMm >= 0 ? "+" : ""}${waterDiffMm} ${waterUnit}`;
    $("impactWaterDelta").className = `kpi-val ${waterDiffMm >= 0 ? "kpi-green" : ""}`;
    $("impactWaterSub").textContent = isUa
      ? `${recSim.avgWaterMm} мм проти ${tradSim.avgWaterMm} мм сер.`
      : `${recSim.avgWaterMm} mm vs ${tradSim.avgWaterMm} mm avg`;

    $("impactProfitDelta").textContent = formatSignedUsd(marginDiffHa, "/" + haUnit);
    $("impactProfitDelta").className = `kpi-val ${marginDiffHa >= 0 ? "kpi-green" : ""}`;
    $("impactProfitSub").textContent = `${formatSignedUsd(totalParcelUsd)} (${areaHa.toFixed(1)} ${haUnit})`;

    $("impactSomDelta").textContent = `${somGainDiff >= 0 ? "+" : ""}${somGainDiff}%`;
    $("impactSomSub").textContent = isUa
      ? `Кінц. SOM ${recSim.endSomPct}% проти ${tradSim.endSomPct}%`
      : `End SOM ${recSim.endSomPct}% vs ${tradSim.endSomPct}%`;

    $("impactScoreDelta").textContent = `${scoreDiff >= 0 ? "+" : ""}${scoreDiff} ${ptsUnit}`;
    $("impactScoreSub").textContent = isUa
      ? `${recSim.compositeScore} проти ${tradSim.compositeScore} / 100`
      : `${recSim.compositeScore} vs ${tradSim.compositeScore} / 100`;

    $("comparisonTableBody").innerHTML = recSim.yearly
      .map((ry, i) => {
        const ty = tradSim.yearly[i];
        const mDiff = ry.marginUsdHa - ty.marginUsdHa;
        return `<tr>
          <td class="table-num">${ry.year}</td>
          <td><strong>${escapeHtml(getCropShortName(ry.cropId))}</strong></td>
          <td style="color:var(--ink-muted)">${escapeHtml(getCropShortName(ty.cropId))}</td>
          <td class="table-num">${ry.waterEndMm} ${waterUnit} <span style="color:var(--ink-muted)">(${ty.waterEndMm})</span></td>
          <td class="table-num"><strong>${formatUsd(ry.marginUsdHa)}</strong> <span style="color:${mDiff >= 0 ? "var(--accent)" : "var(--risk-red)"}">(${mDiff >= 0 ? "+" : ""}${mDiff})</span></td>
        </tr>`;
      })
      .join("");

    drawWaterChart(field, recSim, tradSim);
    drawProfitChart(recSim, tradSim);
  }

  function renderReportTab(field, recSim, tradSim) {
    const eff = getEffectiveSoilAndField(field);
    const cover = DATA.coverCropBridges[state.coverCropId];
    const waterDiff = recSim.avgWaterMm - tradSim.avgWaterMm;
    const marginDiffHa = recSim.totalMarginUsdHa - tradSim.totalMarginUsdHa;

    $("reportVerdictTitle").textContent = `${getPriorityModeLabel(state.priorityMode) || "Custom"} — ${getFieldName(field)}`;
    if (state.lang === "ua") {
      $("reportVerdictDesc").textContent = `Призначена 4-річна сівозміна збільшує запас вологи кореневого шару на ${waterDiff >= 0 ? "+" : ""}${waterDiff} мм і забезпечує ${formatSignedUsd(marginDiffHa, "/га")} порівняно з базовою практикою.`;
      $("reportFieldMeta").textContent = `Площа: ${eff.areaHa.toFixed(1)} га \u00B7 Ґрунт: ${getSoilName(eff.soil.id)} (pH ${eff.ph}, SOM ${eff.somPct}%) \u00B7 Попередник: ${getCropShortName(eff.prevCrop)}`;
    } else {
      $("reportVerdictDesc").textContent = `Prescribed 4-year sequence improves root-zone moisture reserve by ${waterDiff >= 0 ? "+" : ""}${waterDiff} mm and delivers ${formatSignedUsd(marginDiffHa, "/ha")} vs regional baseline.`;
      $("reportFieldMeta").textContent = `Parcel Area: ${eff.areaHa.toFixed(1)} ha \u00B7 Soil: ${eff.soil.name} (pH ${eff.ph}, SOM ${eff.somPct}%) \u00B7 Prev Crop: ${DATA.crops[eff.prevCrop]?.shortName}`;
    }

    $("reportScheduleBody").innerHTML = recSim.yearly
      .map((ry) => {
        const coverName = state.useCoverCrop ? getCoverCropName(state.coverCropId) : (state.lang === "ua" ? "Чистий пар" : "Bare fallow");
        return `<tr>
          <td class="table-num">${ry.year}</td>
          <td><strong>${escapeHtml(getCropName(ry.cropId))}</strong><br><span style="font-size:10.5px;color:var(--ink-muted)">${escapeHtml(getCropWindow(ry.cropId))}</span></td>
          <td>${escapeHtml(coverName)}${state.useNoTill ? " + No-Till" : ""}</td>
          <td class="table-num">${formatUsd(ry.marginUsdHa)}</td>
          <td class="table-num">${ry.waterEndMm} ${state.lang === "ua" ? "мм" : "mm"}</td>
        </tr>`;
      })
      .join("");

    const tasks = state.lang === "ua"
      ? [
          `Сівба культури ${getCropName(recSim.yearly[0].cropId)} (${getCropWindow(recSim.yearly[0].cropId)}) одразу після пожнивних решток ${getCropName(eff.prevCrop)}.`,
          state.useCoverCrop
            ? `Висів сидерату ${getCoverCropName(state.coverCropId)} одразу у післяжнивні вікна для збереження ~${cover.waterRetentionBonusMm || 20} мм вологи та накопичення +${cover.nBonusKg || 25} кг/га N.`
            : "Щомісячний моніторинг зимового випаровування вологи за оновленнями NASA POWER (GWETROOT).",
          state.useNoTill
            ? "Збереження стерні та покривного мульчування (No-Till) для охолодження ґрунту та кращої інфільтрації дощу."
            : "Мінімізація глибокої оранки перед посушливими весняними вікнами сівби.",
          "Контроль 7-денної температури ґрунту за Open-Meteo перед внесенням підживлень азотом."
        ]
      : [
          `Establish ${DATA.crops[recSim.yearly[0].cropId].name} (${DATA.crops[recSim.yearly[0].cropId].windowLabel}) directly following ${DATA.crops[eff.prevCrop]?.name || eff.prevCrop} residue.`,
          state.useCoverCrop
            ? `Seed ${cover.name} immediately after harvest gaps to retain ~${cover.waterRetentionBonusMm || 20} mm moisture and supply +${cover.nBonusKg || 25} kg/ha N.`
            : "Monitor winter soil moisture evaporation monthly using NASA POWER (GWETROOT) updates.",
          state.useNoTill
            ? "Maintain zero/strip-till stubble to shield topsoil temperature and boost rainwater infiltration."
            : "Minimize deep inversion passes prior to dry spring planting windows.",
          "Review Open-Meteo 7-day soil temperature before nitrogen side-dress applications."
        ];
    $("reportChecklist").innerHTML = tasks.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  }

  function buildPrintSheet() {
    const field = getActiveField();
    if (!field) return;
    const isUa = state.lang === "ua";
    const eff = getEffectiveSoilAndField(field);
    const recSim = simulateRotation(field, state.planSequence, state.useCoverCrop, state.coverCropId, state.useNoTill);
    const tradSim = simulateRotation(field, field.traditionalRotation, false, state.coverCropId, false);
    const cover = DATA.coverCropBridges[state.coverCropId];
    const totalUsd = Math.round((recSim.totalMarginUsdHa - tradSim.totalMarginUsdHa) * eff.areaHa);

    const fName = getFieldName(field);
    const fRegion = getFieldRegion(field);
    const fCountry = getFieldCountry(field);
    const soilName = getSoilName(eff.soil.id);

    const titleStr = isUa ? "Field Shift — 4-річний агротехнічний план" : "Field Shift — 4-Year Agronomic Prescription";
    const genStr = isUa ? `Створено ${new Date().toISOString().slice(0, 10)}` : `Generated ${new Date().toISOString().slice(0, 10)}`;
    const authStr = isUa ? "Верифіковано NASA POWER & Open-Meteo" : "NASA POWER & Open-Meteo Verified";
    const lblArea = isUa ? "Площа ділянки" : "Parcel Area";
    const lblSoil = isUa ? "Ґрунтовий профіль" : "Soil Profile";
    const lblWater = isUa ? "Сер. приріст вологи" : "Avg Water Gain";
    const lblProfit = isUa ? "Прибуток поля за 4 роки \u0394" : "4-Yr Parcel Profit \u0394";
    const schedTitle = isUa ? "Призначений графік сівозміни (2027\u20132030)" : "Prescribed Rotation Schedule (2027\u20132030)";
    const diagTitle = isUa ? "Агрономічна діагностика та контроль ризиків" : "Agronomic Diagnostics & Risk Controls";

    $("printSheet").innerHTML = `
      <div class="ps-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="logo.svg" alt="Field Shift logo" style="width:28px;height:28px;border-radius:6px;flex-shrink:0;">
          <div>
            <h1 class="ps-title">${titleStr}</h1>
            <p class="ps-sub">${escapeHtml(fName)} (${escapeHtml(fRegion)}, ${escapeHtml(fCountry)}) &middot; ${field.lat.toFixed(4)}, ${field.lon.toFixed(4)}</p>
          </div>
        </div>
        <div style="text-align:right;font-size:10.5px;">
          <strong>${genStr}</strong><br>
          ${authStr}
        </div>
      </div>

      <div class="ps-grid-4">
        <div class="ps-box"><span>${lblArea}</span><strong>${eff.areaHa.toFixed(1)} ${isUa ? "га" : "ha"}</strong></div>
        <div class="ps-box"><span>${lblSoil}</span><strong>${escapeHtml(soilName)} (SOM ${eff.somPct}%)</strong></div>
        <div class="ps-box"><span>${lblWater}</span><strong>${recSim.avgWaterMm - tradSim.avgWaterMm >= 0 ? "+" : ""}${recSim.avgWaterMm - tradSim.avgWaterMm} ${isUa ? "мм" : "mm"}</strong></div>
        <div class="ps-box"><span>${lblProfit}</span><strong>${totalUsd >= 0 ? "+" : ""}$${totalUsd.toLocaleString()}</strong></div>
      </div>

      <div class="ps-section-title">${schedTitle}</div>
      <table class="ps-table">
        <thead>
          <tr>
            <th>${isUa ? "Сезон" : "Season"}</th>
            <th>${isUa ? "Основна культура" : "Primary Crop"}</th>
            <th>${isUa ? "Сівба та збирання" : "Sowing & Harvest"}</th>
            <th>${isUa ? "Корінь" : "Root Depth"}</th>
            <th>${isUa ? "Покрив та обробіток" : "Cover & Practice"}</th>
            <th>${isUa ? "Кінцева волога" : "Water End"}</th>
            <th>${isUa ? "Маржа / га" : "Net Margin / ha"}</th>
          </tr>
        </thead>
        <tbody>
          ${recSim.yearly
            .map((ry, idx) => {
              const c = DATA.crops[ry.cropId];
              const ty = tradSim.yearly[idx];
              const cName = getCropName(ry.cropId);
              const cFam = getCropFamily(ry.cropId);
              const cWin = getCropWindow(ry.cropId);
              const coverTitle = state.useCoverCrop ? getCoverCropName(state.coverCropId) : (isUa ? "Без покриву" : "None");
              return `<tr>
                <td>${ry.year}</td>
                <td><strong>${escapeHtml(cName)}</strong> (${escapeHtml(cFam)})</td>
                <td>${escapeHtml(cWin)}</td>
                <td>${c.rootDepthCm} ${isUa ? "см" : "cm"}</td>
                <td>${escapeHtml(coverTitle)}${state.useNoTill ? " / No-Till" : ""}</td>
                <td>${ry.waterEndMm} ${isUa ? "мм" : "mm"} (${isUa ? "проти" : "vs"} ${ty.waterEndMm})</td>
                <td>${formatUsd(ry.marginUsdHa)} (${isUa ? "проти" : "vs"} ${formatUsd(ty.marginUsdHa)})</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>

      <div class="ps-section-title">${diagTitle}</div>
      <ul style="margin:4px 0 10px;padding-left:16px;">
        ${recSim.alerts.map((a) => `<li>${escapeHtml(a.text)}</li>`).join("")}
      </ul>

      <div class="ps-footer">
        ${isUa
          ? "Система підтримки агрономічних рішень Field Shift GIS \u00B7 Розрахунки на базі рядів NASA POWER (GWETROOT/GEOS), FAO-56 ET, Open-Meteo ECMWF та ISRIC SoilGrids v2.0."
          : "Field Shift Agronomic GIS Decision Support \u00B7 Powered by NASA POWER (GWETROOT/GEOS) series, FAO-56 ET, Open-Meteo ECMWF & ISRIC SoilGrids v2.0."}
      </div>
    `;
  }

  function buildPortfolioPrintSheet() {
    const isUa = state.lang === "ua";
    const haUnit = isUa ? "га" : "ha";
    const mmUnit = isUa ? "мм" : "mm";
    let totalHa = 0;
    let totalMarginDeltaUsd = 0;
    let totalWaterGainWeighted = 0;

    const rowsHtml = state.fields
      .map((f) => {
        const plan = f.selectedPlan || getPresetSequence(f, state.priorityMode);
        const sim = simulateRotation(
          f,
          plan,
          f.useCoverCrop !== false,
          f.coverCropId || "rye_vetch",
          f.useNoTill !== false
        );
        const trad = simulateRotation(f, f.traditionalRotation, false, "rye_vetch", false);
        const area = Number(f.defaultAreaHa || 40);
        const wDiff = sim.avgWaterMm - trad.avgWaterMm;
        const pDiffTotal = Math.round((sim.totalMarginUsdHa - trad.totalMarginUsdHa) * area);
        totalHa += area;
        totalMarginDeltaUsd += pDiffTotal;
        totalWaterGainWeighted += wDiff * area;

        const fName = getFieldName(f);
        const fRegion = getFieldRegion(f);
        const fCountry = getFieldCountry(f);
        const locLabel = fRegion ? `${fRegion}, ${fCountry}` : fCountry;
        const seqNames = plan.map((id) => getCropShortName(id)).join(" \u2192 ");
        return `<tr>
          <td><strong>${escapeHtml(fName)}</strong></td>
          <td>${escapeHtml(locLabel)}</td>
          <td>${area.toFixed(1)} ${haUnit}</td>
          <td>${f.nasaBaseline.rootMoisturePct}%</td>
          <td>${escapeHtml(seqNames)}</td>
          <td>${wDiff >= 0 ? "+" : ""}${wDiff} ${mmUnit}</td>
          <td><strong>${pDiffTotal >= 0 ? "+" : ""}$${pDiffTotal.toLocaleString()}</strong></td>
        </tr>`;
      })
      .join("");

    const avgWaterGain = totalHa > 0 ? Math.round(totalWaterGainWeighted / totalHa) : 0;
    const titleStr = isUa ? "Field Shift \u2014 Зведений звіт портфеля ферми" : "Field Shift \u2014 Farm Portfolio A4 Summary";
    const subStr = isUa
      ? `Охоплено ділянок: ${state.fields.length} \u00B7 Пріоритет: ${getPriorityModeLabel(state.priorityMode)}`
      : `Parcels included: ${state.fields.length} \u00B7 Strategy: ${getPriorityModeLabel(state.priorityMode)}`;
    const genStr = isUa ? `Створено ${new Date().toISOString().slice(0, 10)}` : `Generated ${new Date().toISOString().slice(0, 10)}`;
    const authStr = isUa ? "Верифіковано NASA POWER & Open-Meteo" : "NASA POWER & Open-Meteo Verified";

    $("printSheet").innerHTML = `
      <div class="ps-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="logo.svg" alt="Field Shift logo" style="width:28px;height:28px;border-radius:6px;flex-shrink:0;">
          <div>
            <h1 class="ps-title">${titleStr}</h1>
            <p class="ps-sub">${escapeHtml(subStr)}</p>
          </div>
        </div>
        <div style="text-align:right;font-size:10.5px;">
          <strong>${genStr}</strong><br>
          ${authStr}
        </div>
      </div>

      <div class="ps-grid-4">
        <div class="ps-box"><span>${isUa ? "Загальна площа" : "Total Farm Area"}</span><strong>${totalHa.toFixed(1)} ${haUnit}</strong></div>
        <div class="ps-box"><span>${isUa ? "Кількість полів" : "Tracked Parcels"}</span><strong>${state.fields.length}</strong></div>
        <div class="ps-box"><span>${isUa ? "Сер. приріст вологи" : "Weighted Water Gain"}</span><strong>${avgWaterGain >= 0 ? "+" : ""}${avgWaterGain} ${mmUnit}</strong></div>
        <div class="ps-box"><span>${isUa ? "Економія / прибуток \u0394" : "4-Yr Farm Profit \u0394"}</span><strong>${totalMarginDeltaUsd >= 0 ? "+" : ""}$${totalMarginDeltaUsd.toLocaleString()}</strong></div>
      </div>

      <div class="ps-section-title">${isUa ? "Порівняння ділянок портфеля (2027\u20132030)" : "Multi-Parcel Rotation Summary (2027\u20132030)"}</div>
      <table class="ps-table">
        <thead>
          <tr>
            <th>${isUa ? "Ділянка" : "Parcel"}</th>
            <th>${isUa ? "Регіон" : "Region"}</th>
            <th>${isUa ? "Площа" : "Area"}</th>
            <th>${isUa ? "Волога NASA" : "NASA Moist."}</th>
            <th>${isUa ? "4-річний план" : "4-Yr Plan"}</th>
            <th>${isUa ? "Волога \u0394" : "Water \u0394"}</th>
            <th>${isUa ? "Прибуток \u0394" : "4-Yr Profit \u0394"}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div class="ps-footer">
        ${isUa
          ? "Зведений звіт портфеля Field Shift GIS \u00B7 Часові ряди NASA POWER (GWETROOT), FAO-56 ET, прогноз Open-Meteo та SoilGrids v2.0."
          : "Field Shift Portfolio Summary \u00B7 Powered by NASA POWER (GWETROOT) time series, FAO-56 ET, Open-Meteo ECMWF & ISRIC SoilGrids v2.0."}
      </div>
    `;
  }

  function setupHiDPICanvas(canvas) {
    const rect = (canvas.parentElement || canvas).getBoundingClientRect();
    const cssW = Math.max(220, Math.floor(rect.width || 440));
    const cssH = Number(canvas.dataset.cssH) || 185;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: cssW, h: cssH };
  }

  function attachChartHover(canvas, tooltipEl, formatter) {
    if (canvas._hoverBound) return;
    canvas._hoverBound = true;

    canvas.addEventListener("mousemove", (ev) => {
      const meta = canvas._chartMeta;
      if (!meta || !meta.items || !meta.items.length) return;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;

      let closest = null;
      let bestDist = Infinity;
      for (const item of meta.items) {
        const dist = Math.abs(x - item.x);
        if (dist < bestDist) {
          bestDist = dist;
          closest = item;
        }
      }
      if (!closest || bestDist > 42) {
        tooltipEl.classList.add("is-hidden");
        return;
      }
      tooltipEl.innerHTML = formatter(closest);
      tooltipEl.classList.remove("is-hidden");
      const tipX = clamp(closest.x - 45, 6, rect.width - 135);
      tooltipEl.style.left = `${tipX}px`;
      tooltipEl.style.top = "8px";
    });

    canvas.addEventListener("mouseleave", () => {
      tooltipEl.classList.add("is-hidden");
    });
  }

  function drawClimateChart(field) {
    const canvas = $("climateChart");
    if (!canvas || $("panelClimate").offsetParent === null) return;
    const { ctx, w, h } = setupHiDPICanvas(canvas);
    const pad = { top: 18, right: 12, bottom: 26, left: 36 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;

    const rain = field.nasaBaseline.monthlyPrecipMm;
    const et = field.nasaBaseline.monthlyEtMm;
    const maxVal = Math.max(100, ...rain, ...et) * 1.12;

    const isDark = state.theme === "dark";
    const gridColor = isDark ? "rgba(148, 184, 224, 0.16)" : "#DCE9F6";
    const labelColor = isDark ? "#94B0D0" : "#587294";

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = labelColor;

    for (let g = 0; g <= 3; g += 1) {
      const yVal = Math.round((maxVal * g) / 3);
      const y = pad.top + ch - (g / 3) * ch;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillText(String(yVal), 4, y + 3);
    }

    const colW = cw / 12;
    const barW = Math.max(8, colW * 0.56);
    const hoverItems = [];
    const etPoints = [];

    for (let i = 0; i < 12; i += 1) {
      const cx = pad.left + i * colW + colW * 0.5;
      const barH = (rain[i] / maxVal) * ch;
      ctx.fillStyle = isDark ? "rgba(56, 189, 248, 0.78)" : "rgba(2, 132, 199, 0.78)";
      ctx.beginPath();
      ctx.roundRect(cx - barW / 2, pad.top + ch - barH, barW, barH, [3, 3, 0, 0]);
      ctx.fill();

      const etY = pad.top + ch - (et[i] / maxVal) * ch;
      etPoints.push({ x: cx, y: etY });

      ctx.fillStyle = labelColor;
      ctx.textAlign = "center";
      const monthInitial = state.lang === "ua"
        ? ["С", "Л", "Б", "К", "Т", "Ч", "Л", "С", "В", "Ж", "Л", "Г"][i]
        : MONTHS[i].slice(0, 1);
      ctx.fillText(monthInitial, cx, h - 8);

      const monthLabel = state.lang === "ua"
        ? ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"][i]
        : MONTHS[i];
      hoverItems.push({ x: cx, label: monthLabel, rain: rain[i], et: et[i] });
    }
    ctx.textAlign = "left";

    ctx.strokeStyle = isDark ? "#FB923C" : "#EA580C";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    etPoints.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    for (const p of etPoints) {
      ctx.fillStyle = isDark ? "#0F172A" : "#FFFFFF";
      ctx.strokeStyle = isDark ? "#FB923C" : "#EA580C";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    canvas._chartMeta = { items: hoverItems };
    attachChartHover(canvas, $("climateTooltip"), (it) => state.lang === "ua"
      ? `<strong>${it.label}</strong><br>Опади: ${it.rain} мм &middot; ET: ${it.et} мм`
      : `<strong>${it.label}</strong><br>Rain: ${it.rain} mm &middot; ET: ${it.et} mm`);
  }

  function drawWaterChart(field, recSim, tradSim) {
    const canvas = $("waterChart");
    if (!canvas || $("panelImpact").offsetParent === null) return;
    const { ctx, w, h } = setupHiDPICanvas(canvas);
    const pad = { top: 18, right: 14, bottom: 26, left: 38 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;

    const allVals = [
      field.nasaBaseline.rootAvailableWaterMm,
      ...recSim.yearly.map((y) => y.waterEndMm),
      ...tradSim.yearly.map((y) => y.waterEndMm)
    ];
    const maxVal = Math.max(120, ...allVals) * 1.12;
    const startLabel = state.lang === "ua" ? "Старт" : "Start";
    const labels = [startLabel, "2027", "2028", "2029", "2030"];
    const recSeries = [field.nasaBaseline.rootAvailableWaterMm, ...recSim.yearly.map((y) => y.waterEndMm)];
    const tradSeries = [field.nasaBaseline.rootAvailableWaterMm, ...tradSim.yearly.map((y) => y.waterEndMm)];

    const isDark = state.theme === "dark";
    const gridColor = isDark ? "rgba(148, 184, 224, 0.16)" : "#DCE9F6";
    const labelColor = isDark ? "#94B0D0" : "#587294";
    const recColor = isDark ? "#10B981" : "#07917B";
    const tradColor = isDark ? "#64748B" : "#94A3B8";
    const stressColor = isDark ? "#F87171" : "#DC2626";

    ctx.clearRect(0, 0, w, h);
    ctx.font = "10px Inter, sans-serif";
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;

    for (let g = 0; g <= 3; g += 1) {
      const y = pad.top + ch - (g / 3) * ch;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = labelColor;
      ctx.fillText(String(Math.round((maxVal * g) / 3)), 4, y + 3);
    }

    const stressY = pad.top + ch - (recSim.wiltingThresholdMm / maxVal) * ch;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = stressColor;
    ctx.beginPath();
    ctx.moveTo(pad.left, stressY);
    ctx.lineTo(w - pad.right, stressY);
    ctx.stroke();
    ctx.fillStyle = stressColor;
    ctx.fillText(state.lang === "ua" ? "Критичний поріг" : "Stress floor", pad.left + 4, stressY - 4);
    ctx.restore();

    const stepX = cw / (labels.length - 1);
    const drawLine = (arr, stroke, width) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.beginPath();
      arr.forEach((v, idx) => {
        const px = pad.left + idx * stepX;
        const py = pad.top + ch - (v / maxVal) * ch;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    };

    drawLine(tradSeries, tradColor, 2);
    drawLine(recSeries, recColor, 2.8);

    const hoverItems = [];
    labels.forEach((lbl, idx) => {
      const px = pad.left + idx * stepX;
      ctx.fillStyle = labelColor;
      ctx.textAlign = "center";
      ctx.fillText(lbl, px, h - 8);

      [
        { val: tradSeries[idx], c: tradColor },
        { val: recSeries[idx], c: recColor }
      ].forEach((pt) => {
        const py = pad.top + ch - (pt.val / maxVal) * ch;
        ctx.fillStyle = pt.c;
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });

      hoverItems.push({ x: px, label: lbl, rec: recSeries[idx], trad: tradSeries[idx] });
    });
    ctx.textAlign = "left";

    canvas._chartMeta = { items: hoverItems };
    attachChartHover(canvas, $("waterTooltip"), (it) => state.lang === "ua"
      ? `<strong>${it.label}</strong><br>Field Shift: ${it.rec} мм &middot; Традиційна: ${it.trad} мм`
      : `<strong>${it.label}</strong><br>Field Shift: ${it.rec} mm &middot; Trad: ${it.trad} mm`);
  }

  function drawProfitChart(recSim, tradSim) {
    const canvas = $("profitChart");
    if (!canvas || $("panelImpact").offsetParent === null) return;
    const { ctx, w, h } = setupHiDPICanvas(canvas);
    const pad = { top: 18, right: 14, bottom: 26, left: 42 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;

    const recCum = [];
    const tradCum = [];
    let rAcc = 0;
    let tAcc = 0;
    for (let i = 0; i < 4; i += 1) {
      rAcc += recSim.yearly[i].marginUsdHa;
      tAcc += tradSim.yearly[i].marginUsdHa;
      recCum.push(rAcc);
      tradCum.push(tAcc);
    }

    const isDark = state.theme === "dark";
    const gridColor = isDark ? "rgba(148, 184, 224, 0.16)" : "#DCE9F6";
    const labelColor = isDark ? "#94B0D0" : "#587294";
    const maxVal = Math.max(400, ...recCum, ...tradCum) * 1.15;
    ctx.clearRect(0, 0, w, h);
    ctx.font = "10px Inter, sans-serif";
    ctx.strokeStyle = gridColor;

    for (let g = 0; g <= 3; g += 1) {
      const y = pad.top + ch - (g / 3) * ch;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = labelColor;
      ctx.fillText(`$${Math.round((maxVal * g) / 3)}`, 2, y + 3);
    }

    const colW = cw / 4;
    const barW = Math.min(26, colW * 0.3);
    const hoverItems = [];

    for (let i = 0; i < 4; i += 1) {
      const cx = pad.left + i * colW + colW * 0.5;
      const rH = Math.max(2, (recCum[i] / maxVal) * ch);
      const tH = Math.max(2, (tradCum[i] / maxVal) * ch);

      ctx.fillStyle = isDark ? "#10B981" : "#07917B";
      ctx.beginPath();
      ctx.roundRect(cx - barW - 2, pad.top + ch - rH, barW, rH, [3, 3, 0, 0]);
      ctx.fill();

      ctx.fillStyle = isDark ? "#475569" : "#B9D4EA";
      ctx.beginPath();
      ctx.roundRect(cx + 2, pad.top + ch - tH, barW, tH, [3, 3, 0, 0]);
      ctx.fill();

      ctx.fillStyle = labelColor;
      ctx.textAlign = "center";
      ctx.fillText(String(2027 + i), cx, h - 8);

      hoverItems.push({ x: cx, year: 2027 + i, rec: recCum[i], trad: tradCum[i] });
    }
    ctx.textAlign = "left";

    canvas._chartMeta = { items: hoverItems };
    attachChartHover(canvas, $("profitTooltip"), (it) => state.lang === "ua"
      ? `<strong>${it.year} Кумул.</strong><br>Field Shift: ${formatUsd(it.rec)}/га &middot; Традиційна: ${formatUsd(it.trad)}/га`
      : `<strong>${it.year} Cumul.</strong><br>Field Shift: ${formatUsd(it.rec)}/ha &middot; Trad: ${formatUsd(it.trad)}/ha`);
  }

  function renderPortfolioModal() {
    let totalHa = 0;
    let totalMarginDeltaUsd = 0;
    let totalWaterGainWeighted = 0;

    const rowsHtml = state.fields
      .map((f) => {
        const plan = f.selectedPlan || getPresetSequence(f, state.priorityMode);
        const sim = simulateRotation(
          f,
          plan,
          f.useCoverCrop !== false,
          f.coverCropId || "rye_vetch",
          f.useNoTill !== false
        );
        const trad = simulateRotation(f, f.traditionalRotation, false, "rye_vetch", false);
        const area = Number(f.defaultAreaHa || 40);
        const wDiff = sim.avgWaterMm - trad.avgWaterMm;
        const pDiffTotal = Math.round((sim.totalMarginUsdHa - trad.totalMarginUsdHa) * area);
        totalHa += area;
        totalMarginDeltaUsd += pDiffTotal;
        totalWaterGainWeighted += wDiff * area;

        const fName = getFieldName(f);
        const fRegion = getFieldRegion(f);
        const fCountry = getFieldCountry(f);
        const locLabel = fRegion ? `${fRegion}, ${fCountry}` : fCountry;
        const seqNames = plan.map((id) => getCropShortName(id)).join(" \u2192 ");
        return `<tr class="clickable-row" data-jump-field="${f.id}">
          <td><strong>${escapeHtml(fName)}</strong></td>
          <td>${escapeHtml(locLabel)}</td>
          <td class="table-num">${area.toFixed(1)}</td>
          <td class="table-num">${f.nasaBaseline.rootMoisturePct}%</td>
          <td style="font-size:11px;">${escapeHtml(seqNames)}</td>
          <td class="table-num" style="color:${wDiff >= 0 ? "var(--accent)" : "var(--risk-red)"}">${wDiff >= 0 ? "+" : ""}${wDiff} ${state.lang === "ua" ? "мм" : "mm"}</td>
          <td class="table-num" style="color:${pDiffTotal >= 0 ? "var(--accent)" : "var(--risk-red)"}"><strong>${pDiffTotal >= 0 ? "+" : ""}$${pDiffTotal.toLocaleString()}</strong></td>
        </tr>`;
      })
      .join("");

    const avgWaterGain = totalHa ? Math.round(totalWaterGainWeighted / totalHa) : 0;
    const parcelUnit = state.lang === "ua" ? "ділянок" : "parcels";
    const lblManaged = state.lang === "ua" ? "Площа господарства" : "Managed Area";
    const lblWaterGain = state.lang === "ua" ? "Середній приріст вологи" : "Weighted Water Gain";
    const lblReserveDelta = state.lang === "ua" ? "Приріст запасу коренів" : "Root reserve delta";
    const lblProfitDelta = state.lang === "ua" ? "Прибуток портфоліо за 4 роки" : "4-Yr Portfolio Profit \u0394";
    const lblAcross = state.lang === "ua" ? "За всіма ділянками" : "Across all parcels";
    const lblSeason = state.lang === "ua" ? "Активний цикл" : "Active Season";
    const lblClickInspect = state.lang === "ua" ? "Клацніть рядок для аналізу" : "Click any row to inspect";

    $("portfolioSummaryStrip").innerHTML = `
      <div class="kpi-cell"><span class="kpi-label">${lblManaged}</span><strong class="kpi-val">${totalHa.toFixed(1)} ${state.lang === "ua" ? "га" : "ha"}</strong><span class="kpi-sub">${state.fields.length} ${parcelUnit}</span></div>
      <div class="kpi-cell"><span class="kpi-label">${lblWaterGain}</span><strong class="kpi-val kpi-green">${avgWaterGain >= 0 ? "+" : ""}${avgWaterGain} ${state.lang === "ua" ? "мм" : "mm"}</strong><span class="kpi-sub">${lblReserveDelta}</span></div>
      <div class="kpi-cell"><span class="kpi-label">${lblProfitDelta}</span><strong class="kpi-val kpi-green">${totalMarginDeltaUsd >= 0 ? "+" : ""}$${totalMarginDeltaUsd.toLocaleString()}</strong><span class="kpi-sub">${lblAcross}</span></div>
      <div class="kpi-cell"><span class="kpi-label">${lblSeason}</span><strong class="kpi-val">2027\u20132030</strong><span class="kpi-sub">${lblClickInspect}</span></div>
    `;
    $("portfolioTableBody").innerHTML = rowsHtml;
  }

  function renderCropLibraryModal() {
    const isUa = state.lang === "ua";
    const q = $("cropSearchInput").value.trim().toLowerCase();
    const filter = $("cropSeasonFilter").value;
    const rows = Object.values(DATA.crops).filter((c) => {
      const cropUa = DATA.i18n?.crops?.[c.id]?.name_ua || "";
      if (q && !`${c.name} ${cropUa} ${c.family} ${c.summary}`.toLowerCase().includes(q)) return false;
      if (filter === "high" && c.droughtTolerance < 70) return false;
      if (filter === "winter" && !c.overwinters) return false;
      if (filter === "legume" && c.nitrogenBalanceKg <= 20) return false;
      return true;
    });

    $("cropMatrixTableBody").innerHTML = rows
      .map((c) => {
        const margin = c.baseRevenueUsdHa - c.baseCostUsdHa;
        const fam = getCropFamily(c.id);
        const win = getCropWindow(c.id);
        return `<tr>
          <td><strong>${escapeHtml(getCropName(c.id))}</strong><br><span style="font-size:10.5px;color:var(--ink-muted)">${escapeHtml(fam)}</span></td>
          <td style="font-size:11px;">${escapeHtml(win)}</td>
          <td class="table-num">${c.waterNeedMm} ${isUa ? "мм" : "mm"}</td>
          <td class="table-num">${c.rootDepthCm} ${isUa ? "см" : "cm"}</td>
          <td class="table-num">${c.nitrogenBalanceKg >= 0 ? "+" : ""}${c.nitrogenBalanceKg} ${isUa ? "кг" : "kg"}</td>
          <td class="table-num">${c.heatLimitC}\u00B0C</td>
          <td class="table-num">${c.droughtTolerance}/100</td>
          <td class="table-num"><strong>$${margin}</strong></td>
        </tr>`;
      })
      .join("");
  }

  function renderScienceModal() {
    const isUa = state.lang === "ua";
    $("scienceSourcesGrid").innerHTML = DATA.nasaSources
      .map((s) => {
        const title = isUa && s.title_ua ? s.title_ua : s.title;
        const res = isUa && s.resolution_ua ? s.resolution_ua : s.resolution;
        const role = isUa && s.role_ua ? s.role_ua : s.role;
        return `<div class="science-card">
          <span class="science-code">${escapeHtml(s.code)} &middot; ${escapeHtml(res)}</span>
          <h4>${escapeHtml(title)}</h4>
          <p>${escapeHtml(s.parameter)} \u2014 ${escapeHtml(role)}</p>
        </div>`;
      })
      .join("");
  }

  function renderAll() {
    const field = getActiveField();
    if (!field) return;
    const recSim = simulateRotation(field, state.planSequence, state.useCoverCrop, state.coverCropId, state.useNoTill);
    const tradSim = simulateRotation(field, field.traditionalRotation, false, state.coverCropId, false);

    renderSidebarFields();
    renderInspectorHeaderAndHud(field, recSim);
    renderClimateTab(field);
    renderRotationTab(field, recSim, tradSim);
    renderImpactTab(field, recSim, tradSim);
    renderReportTab(field, recSim, tradSim);
    renderPortfolioModal();
    renderCropLibraryModal();
    renderScienceModal();
    syncCustomSelects();
    syncRangeTracks();
  }

  function setActiveTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      const isMatch = btn.dataset.tab === tabName;
      btn.classList.toggle("is-active", isMatch);
      btn.setAttribute("aria-selected", String(isMatch));
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("is-active", panel.id === `panel${tabName.charAt(0).toUpperCase()}${tabName.slice(1)}`);
    });

    const field = getActiveField();
    if (!field) return;
    if (tabName === "climate") {
      requestAnimationFrame(() => drawClimateChart(field));
    } else if (tabName === "impact") {
      const recSim = simulateRotation(field, state.planSequence, state.useCoverCrop, state.coverCropId, state.useNoTill);
      const tradSim = simulateRotation(field, field.traditionalRotation, false, state.coverCropId, false);
      requestAnimationFrame(() => {
        drawWaterChart(field, recSim, tradSim);
        drawProfitChart(recSim, tradSim);
      });
    }
  }

  function populateStaticSelects() {
    const soilOpts = Object.values(DATA.soilTypes)
      .map((s) => `<option value="${s.id}">${escapeHtml(getSoilName(s.id))}</option>`)
      .join("");
    $("soilTypeSelect").innerHTML = soilOpts;

    const cropOpts = Object.values(DATA.crops)
      .map((c) => `<option value="${c.id}">${escapeHtml(getCropName(c.id))} (${escapeHtml(getCropBadge(c.id))})</option>`)
      .join("");
    $("prevCropSelect").innerHTML = cropOpts;
    $("newFieldPrevCropSelect").innerHTML = cropOpts;
    for (let y = 1; y <= 4; y += 1) {
      $(`year${y}Select`).innerHTML = Object.values(DATA.crops)
        .map((c) => {
          const nStr = c.nitrogenBalanceKg >= 0 ? `+${c.nitrogenBalanceKg}` : `${c.nitrogenBalanceKg}`;
          return `<option value="${c.id}" data-meta="${nStr} N \u00B7 ${c.droughtToleranceScore}/100">${escapeHtml(getCropName(c.id))}</option>`;
        })
        .join("");
    }

    $("coverCropSelect").innerHTML = Object.values(DATA.coverCropBridges)
      .map((cb) => `<option value="${cb.id}">${escapeHtml(getCoverCropName(cb.id))}</option>`)
      .join("");
    syncCustomSelects();
  }

  function handleGeoJsonImport(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const json = JSON.parse(String(ev.target.result));
        let coords = null;
        let propName = file.name.replace(/\.(geo)?json$/i, "");

        const extractRing = (geom) => {
          if (!geom) return null;
          if (geom.type === "Polygon" && geom.coordinates?.[0]) return geom.coordinates[0];
          if (geom.type === "MultiPolygon" && geom.coordinates?.[0]?.[0]) return geom.coordinates[0][0];
          return null;
        };

        if (json.type === "FeatureCollection" && json.features?.length) {
          const feat = json.features[0];
          coords = extractRing(feat.geometry);
          propName = feat.properties?.name || feat.properties?.title || propName;
        } else if (json.type === "Feature") {
          coords = extractRing(json.geometry);
          propName = json.properties?.name || propName;
        } else {
          coords = extractRing(json);
        }

        if (!coords || coords.length < 3) {
          showToast("No valid Polygon geometry found in GeoJSON");
          return;
        }

        const latlngs = coords.map(([lon, lat]) => [Number(lat), Number(lon)]);
        if (latlngs.length > 3) {
          const first = latlngs[0];
          const last = latlngs[latlngs.length - 1];
          if (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) {
            latlngs.pop();
          }
        }

        const [centLat, centLon] = computePolygonCentroid(latlngs);
        const areaHa = computePolygonAreaHa(latlngs);
        const importedField = buildCustomFieldObject(propName, centLat, centLon, latlngs, null);
        importedField.defaultAreaHa = areaHa;

        state.fields.unshift(importedField);
        state.activeFieldId = importedField.id;
        state.overrides = null;
        state.planSequence = [...importedField.selectedPlan];
        saveFieldsToStorage();
        renderAll();
        renderFieldPolygons(true);
        await syncActiveFieldTelemetry(true);
        showToast(`Imported "${propName}" (${areaHa.toFixed(1)} ha)`);
      } catch (_err) {
        showToast("Invalid GeoJSON file");
      }
    };
    reader.readAsText(file);
  }

  async function runGlobalSearch(rawQuery) {
    const q = rawQuery.trim();
    const box = $("searchSuggestions");
    if (q.length < 2) {
      box.classList.add("is-hidden");
      return;
    }

    const lower = q.toLowerCase();
    const mappedQuery = UK_ALIAS_MAP[lower] || q;

    const localMatches = state.fields.filter((f) =>
      `${f.name} ${f.region} ${f.country}`.toLowerCase().includes(lower) ||
      `${f.name} ${f.region} ${f.country}`.toLowerCase().includes(mappedQuery.toLowerCase())
    );

    let itemsHtml = localMatches
      .slice(0, 4)
      .map((f) => `<button type="button" class="search-item" data-local-id="${f.id}">
        <span class="search-item-title">${escapeHtml(f.name)}</span>
        <span class="search-item-sub">Saved parcel &middot; ${escapeHtml(f.country)} (${f.defaultAreaHa} ha)</span>
      </button>`)
      .join("");

    try {
      const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&accept-language=en,uk&limit=4&q=${encodeURIComponent(mappedQuery)}`;
      const results = await fetchWithTimeout(geoUrl, 4500);
      if (Array.isArray(results) && results.length) {
        itemsHtml += results
          .map((r) => {
            const label = r.display_name.split(",").slice(0, 2).join(", ");
            return `<button type="button" class="search-item" data-geo-lat="${r.lat}" data-geo-lon="${r.lon}" data-geo-name="${escapeHtml(label)}">
              <span class="search-item-title">${escapeHtml(label)}</span>
              <span class="search-item-sub">Sample Open-Meteo + NASA POWER here (${Number(r.lat).toFixed(2)}, ${Number(r.lon).toFixed(2)})</span>
            </button>`;
          })
          .join("");
      }
    } catch (_err) {
      if (!itemsHtml) {
        itemsHtml = `<div class="search-item"><span class="search-item-sub">Location lookup offline — try clicking map directly</span></div>`;
      }
    }

    if (!itemsHtml) {
      box.classList.add("is-hidden");
      return;
    }
    box.innerHTML = itemsHtml;
    box.classList.remove("is-hidden");
  }

  function exportPlanJson() {
    const field = getActiveField();
    const eff = getEffectiveSoilAndField(field);
    const recSim = simulateRotation(field, state.planSequence, state.useCoverCrop, state.coverCropId, state.useNoTill);
    const payload = {
      exportedAt: new Date().toISOString(),
      field: { name: field.name, lat: field.lat, lon: field.lon, areaHa: eff.areaHa, polygon: field.polygon },
      soil: eff.soil.name,
      somPct: eff.somPct,
      ph: eff.ph,
      planSequence: state.planSequence,
      coverCrop: state.useCoverCrop ? state.coverCropId : null,
      noTill: state.useNoTill,
      simulation: recSim
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${field.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-rotation.json`;
    a.click();
    showToast("Downloaded field rotation JSON");
  }

  function exportPlanCsv() {
    const field = getActiveField();
    const recSim = simulateRotation(field, state.planSequence, state.useCoverCrop, state.coverCropId, state.useNoTill);
    const lines = ["Year,Crop,Window,YieldFactor,WaterEndMm,NitrogenCarryKg,NetMarginUsdHa"];
    for (const ry of recSim.yearly) {
      const c = DATA.crops[ry.cropId];
      lines.push(`${ry.year},"${c.name}","${c.windowLabel}",${ry.yieldFactor},${ry.waterEndMm},${ry.nCarryKg},${ry.marginUsdHa}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${field.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-schedule.csv`;
    a.click();
    showToast("Downloaded 4-year CSV schedule");
  }

  const customSelectRegistry = [];
  let openSelectRecord = null;
  let selectPortalEl = null;

  function getSelectVariantClass(sel) {
    if (sel.classList.contains("micro-select")) return "fs-variant-micro";
    if (sel.classList.contains("micro-select-wide")) return "fs-variant-wide";
    if (sel.classList.contains("gantt-select")) return "fs-variant-gantt";
    if (sel.id === "cropSeasonFilter") return "fs-variant-filter";
    return "";
  }

  function closeCustomSelect() {
    if (selectPortalEl) {
      selectPortalEl.classList.add("is-hidden");
      selectPortalEl.innerHTML = "";
    }
    if (openSelectRecord) {
      openSelectRecord.wrapper.classList.remove("is-open");
      openSelectRecord.trigger.setAttribute("aria-expanded", "false");
      openSelectRecord = null;
    }
  }

  function syncSingleCustomSelect(rec) {
    const sel = rec.select;
    const selectedOpt = sel.options[sel.selectedIndex] || sel.options[0];
    rec.labelEl.textContent = selectedOpt ? selectedOpt.textContent : "";
    rec.trigger.disabled = Boolean(sel.disabled);
    rec.wrapper.classList.toggle("is-disabled", Boolean(sel.disabled));
    rec.trigger.title = selectedOpt ? selectedOpt.textContent : "";
  }

  function syncCustomSelects() {
    for (const rec of customSelectRegistry) {
      syncSingleCustomSelect(rec);
    }
    if (openSelectRecord) closeCustomSelect();
  }

  function openCustomSelect(rec) {
    if (rec.select.disabled) return;
    if (openSelectRecord === rec) {
      closeCustomSelect();
      return;
    }
    closeCustomSelect();
    openSelectRecord = rec;
    rec.wrapper.classList.add("is-open");
    rec.trigger.setAttribute("aria-expanded", "true");

    selectPortalEl.innerHTML = "";
    const curVal = rec.select.value;
    let selectedBtn = null;

    Array.from(rec.select.options).forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const isSelected = opt.value === curVal;
      btn.className = `fs-select-option${isSelected ? " is-selected" : ""}`;
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", String(isSelected));
      btn.disabled = Boolean(opt.disabled);

      const span = document.createElement("span");
      span.className = "fs-select-opt-main";
      span.textContent = opt.textContent;
      btn.appendChild(span);

      if (opt.dataset?.meta) {
        const meta = document.createElement("span");
        meta.className = "fs-select-opt-meta";
        meta.textContent = opt.dataset.meta;
        btn.appendChild(meta);
      }

      if (isSelected) {
        btn.insertAdjacentHTML(
          "beforeend",
          "<svg class=\"fs-select-check\" viewBox=\"0 0 16 16\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3.5 8.5l3 3 6-6.5\"/></svg>"
        );
        selectedBtn = btn;
      }

      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (opt.disabled) return;
        rec.select.value = opt.value;
        syncSingleCustomSelect(rec);
        closeCustomSelect();
        rec.select.dispatchEvent(new Event("change", { bubbles: true }));
      });

      selectPortalEl.appendChild(btn);
    });

    const rect = rec.trigger.getBoundingClientRect();
    const minW = Math.max(rect.width, 174);
    const maxW = Math.min(340, window.innerWidth - 16);
    selectPortalEl.style.minWidth = `${minW}px`;
    selectPortalEl.style.maxWidth = `${maxW}px`;
    selectPortalEl.classList.remove("is-hidden");

    const portalW = Math.max(minW, selectPortalEl.offsetWidth || minW);
    const portalH = Math.min(248, selectPortalEl.scrollHeight || 190);
    const spaceBelow = window.innerHeight - rect.bottom - 10;
    const placeAbove = spaceBelow < portalH && rect.top > spaceBelow;
    const topPos = placeAbove ? Math.max(8, rect.top - portalH - 5) : Math.min(window.innerHeight - portalH - 8, rect.bottom + 5);
    const leftPos = clamp(rect.left, 8, Math.max(8, window.innerWidth - portalW - 8));

    selectPortalEl.style.top = `${Math.round(topPos)}px`;
    selectPortalEl.style.left = `${Math.round(leftPos)}px`;
    if (selectedBtn) {
      requestAnimationFrame(() => selectedBtn.scrollIntoView({ block: "nearest" }));
    }
  }

  function initCustomSelects() {
    if (!selectPortalEl) {
      selectPortalEl = document.createElement("div");
      selectPortalEl.id = "fsSelectPortal";
      selectPortalEl.className = "fs-select-portal is-hidden";
      selectPortalEl.setAttribute("role", "listbox");
      document.body.appendChild(selectPortalEl);

      document.addEventListener("pointerdown", (ev) => {
        if (!openSelectRecord) return;
        if (openSelectRecord.wrapper.contains(ev.target) || selectPortalEl.contains(ev.target)) return;
        closeCustomSelect();
      });
      document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && openSelectRecord) closeCustomSelect();
      });
      window.addEventListener("resize", closeCustomSelect);
      document.addEventListener(
        "scroll",
        (ev) => {
          if (openSelectRecord && !selectPortalEl.contains(ev.target)) closeCustomSelect();
        },
        true
      );
    }

    document.querySelectorAll("select").forEach((sel) => {
      if (sel.dataset.fsCustomized === "1") return;
      sel.dataset.fsCustomized = "1";
      sel.tabIndex = -1;
      sel.setAttribute("aria-hidden", "true");
      sel.classList.add("fs-native-select-hidden");

      const wrapper = document.createElement("div");
      const variant = getSelectVariantClass(sel);
      wrapper.className = variant ? `fs-select ${variant}` : "fs-select";

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "fs-select-trigger";
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      if (sel.id) trigger.dataset.forSelect = sel.id;

      const labelEl = document.createElement("span");
      labelEl.className = "fs-select-label";
      trigger.appendChild(labelEl);
      trigger.insertAdjacentHTML(
        "beforeend",
        "<svg class=\"fs-select-chevron\" viewBox=\"0 0 16 16\" width=\"12\" height=\"12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 6l4 4 4-4\"/></svg>"
      );

      sel.parentNode.insertBefore(wrapper, sel);
      wrapper.appendChild(sel);
      wrapper.appendChild(trigger);

      const rec = { select: sel, wrapper, trigger, labelEl };
      customSelectRegistry.push(rec);
      syncSingleCustomSelect(rec);

      trigger.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openCustomSelect(rec);
      });
      trigger.addEventListener("keydown", (ev) => {
        if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          openCustomSelect(rec);
        }
      });
      sel.addEventListener("change", () => syncSingleCustomSelect(rec));
    });
  }

  function syncRangeTracks() {
    document.querySelectorAll('input[type="range"]').forEach((input) => {
      const min = Number(input.min || 0);
      const max = Number(input.max || 100);
      const val = Number(input.value || 0);
      const pct = max > min ? clamp(((val - min) / (max - min)) * 100, 0, 100) : 0;
      input.style.setProperty("--range-pct", `${pct.toFixed(1)}%`);
    });
  }

  function redrawVisibleCharts() {
    const f = getActiveField();
    if (!f) return;
    if (state.activeTab === "climate") drawClimateChart(f);
    else if (state.activeTab === "impact") {
      const recSim = simulateRotation(f, state.planSequence, state.useCoverCrop, state.coverCropId, state.useNoTill);
      const tradSim = simulateRotation(f, f.traditionalRotation, false, state.coverCropId, false);
      drawWaterChart(f, recSim, tradSim);
      drawProfitChart(recSim, tradSim);
    }
  }

  function updateLeftNavLabel() {
    const railBtn = $("leftNavCloseBtn");
    if (!railBtn) return;
    const keyMap = {
      workspace: "navMap",
      portfolio: "navPortfolio",
      crops: "navCrops",
      science: "navScience"
    };
    const key = keyMap[state.activeView] || "navMap";
    const viewLabel = t(key, "Map Workspace");
    const fullTitle = `${t("leftNavTitle", "Open navigation panel & views")} · ${viewLabel}`;
    railBtn.title = fullTitle;
    railBtn.setAttribute("aria-label", fullTitle);
  }

  function toggleLeftNav(open) {
    const drawer = $("leftNavDrawer");
    const backdrop = $("leftNavBackdrop");
    const railToggleBtn = $("leftNavCloseBtn");
    if (!drawer) return;
    const nextOpen = open === undefined ? !drawer.classList.contains("is-open") : Boolean(open);
    drawer.classList.toggle("is-open", nextOpen);
    drawer.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    backdrop?.classList.toggle("is-hidden", !nextOpen);
    railToggleBtn?.classList.toggle("is-active", nextOpen);
    railToggleBtn?.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  }

  function setTopNavActive(id) {
    document.querySelectorAll(".top-nav-btn").forEach((b) => {
      b.classList.toggle("is-active", b.id === id);
    });
  }

  function setWorkspaceView(viewName) {
    state.activeView = viewName;
    $("workspaceBody").classList.toggle("is-hidden", viewName !== "workspace");
    $("portfolioView").classList.toggle("is-hidden", viewName !== "portfolio");
    $("cropLibraryView").classList.toggle("is-hidden", viewName !== "crops");
    $("scienceView").classList.toggle("is-hidden", viewName !== "science");

    const navMap = {
      workspace: "railMapBtn",
      portfolio: "railPortfolioBtn",
      crops: "railCropsBtn",
      science: "railScienceBtn"
    };
    setTopNavActive(navMap[viewName] || "railMapBtn");
    updateLeftNavLabel();

    if (viewName === "portfolio") renderPortfolioModal();
    else if (viewName === "crops") renderCropLibraryModal();
    else if (viewName === "science") renderScienceModal();
    else if (viewName === "workspace") {
      setTimeout(() => {
        if (map) map.invalidateSize();
        redrawVisibleCharts();
      }, 40);
    }
  }

  function toggleSidebar(collapsed) {
    if (state.activeView !== "workspace") setWorkspaceView("workspace");
    $("appShell").classList.toggle("sidebar-collapsed", collapsed);
    setTimeout(() => {
      if (map) map.invalidateSize();
    }, 210);
  }

  function toggleInspector(collapsed) {
    $("appShell").classList.toggle("inspector-collapsed", collapsed);
    $("inspectorExpandTab").classList.toggle("is-hidden", !collapsed);
    setTimeout(() => {
      if (map) map.invalidateSize();
      redrawVisibleCharts();
    }, 210);
  }

  function setBasemap(mode) {
    if (!map) return;
    if (mode === "ter") {
      state.basemap = "ter";
      $("layerTerBtn").classList.add("is-active");
      $("layerSatBtn").classList.remove("is-active");
      if (map.hasLayer(layerSat)) map.removeLayer(layerSat);
      if (!map.hasLayer(layerTer)) layerTer.addTo(map);
    } else {
      state.basemap = "sat";
      $("layerSatBtn").classList.add("is-active");
      $("layerTerBtn").classList.remove("is-active");
      if (map.hasLayer(layerTer)) map.removeLayer(layerTer);
      if (!map.hasLayer(layerSat)) layerSat.addTo(map);
    }
  }

  function applyPriorityMode(modeId, persist = true) {
    const mode = DATA.priorityModes[modeId];
    if (!mode) return;
    state.priorityMode = modeId;
    state.weights = { ...mode.weights };
    const field = getActiveField();
    state.planSequence = getPresetSequence(field, modeId);
    if (persist && field) {
      field.selectedPlan = [...state.planSequence];
      saveFieldsToStorage();
    }
    renderAll();
  }

  function triggerPrintReport() {
    state.printMode = "field";
    buildPrintSheet();
    setTimeout(() => window.print(), 80);
  }

  function triggerPortfolioPrint() {
    state.printMode = "portfolio";
    buildPortfolioPrintSheet();
    setTimeout(() => window.print(), 80);
  }

  function bindEvents() {
    const shell = $("appShell");

    $("collapseSidebarBtn").addEventListener("click", () => toggleSidebar(true));
    $("sidebarExpandTab").addEventListener("click", () => {
      if (state.activeView !== "workspace") {
        setWorkspaceView("workspace");
        toggleSidebar(false);
        return;
      }
      toggleSidebar(!shell.classList.contains("sidebar-collapsed"));
    });
    $("collapseInspectorBtn").addEventListener("click", () => toggleInspector(true));
    $("inspectorExpandTab").addEventListener("click", () => toggleInspector(false));

    $("leftNavCloseBtn")?.addEventListener("click", () => toggleLeftNav());
    $("leftNavBackdrop")?.addEventListener("click", () => toggleLeftNav(false));
    $("leftNavDrawer")?.addEventListener("click", (ev) => {
      if (!$("leftNavDrawer").classList.contains("is-open") && !ev.target.closest("button, a")) {
        toggleLeftNav(true);
      }
    });

    $("railMapBtn").addEventListener("click", () => {
      setWorkspaceView("workspace");
      toggleLeftNav(false);
    });
    $("railPortfolioBtn").addEventListener("click", () => {
      setWorkspaceView("portfolio");
      toggleLeftNav(false);
    });
    $("railCropsBtn").addEventListener("click", () => {
      setWorkspaceView("crops");
      toggleLeftNav(false);
    });
    $("railScienceBtn").addEventListener("click", () => {
      setWorkspaceView("science");
      toggleLeftNav(false);
    });

    $("drawerDrawFieldBtn")?.addEventListener("click", () => {
      toggleLeftNav(false);
      $("btnDrawField")?.click();
    });
    $("drawerImportGeoBtn")?.addEventListener("click", () => {
      toggleLeftNav(false);
      $("btnImportGeo")?.click();
    });
    $("drawerPrintBtn")?.addEventListener("click", () => {
      toggleLeftNav(false);
      triggerPortfolioPrint();
    });
    $("drawerTourBtn")?.addEventListener("click", () => {
      toggleLeftNav(false);
      startTour();
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !tourActive && $("leftNavDrawer")?.classList.contains("is-open")) {
        toggleLeftNav(false);
      }
    });

    $("railPrintBtn").addEventListener("click", triggerPortfolioPrint);
    $("tourRestartBtn")?.addEventListener("click", () => startTour());

    $("themeToggleBtn")?.addEventListener("click", () => applyTheme(state.theme === "dark" ? "light" : "dark", true));
    $("langBtnEn")?.addEventListener("click", () => setLanguage("en"));
    $("langBtnUa")?.addEventListener("click", () => setLanguage("ua"));

    $("backToMapPortfolioBtn").addEventListener("click", () => setWorkspaceView("workspace"));
    $("backToMapCropsBtn").addEventListener("click", () => setWorkspaceView("workspace"));
    $("backToMapScienceBtn").addEventListener("click", () => setWorkspaceView("workspace"));

    $("nameFieldModal").addEventListener("click", (ev) => {
      if (ev.target === $("nameFieldModal")) {
        pendingDrawnData = null;
        $("nameFieldModal").classList.add("is-hidden");
      }
    });

    $("portfolioTableBody").addEventListener("click", (ev) => {
      const tr = ev.target.closest("tr[data-jump-field]");
      if (!tr) return;
      setWorkspaceView("workspace");
      selectField(tr.dataset.jumpField, true);
    });

    $("cropSearchInput").addEventListener("input", renderCropLibraryModal);
    $("cropSeasonFilter").addEventListener("change", renderCropLibraryModal);

    $("fieldSortSelect").addEventListener("change", (ev) => {
      state.sortBy = ev.target.value;
      renderSidebarFields();
    });

    $("fieldList").addEventListener("click", (ev) => {
      const delBtn = ev.target.closest("[data-del-id]");
      if (delBtn) {
        ev.stopPropagation();
        if (pendingMapClickTimer) {
          clearTimeout(pendingMapClickTimer);
          pendingMapClickTimer = null;
        }
        activeProbeSeq += 1;
        const delId = delBtn.dataset.delId;
        state.fields = state.fields.filter((f) => f.id !== delId);
        if (state.activeFieldId === delId) {
          state.activeFieldId = state.fields[0]?.id || null;
        }
        saveFieldsToStorage();
        renderAll();
        renderFieldPolygons(true);
        showToast("Removed saved parcel");
        return;
      }
      const card = ev.target.closest("[data-field-id]");
      if (card) {
        selectField(card.dataset.fieldId, true);
        if (window.innerWidth <= 900 && !tourActive) {
          toggleSidebar(true);
        }
      }
    });

    $("locationSearchInput").addEventListener("input", (ev) => {
      const val = ev.target.value;
      $("locationSearchClear").classList.toggle("is-hidden", !val);
      renderSidebarFields();
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => runGlobalSearch(val), 360);
    });

    $("locationSearchClear").addEventListener("click", () => {
      $("locationSearchInput").value = "";
      $("locationSearchClear").classList.add("is-hidden");
      $("searchSuggestions").classList.add("is-hidden");
      renderSidebarFields();
    });

    $("searchSuggestions").addEventListener("click", async (ev) => {
      const item = ev.target.closest(".search-item");
      if (!item) return;
      $("searchSuggestions").classList.add("is-hidden");
      if (item.dataset.localId) {
        selectField(item.dataset.localId, true);
      } else if (item.dataset.geoLat && item.dataset.geoLon) {
        const lat = Number(item.dataset.geoLat);
        const lon = Number(item.dataset.geoLon);
        const name = item.dataset.geoName || "Searched Site";
        map.setView([lat, lon], 12);
        const bundle = await fetchRawBundle(lat, lon);
        const poly = createRectPolygon(lat, lon, 38);
        const newField = buildCustomFieldObject(name, lat, lon, poly, bundle);
        state.fields.unshift(newField);
        state.activeFieldId = newField.id;
        state.overrides = null;
        state.planSequence = [...newField.selectedPlan];
        state.liveCurrent = bundle.meteo?.current || null;
        state.liveForecast = bundle.meteo?.daily || null;
        state.liveSoilGrids = bundle.soilGrids || null;
        state.livePowerStats = bundle.power || null;
        saveFieldsToStorage();
        renderAll();
        renderFieldPolygons(true);
      }
    });

    document.addEventListener("click", (ev) => {
      if (!ev.target.closest(".sidebar-search-wrap")) {
        $("searchSuggestions").classList.add("is-hidden");
      }
    });

    $("btnDrawField").addEventListener("click", () => {
      if (state.activeView !== "workspace") setWorkspaceView("workspace");
      startDrawingPolygon(null);
    });
    $("redrawPolygonBtn").addEventListener("click", () => {
      if (state.activeView !== "workspace") setWorkspaceView("workspace");
      const field = getActiveField();
      if (field) startDrawingPolygon(field.id);
    });
    $("drawUndoBtn").addEventListener("click", () => {
      state.drawPoints.pop();
      renderDrawingOverlay();
    });
    $("drawCancelBtn").addEventListener("click", cancelDrawingPolygon);
    $("drawFinishBtn").addEventListener("click", finishDrawingPolygon);

    $("confirmNewFieldBtn").addEventListener("click", confirmSaveNewField);
    $("cancelNewFieldBtn").addEventListener("click", () => {
      pendingDrawnData = null;
      $("nameFieldModal").classList.add("is-hidden");
    });

    $("btnImportGeo").addEventListener("click", () => $("geoImportInput").click());
    $("geoImportInput").addEventListener("change", (ev) => {
      if (state.activeView !== "workspace") setWorkspaceView("workspace");
      handleGeoJsonImport(ev.target.files?.[0]);
      ev.target.value = "";
    });

    $("layerSatBtn").addEventListener("click", () => setBasemap("sat"));
    $("layerTerBtn").addEventListener("click", () => setBasemap("ter"));

    $("toggleLabelsBtn").addEventListener("click", () => {
      setLabelsVisible(!state.showLabels);
    });

    $("toggleZonesBtn").addEventListener("click", () => {
      setZonesVisible(!state.showZones);
    });

    $("toggleAllFieldsBtn").addEventListener("click", () => {
      const coords = state.fields.map((f) => [f.lat, f.lon]);
      if (coords.length) map.fitBounds(coords, { padding: [50, 50], maxZoom: 6 });
    });

    $("editFieldNameBtn").addEventListener("click", () => {
      const field = getActiveField();
      if (!field) return;
      const next = window.prompt("Parcel name:", field.name);
      if (next && next.trim()) {
        field.name = next.trim();
        saveFieldsToStorage();
        renderAll();
        renderFieldPolygons(false);
      }
    });

    $("syncTelemetryBtn").addEventListener("click", () => {
      syncActiveFieldTelemetry(true);
      showToast("Refreshing live NASA POWER, Open-Meteo & SoilGrids...");
    });
    $("exportPlanBtn").addEventListener("click", exportPlanJson);
    $("reportExportJsonBtn").addEventListener("click", exportPlanJson);
    $("reportExportCsvBtn").addEventListener("click", exportPlanCsv);
    $("printPlanBtn").addEventListener("click", triggerPrintReport);
    $("reportPrintBtn").addEventListener("click", triggerPrintReport);

    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
    });

    const applyOverride = (key, val) => {
      if (!state.overrides) state.overrides = {};
      state.overrides[key] = val;
      renderAll();
    };

    $("soilTypeSelect").addEventListener("change", (ev) => applyOverride("soilTypeId", ev.target.value));
    $("prevCropSelect").addEventListener("change", (ev) => applyOverride("prevCrop", ev.target.value));
    $("fieldAreaInput").addEventListener("input", (ev) => applyOverride("areaHa", clamp(Number(ev.target.value) || 40, 0.5, 20000)));
    $("soilPhInput").addEventListener("input", (ev) => applyOverride("ph", clamp(Number(ev.target.value) || 6.6, 4.2, 8.8)));
    $("somSlider").addEventListener("input", (ev) => applyOverride("somPct", Number(ev.target.value)));
    $("resetOverridesBtn").addEventListener("click", () => {
      state.overrides = null;
      renderAll();
      showToast("Restored parcel SoilGrids defaults");
    });

    $("priorityModeGroup").addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-mode]");
      if (!btn) return;
      applyPriorityMode(btn.dataset.mode, true);
    });

    const onWeightChange = (key, val) => {
      state.weights[key] = Number(val);
      renderAll();
    };
    $("weightWaterSlider").addEventListener("input", (ev) => onWeightChange("water", ev.target.value));
    $("weightSoilSlider").addEventListener("input", (ev) => onWeightChange("soil", ev.target.value));
    $("weightProfitSlider").addEventListener("input", (ev) => onWeightChange("profit", ev.target.value));

    $("coverCropToggle").addEventListener("change", (ev) => {
      state.useCoverCrop = ev.target.checked;
      getActiveField().useCoverCrop = state.useCoverCrop;
      saveFieldsToStorage();
      renderAll();
    });
    $("coverCropSelect").addEventListener("change", (ev) => {
      state.coverCropId = ev.target.value;
      getActiveField().coverCropId = state.coverCropId;
      saveFieldsToStorage();
      renderAll();
    });
    $("noTillToggle").addEventListener("change", (ev) => {
      state.useNoTill = ev.target.checked;
      getActiveField().useNoTill = state.useNoTill;
      saveFieldsToStorage();
      renderAll();
    });

    for (let y = 0; y < 4; y += 1) {
      $(`year${y + 1}Select`).addEventListener("change", (ev) => {
        state.planSequence[y] = ev.target.value;
        getActiveField().selectedPlan = [...state.planSequence];
        saveFieldsToStorage();
        renderAll();
      });
    }

    $("autoOptimizeBtn").addEventListener("click", autoOptimizeRotation);
    $("saveFieldPlanBtn").addEventListener("click", () => {
      const f = getActiveField();
      f.selectedPlan = [...state.planSequence];
      f.coverCropId = state.coverCropId;
      f.useCoverCrop = state.useCoverCrop;
      f.useNoTill = state.useNoTill;
      if (state.overrides) {
        if (state.overrides.soilTypeId) f.defaultSoilType = state.overrides.soilTypeId;
        if (state.overrides.prevCrop) f.defaultPrevCrop = state.overrides.prevCrop;
        if (state.overrides.areaHa != null) f.defaultAreaHa = state.overrides.areaHa;
        if (state.overrides.somPct != null) f.defaultSomPct = state.overrides.somPct;
        if (state.overrides.ph != null) f.defaultSoilPh = state.overrides.ph;
        state.overrides = null;
      }
      saveFieldsToStorage();
      renderAll();
      showToast(`Saved 4-yr plan & overrides to ${f.name}`);
    });

    window.addEventListener("beforeprint", () => {
      if (state.printMode === "portfolio") buildPortfolioPrintSheet();
      else buildPrintSheet();
    });
    window.addEventListener("afterprint", () => {
      state.printMode = "field";
    });
    window.addEventListener("resize", redrawVisibleCharts);
  }

  const TOUR_STORAGE_KEY = "field_shift_tour_done";
  let tourActive = false;
  let tourStepIndex = 0;
  let tourTimers = [];
  let tourBackup = null;
  let tourTargetsOverride = null;

  function scheduleTour(fn, delayMs) {
    const id = setTimeout(fn, delayMs);
    tourTimers.push(id);
    return id;
  }

  function clearTourTimers() {
    while (tourTimers.length) {
      clearTimeout(tourTimers.pop());
    }
    activeProbeSeq += 1;
  }

  let tourTransitionUntil = 0;

  function closeTourPopupOnly() {
    if (probePopup && map) {
      map.closePopup(probePopup);
    }
  }

  function getInspectorScroller() {
    return document.querySelector(".inspector-body");
  }

  function setInspectorScrollTop(topPx, smooth = false) {
    const scroller = getInspectorScroller();
    if (!scroller) return;
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextTop = clamp(Math.round(Number(topPx) || 0), 0, maxScroll);
    if (smooth) {
      scroller.scrollTo({ top: nextTop, behavior: "smooth" });
    } else {
      scroller.scrollTop = nextTop;
    }
  }

  function scrollContainerToElement(scroller, el, align = "center", smooth = false, edgePad = 14) {
    if (!scroller || !el) return;
    const sRect = scroller.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    if (sRect.height <= 0 || eRect.height <= 0) return;

    const relTop = eRect.top - sRect.top + scroller.scrollTop;
    let targetScroll = scroller.scrollTop;

    if (align === "top") {
      targetScroll = relTop - edgePad;
    } else if (align === "center") {
      if (eRect.height + edgePad * 2 >= sRect.height) {
        targetScroll = relTop - edgePad;
      } else {
        targetScroll = relTop - (sRect.height - eRect.height) / 2;
      }
    } else {
      if (eRect.top < sRect.top + edgePad) {
        targetScroll = relTop - edgePad;
      } else if (eRect.bottom > sRect.bottom - edgePad) {
        targetScroll = relTop + eRect.height - sRect.height + edgePad;
      }
    }

    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const clamped = clamp(Math.round(targetScroll), 0, maxScroll);
    if (smooth) {
      scroller.scrollTo({ top: clamped, behavior: "smooth" });
    } else {
      scroller.scrollTop = clamped;
    }
  }

  function scrollFieldListToActive(smooth = false) {
    const list = $("fieldList");
    const active = list?.querySelector(".field-card.is-active");
    if (list && active) {
      scrollContainerToElement(list, active, "center", smooth, 8);
    }
  }

  function ensureStepInView(targetOrList, align = "center", smooth = false, edgePad = 14) {
    const raw = Array.isArray(targetOrList) ? targetOrList : [targetOrList];
    const els = raw.filter((el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!els.length) return;

    const primary = els[0];
    const fieldList = $("fieldList");
    const inspectorBody = getInspectorScroller();

    if (fieldList && fieldList.contains(primary) && fieldList.scrollHeight > fieldList.clientHeight + 2) {
      scrollContainerToElement(fieldList, primary, align === "top" ? "top" : "center", smooth, Math.min(edgePad, 10));
    } else if (inspectorBody && inspectorBody.contains(primary) && inspectorBody.scrollHeight > inspectorBody.clientHeight + 2) {
      scrollContainerToElement(inspectorBody, primary, align === "page-top" ? "top" : align, smooth, edgePad);
    }

    const docEl = document.documentElement || document.body;
    const pageMaxScroll = Math.max(0, (docEl ? docEl.scrollHeight : 0) - window.innerHeight);
    if (pageMaxScroll <= 2) return;

    if (align === "page-top") {
      window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
      return;
    }

    let uTop = Infinity;
    let uBottom = -Infinity;
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      uTop = Math.min(uTop, r.top);
      uBottom = Math.max(uBottom, r.bottom);
    });
    const uHeight = Math.max(0, uBottom - uTop);
    const absTop = uTop + window.scrollY;
    const vh = window.innerHeight;
    const topSafe = 20;
    const bottomSafe = 20;
    const availH = Math.max(120, vh - topSafe - bottomSafe);

    let nextY = null;
    if (align === "top") {
      nextY = absTop - topSafe;
    } else if (align === "center") {
      if (uHeight >= availH) {
        nextY = absTop - topSafe;
      } else if (availH - uHeight < 460 && uHeight + 220 <= availH) {
        nextY = absTop - 28;
      } else {
        nextY = absTop - topSafe - (availH - uHeight) / 2;
      }
    } else if (uTop < topSafe || uBottom > vh - bottomSafe) {
      if (uHeight >= availH || uTop < topSafe) {
        nextY = absTop - topSafe;
      } else {
        nextY = absTop + uHeight - (vh - bottomSafe);
      }
    }

    if (nextY !== null) {
      const clampedY = clamp(Math.round(nextY), 0, pageMaxScroll);
      if (Math.abs(clampedY - window.scrollY) > 1) {
        window.scrollTo({ top: clampedY, behavior: smooth ? "smooth" : "auto" });
      }
    }
  }

  function setLabelsVisible(visible) {
    state.showLabels = Boolean(visible);
    $("toggleLabelsBtn")?.classList.toggle("is-active", state.showLabels);
    if (!map || !layerLabels) return;
    if (state.showLabels) {
      if (!map.hasLayer(layerLabels)) layerLabels.addTo(map);
    } else if (map.hasLayer(layerLabels)) {
      map.removeLayer(layerLabels);
    }
  }

  function setZonesVisible(visible) {
    state.showZones = Boolean(visible);
    $("toggleZonesBtn")?.classList.toggle("is-active", state.showZones);
    $("mapZonesLegend")?.classList.toggle("is-hidden", !state.showZones);
    renderZonesOverlay();
  }

  function flashTourControl(el) {
    if (!el) return;
    el.classList.remove("tour-control-flash");
    void el.offsetWidth;
    el.classList.add("tour-control-flash");
  }

  function getCustomTrigger(selectEl) {
    return selectEl?.parentElement?.querySelector(".fs-select-trigger") || selectEl;
  }

  function captureFieldPlans() {
    const out = {};
    state.fields.forEach((f) => {
      out[f.id] = {
        selectedPlan: f.selectedPlan ? [...f.selectedPlan] : null,
        useCoverCrop: f.useCoverCrop,
        coverCropId: f.coverCropId,
        useNoTill: f.useNoTill
      };
    });
    return out;
  }

  function restoreTourBackupState(openTab) {
    if (!tourBackup) return;
    if (tourBackup.fieldPlans) {
      state.fields.forEach((f) => {
        const snap = tourBackup.fieldPlans[f.id];
        if (!snap) return;
        f.selectedPlan = snap.selectedPlan ? [...snap.selectedPlan] : null;
        f.useCoverCrop = snap.useCoverCrop;
        f.coverCropId = snap.coverCropId;
        f.useNoTill = snap.useNoTill;
      });
    }
    state.sortBy = tourBackup.sortBy || "default";
    applyTheme(tourBackup.theme || "light", false, false);
    setBasemap(tourBackup.basemap);
    setLabelsVisible(tourBackup.showLabels !== false);
    setZonesVisible(tourBackup.showZones !== false);
    if (tourBackup.fieldId) selectField(tourBackup.fieldId, true);
    state.priorityMode = tourBackup.priorityMode;
    state.weights = deepClone(tourBackup.weights);
    state.planSequence = deepClone(tourBackup.planSequence);
    state.useCoverCrop = tourBackup.useCoverCrop;
    state.coverCropId = tourBackup.coverCropId || "rye_vetch";
    state.useNoTill = tourBackup.useNoTill !== false;
    state.overrides = deepClone(tourBackup.overrides);
    renderAll();
    setActiveTab(openTab || tourBackup.tab || "climate");
    scrollFieldListToActive(false);
  }

  const TOUR_STEPS = [
    {
      target: "#fieldsSidebar",
      side: "right",
      scrollAlign: "page-top",
      titleKey: "tourStep1Title",
      descKey: "tourStep1Desc",
      prepare() {
        closeTourPopupOnly();
        setWorkspaceView("workspace");
        toggleSidebar(false);
        state.sortBy = "default";
        renderSidebarFields();
        syncCustomSelects();
        const firstId = state.fields[0]?.id;
        if (firstId) selectField(firstId, true);
        scrollFieldListToActive(false);
        ensureStepInView([$("fieldsSidebar")], "page-top", false, 14);
      },
      demo() {
        const alt = state.fields.find((f) => f.id === "us_kansas") || state.fields[1];
        scheduleTour(() => {
          if (!tourActive) return;
          state.sortBy = "risk";
          renderSidebarFields();
          syncCustomSelects();
          flashTourControl(getCustomTrigger($("fieldSortSelect")));
        }, 480);
        scheduleTour(() => {
          if (!tourActive || !alt) return;
          selectField(alt.id, true);
          scrollFieldListToActive(true);
          flashTourControl($("fieldList")?.querySelector(".field-card.is-active"));
        }, 1150);
        scheduleTour(() => {
          if (!tourActive) return;
          state.sortBy = "default";
          renderSidebarFields();
          syncCustomSelects();
          scrollFieldListToActive(true);
          flashTourControl(getCustomTrigger($("fieldSortSelect")));
        }, 1950);
      }
    },
    {
      target: ".floating-map-dock",
      side: "top",
      scrollAlign: "center",
      titleKey: "tourStep2Title",
      descKey: "tourStep2Desc",
      prepare() {
        closeTourPopupOnly();
        setBasemap("sat");
        setLabelsVisible(true);
        setZonesVisible(true);
        ensureStepInView([document.querySelector(".floating-map-dock")], "center", false, 14);
      },
      demo() {
        scheduleTour(() => {
          if (!tourActive) return;
          setBasemap("ter");
          flashTourControl($("layerTerBtn"));
        }, 420);
        scheduleTour(() => {
          if (!tourActive) return;
          setLabelsVisible(false);
          flashTourControl($("toggleLabelsBtn"));
        }, 960);
        scheduleTour(() => {
          if (!tourActive) return;
          setZonesVisible(false);
          flashTourControl($("toggleZonesBtn"));
        }, 1500);
        scheduleTour(() => {
          if (!tourActive) return;
          setBasemap("sat");
          setLabelsVisible(true);
          setZonesVisible(true);
          flashTourControl($("layerSatBtn"));
          flashTourControl($("toggleLabelsBtn"));
          flashTourControl($("toggleZonesBtn"));
        }, 2100);
      }
    },
    {
      getTargets: () => {
        const hud = $("mapWeatherHud");
        if (hud) {
          const r = hud.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return [hud];
        }
        return [document.querySelector(".map-stage")];
      },
      side: "left",
      scrollAlign: "center",
      titleKey: "tourStep3Title",
      descKey: "tourStep3Desc",
      prepare() {
        closeTourPopupOnly();
        const fId = tourBackup?.fieldId || state.fields[0]?.id;
        if (fId) selectField(fId, true);
        scrollFieldListToActive(false);
        ensureStepInView(getStepTargetElements(this), "center", false, 14);
      },
      demo() {
        scheduleTour(() => {
          if (!tourActive) return;
          const field = getActiveField();
          if (field) {
            probeMapPoint(field.lat + 0.008, field.lon + 0.012);
            flashTourControl($("mapWeatherHud"));
            scheduleTour(() => realignTour(true), 40);
          }
        }, 520);
        scheduleTour(() => {
          if (!tourActive) return;
          const field = getActiveField();
          if (field) {
            probeMapPoint(field.lat - 0.006, field.lon - 0.011);
            flashTourControl($("mapWeatherHud"));
            scheduleTour(() => realignTour(true), 40);
          }
        }, 1450);
      }
    },
    {
      getTargets: () => [$("somSlider")?.closest(".panel-card")],
      clipContainer: ".inspector-body",
      side: "left",
      scrollAlign: "center",
      titleKey: "tourStep4Title",
      descKey: "tourStep4Desc",
      prepare() {
        closeTourPopupOnly();
        toggleInspector(false);
        state.overrides = null;
        setActiveTab("climate");
        renderAll();
        const soilCard = $("somSlider")?.closest(".panel-card");
        ensureStepInView(soilCard, "center", false, 14);
      },
      demo() {
        const keepVisible = () => {
          const soilCard = $("somSlider")?.closest(".panel-card");
          ensureStepInView(soilCard, "nearest", false, 12);
          scheduleTour(() => realignTour(true), 24);
        };
        scheduleTour(() => {
          if (!tourActive) return;
          const field = getActiveField();
          if (!field) return;
          const eff = getEffectiveSoilAndField(field);
          const nextSoil = eff.soilTypeId === "sandy_loam" ? "silty_loam" : "sandy_loam";
          state.overrides = { ...(state.overrides || {}), soilTypeId: nextSoil };
          renderAll();
          keepVisible();
          flashTourControl(getCustomTrigger($("soilTypeSelect")));
        }, 480);
        scheduleTour(() => {
          if (!tourActive) return;
          const field = getActiveField();
          if (!field) return;
          const eff = getEffectiveSoilAndField(field);
          const nextCrop = eff.prevCrop === "soybean" ? "wheat_winter" : "soybean";
          state.overrides = { ...(state.overrides || {}), prevCrop: nextCrop, ph: 6.1 };
          renderAll();
          keepVisible();
          flashTourControl(getCustomTrigger($("prevCropSelect")));
          flashTourControl($("soilPhInput"));
        }, 1100);
        scheduleTour(() => {
          if (!tourActive) return;
          const field = getActiveField();
          if (!field) return;
          const cur = getEffectiveSoilAndField(field).somPct || 3.4;
          state.overrides = { ...(state.overrides || {}), somPct: Number(clamp(cur + 0.8, 1.8, 6.5).toFixed(1)) };
          renderAll();
          keepVisible();
          flashTourControl($("somSlider"));
        }, 1750);
      }
    },
    {
      getTargets: () => [$("priorityModeGroup")?.closest(".panel-card"), document.querySelector("#panelRotation .gantt-card")],
      clipContainer: ".inspector-body",
      side: "left",
      scrollAlign: "top",
      titleKey: "tourStep5Title",
      descKey: "tourStep5Desc",
      prepare() {
        closeTourPopupOnly();
        toggleInspector(false);
        state.overrides = null;
        state.useCoverCrop = true;
        state.useNoTill = true;
        setActiveTab("rotation");
        applyPriorityMode("water_first", false);
        const strategyCard = $("priorityModeGroup")?.closest(".panel-card");
        tourTargetsOverride = strategyCard ? [strategyCard] : null;
        setInspectorScrollTop(0, false);
        ensureStepInView(strategyCard || document.querySelector("#panelRotation"), "top", false, 14);
      },
      demo() {
        scheduleTour(() => {
          if (!tourActive) return;
          applyPriorityMode("max_profit", false);
          flashTourControl($("priorityModeGroup")?.querySelector('[data-mode="max_profit"]'));
          scheduleTour(() => realignTour(true), 24);
        }, 420);
        scheduleTour(() => {
          if (!tourActive) return;
          state.useCoverCrop = false;
          renderAll();
          flashTourControl($("coverCropToggle")?.closest("label"));
          scheduleTour(() => realignTour(true), 24);
        }, 920);
        scheduleTour(() => {
          if (!tourActive) return;
          state.useCoverCrop = true;
          state.useNoTill = false;
          state.weights.water = clamp((Number(state.weights.water) || 45) + 20, 0, 100);
          renderAll();
          flashTourControl($("noTillToggle")?.closest("label"));
          flashTourControl($("weightWaterSlider"));
          scheduleTour(() => realignTour(true), 24);
        }, 1420);
        scheduleTour(() => {
          if (!tourActive) return;
          state.useNoTill = true;
          applyPriorityMode("soil_builder", false);
          const ganttCard = document.querySelector("#panelRotation .gantt-card");
          if (ganttCard) {
            tourTargetsOverride = [ganttCard];
            ensureStepInView(ganttCard, "center", true, 14);
            flashTourControl(ganttCard);
            realignTour(false);
            scheduleTour(() => realignTour(true), 420);
          }
        }, 1950);
      }
    },
    {
      getTargets: () => [
        document.querySelector("#panelImpact .kpi-strip-4"),
        $("waterChart")?.closest(".panel-card"),
        $("profitChart")?.closest(".panel-card")
      ],
      clipContainer: ".inspector-body",
      side: "left",
      scrollAlign: "top",
      titleKey: "tourStep6Title",
      descKey: "tourStep6Desc",
      prepare() {
        closeTourPopupOnly();
        toggleInspector(false);
        state.useCoverCrop = true;
        state.useNoTill = true;
        setActiveTab("impact");
        renderAll();
        redrawVisibleCharts();
        const kpiStrip = document.querySelector("#panelImpact .kpi-strip-4");
        const waterCard = $("waterChart")?.closest(".panel-card");
        tourTargetsOverride = [kpiStrip, waterCard].filter(Boolean);
        setInspectorScrollTop(0, false);
        ensureStepInView(tourTargetsOverride, "top", false, 14);
      },
      demo() {
        scheduleTour(() => {
          if (!tourActive) return;
          state.useCoverCrop = false;
          state.useNoTill = false;
          renderAll();
          redrawVisibleCharts();
          const kpiStrip = document.querySelector("#panelImpact .kpi-strip-4");
          const waterCard = $("waterChart")?.closest(".panel-card");
          tourTargetsOverride = [kpiStrip, waterCard].filter(Boolean);
          ensureStepInView(tourTargetsOverride, "top", false, 14);
          flashTourControl(waterCard);
          scheduleTour(() => realignTour(true), 24);
        }, 580);
        scheduleTour(() => {
          if (!tourActive) return;
          state.useCoverCrop = true;
          state.useNoTill = true;
          renderAll();
          redrawVisibleCharts();
          const profitCard = $("profitChart")?.closest(".panel-card");
          if (profitCard) {
            tourTargetsOverride = [profitCard];
            ensureStepInView(profitCard, "center", true, 14);
            flashTourControl(profitCard);
            realignTour(false);
            scheduleTour(() => realignTour(true), 420);
          }
        }, 1480);
      }
    },
    {
      getTargets: () => [
        $("leftNavCloseBtn"),
        document.querySelector(".cmd-right")
      ].filter((el) => el && el.getBoundingClientRect().width > 0),
      side: "bottom",
      scrollAlign: "page-top",
      titleKey: "tourStep7Title",
      descKey: "tourStep7Desc",
      prepare() {
        closeTourPopupOnly();
        toggleLeftNav(false);
        restoreTourBackupState("climate");
        setWorkspaceView("workspace");
        setInspectorScrollTop(0, false);
        ensureStepInView(getStepTargetElements(this), "page-top", false, 14);
      },
      demo() {
        const baseTheme = tourBackup?.theme || "light";
        const flipTheme = baseTheme === "dark" ? "light" : "dark";
        scheduleTour(() => {
          if (!tourActive) return;
          applyTheme(flipTheme, false, false);
          flashTourControl($("themeToggleBtn"));
        }, 420);
        scheduleTour(() => {
          if (!tourActive) return;
          toggleLeftNav(true);
          tourTargetsOverride = [$("leftNavDrawer")].filter(Boolean);
          setWorkspaceView("portfolio");
          flashTourControl($("railPortfolioBtn"));
          scheduleTour(() => realignTour(true), 240);
        }, 1050);
        scheduleTour(() => {
          if (!tourActive) return;
          setWorkspaceView("crops");
          flashTourControl($("railCropsBtn"));
          scheduleTour(() => realignTour(true), 40);
        }, 1780);
        scheduleTour(() => {
          if (!tourActive) return;
          toggleLeftNav(false);
          tourTargetsOverride = null;
          setWorkspaceView("workspace");
          applyTheme(baseTheme, false, false);
          flashTourControl($("leftNavCloseBtn"));
          flashTourControl($("themeToggleBtn"));
          scheduleTour(() => realignTour(true), 240);
        }, 2460);
      }
    }
  ];

  function getStepTargetElements(step) {
    if (!step) return [];
    const list = tourTargetsOverride && tourTargetsOverride.length
      ? tourTargetsOverride
      : (typeof step.getTargets === "function" ? step.getTargets() : [document.querySelector(step.target)]);
    return list.filter((el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  function realignTour(instant = true) {
    if (!tourActive) return;
    positionTourStep(TOUR_STEPS[tourStepIndex], instant);
  }

  function positionTourStep(step, instant = false) {
    if (!tourActive || !step) return;
    const spotlight = $("tourSpotlight");
    const popover = $("tourPopover");
    const targets = getStepTargetElements(step);
    if (!spotlight || !popover || !targets.length) return;

    const firstEl = targets[0];
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    targets.forEach((el) => {
      const r = el.getBoundingClientRect();
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    });

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 5;
    const edgeSafe = 6;

    let clipLeft = edgeSafe;
    let clipTop = edgeSafe;
    let clipRight = vw - edgeSafe;
    let clipBottom = vh - edgeSafe;

    if (step.clipContainer) {
      const clipEl = document.querySelector(step.clipContainer);
      if (clipEl) {
        const cr = clipEl.getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0) {
          clipLeft = Math.max(clipLeft, cr.left + 4);
          clipTop = Math.max(clipTop, cr.top + 4);
          clipRight = Math.min(clipRight, cr.right - 4);
          clipBottom = Math.min(clipBottom, cr.bottom - 5);
        }
      }
    }

    const sLeft = clamp(left - pad, clipLeft, Math.max(clipLeft, clipRight - 48));
    const sTop = clamp(top - pad, clipTop, Math.max(clipTop, clipBottom - 48));
    const sRight = clamp(right + pad, sLeft + 48, Math.max(sLeft + 48, clipRight));
    const sBottom = clamp(bottom + pad, sTop + 48, Math.max(sTop + 48, clipBottom));

    const leftPx = Math.round(sLeft);
    const topPx = Math.round(sTop);
    const rightPx = Math.round(sRight);
    const bottomPx = Math.round(sBottom);
    const sW = Math.max(48, rightPx - leftPx);
    const sH = Math.max(48, bottomPx - topPx);

    spotlight.classList.toggle("is-instant", Boolean(instant));
    spotlight.style.top = `${topPx}px`;
    spotlight.style.left = `${leftPx}px`;
    spotlight.style.width = `${sW}px`;
    spotlight.style.height = `${sH}px`;

    const popRect = popover.getBoundingClientRect();
    const popW = popRect.width || Math.min(352, vw - 24);
    const popH = popRect.height || 210;
    const gap = 14;

    let pLeft = 16;
    let pTop = 72;

    if (step.side === "right" && rightPx + gap + popW <= vw - 10) {
      pLeft = rightPx + gap;
      pTop = clamp(topPx + 20, 68, vh - popH - 12);
    } else if (step.side === "left") {
      const drawer = $("inspectorDrawer");
      const inInspector = drawer && !$("appShell")?.classList.contains("inspector-collapsed") && drawer.contains(firstEl);
      const anchorLeft = inInspector && vw > 1024 ? Math.min(leftPx, Math.round(drawer.getBoundingClientRect().left)) : leftPx;
      if (anchorLeft - gap - popW >= 10) {
        pLeft = anchorLeft - gap - popW;
        const centeredTop = topPx + Math.min(36, Math.max(0, Math.round((sH - popH) / 2)));
        pTop = topPx > 120 ? clamp(centeredTop, 68, vh - popH - 12) : clamp(Math.round((vh - popH) * 0.42), 68, vh - popH - 12);
      } else if (bottomPx + gap + popH <= vh - 10) {
        pTop = bottomPx + gap;
        pLeft = clamp(rightPx - popW, 12, vw - popW - 12);
      } else if (topPx - gap - popH >= 12) {
        pTop = topPx - gap - popH;
        pLeft = clamp(rightPx - popW, 12, vw - popW - 12);
      } else {
        pLeft = clamp(vw / 2 - popW / 2, 12, vw - popW - 12);
        pTop = topPx > vh - bottomPx ? 12 : clamp(vh - popH - 16, 12, vh - popH - 12);
      }
    } else if (step.side === "top" && topPx - gap - popH >= 56) {
      pTop = topPx - gap - popH;
      pLeft = clamp(leftPx + sW / 2 - popW / 2, 12, vw - popW - 12);
    } else if (bottomPx + gap + popH <= vh - 10) {
      pTop = bottomPx + gap;
      pLeft = clamp(rightPx - popW, 12, vw - popW - 12);
    } else if (topPx - gap - popH >= 12) {
      pTop = topPx - gap - popH;
      pLeft = clamp(leftPx, 12, vw - popW - 12);
    } else {
      pLeft = clamp(vw / 2 - popW / 2, 12, vw - popW - 12);
      pTop = topPx > vh - bottomPx ? 12 : clamp(vh - popH - 16, 12, vh - popH - 12);
    }

    popover.style.left = `${Math.round(pLeft)}px`;
    popover.style.top = `${Math.round(pTop)}px`;
  }

  function renderTourTextOnly() {
    if (!tourActive) return;
    const step = TOUR_STEPS[tourStepIndex];
    if (!step) return;
    const isLast = tourStepIndex === TOUR_STEPS.length - 1;
    $("tourStepBadge").textContent = `${tourStepIndex + 1} / ${TOUR_STEPS.length}`;
    $("tourTitle").textContent = t(step.titleKey);
    $("tourDesc").textContent = t(step.descKey);
    $("tourPrevBtn").disabled = tourStepIndex === 0;
    $("tourNextLabel").textContent = isLast ? t("tourFinish") : t("tourNext");
    $("tourDots").innerHTML = TOUR_STEPS.map((_, idx) => `<span class="tour-dot${idx === tourStepIndex ? " is-active" : ""}"></span>`).join("");
  }

  function refreshTourLanguage() {
    renderTourTextOnly();
    if (tourActive) {
      requestAnimationFrame(() => realignTour(true));
    }
  }

  function goToTourStep(idx) {
    clearTourTimers();
    tourTargetsOverride = null;
    tourStepIndex = clamp(idx, 0, TOUR_STEPS.length - 1);
    tourTransitionUntil = performance.now() + 340;
    const step = TOUR_STEPS[tourStepIndex];
    if (tourBackup && tourStepIndex < TOUR_STEPS.length - 1) {
      applyTheme(tourBackup.theme || "light", false, false);
      toggleLeftNav(false);
      setWorkspaceView("workspace");
      setLabelsVisible(tourBackup.showLabels !== false);
      setZonesVisible(tourBackup.showZones !== false);
      toggleSidebar(false);
      toggleInspector(false);
    }
    if (step.prepare) step.prepare();
    renderTourTextOnly();
    $("tourOverlay").classList.remove("is-hidden");
    requestAnimationFrame(() => {
      ensureStepInView(getStepTargetElements(step), step.scrollAlign || "center", false, 14);
      positionTourStep(step, false);
    });
    scheduleTour(() => {
      realignTour(false);
    }, 200);
    scheduleTour(() => {
      realignTour(true);
    }, 360);
    if (step.demo) step.demo();
  }

  function replayTourDemo() {
    if (!tourActive) return;
    goToTourStep(tourStepIndex);
  }

  function startTour() {
    closeCustomSelect();
    $("tourWelcomeBackdrop")?.classList.add("is-hidden");
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "1");
    } catch (_e) {}

    const shell = $("appShell");
    const hadCollapsed = shell.classList.contains("sidebar-collapsed") || shell.classList.contains("inspector-collapsed");
    if (!tourActive) {
      tourBackup = {
        fieldId: state.activeFieldId,
        sortBy: state.sortBy,
        view: state.activeView,
        tab: state.activeTab,
        theme: state.theme,
        basemap: state.basemap,
        showLabels: state.showLabels,
        showZones: state.showZones,
        priorityMode: state.priorityMode,
        weights: deepClone(state.weights),
        planSequence: deepClone(state.planSequence),
        useCoverCrop: state.useCoverCrop,
        coverCropId: state.coverCropId,
        useNoTill: state.useNoTill,
        overrides: deepClone(state.overrides),
        fieldPlans: captureFieldPlans(),
        sidebarCollapsed: shell.classList.contains("sidebar-collapsed"),
        inspectorCollapsed: shell.classList.contains("inspector-collapsed"),
        inspectorScroll: getInspectorScroller()?.scrollTop || 0,
        windowScroll: window.scrollY || 0
      };
    }

    tourActive = true;
    shell.classList.add("tour-active");
    setWorkspaceView("workspace");
    toggleSidebar(false);
    toggleInspector(false);
    scheduleTour(() => {
      if (!tourActive) return;
      if (map) map.invalidateSize();
      goToTourStep(0);
    }, hadCollapsed ? 250 : 80);
  }

  function closeTour() {
    clearTourTimers();
    tourTargetsOverride = null;
    toggleLeftNav(false);
    closeTourPopupOnly();
    tourActive = false;
    $("appShell")?.classList.remove("tour-active");
    $("tourSpotlight")?.classList.remove("is-instant");
    $("tourOverlay")?.classList.add("is-hidden");
    $("tourWelcomeBackdrop")?.classList.add("is-hidden");
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "1");
    } catch (_e) {}

    if (tourBackup) {
      const saved = tourBackup;
      restoreTourBackupState(saved.tab || "climate");
      setWorkspaceView(saved.view || "workspace");
      toggleSidebar(saved.sidebarCollapsed);
      toggleInspector(saved.inspectorCollapsed);
      setInspectorScrollTop(saved.inspectorScroll || 0, false);
      window.scrollTo({ top: saved.windowScroll || 0, behavior: "auto" });
      tourBackup = null;
    }
  }

  function openTourWelcome() {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "1");
    } catch (_e) {}
    $("tourWelcomeBackdrop")?.classList.remove("is-hidden");
  }

  function initTour() {
    $("tourWelcomeStartBtn")?.addEventListener("click", startTour);
    $("tourWelcomeSkipBtn")?.addEventListener("click", closeTour);
    $("tourWelcomeBackdrop")?.addEventListener("click", (ev) => {
      if (ev.target === $("tourWelcomeBackdrop")) closeTour();
    });
    $("tourCloseBtn")?.addEventListener("click", closeTour);
    $("tourPrevBtn")?.addEventListener("click", () => goToTourStep(tourStepIndex - 1));
    $("tourNextBtn")?.addEventListener("click", () => {
      if (tourStepIndex >= TOUR_STEPS.length - 1) closeTour();
      else goToTourStep(tourStepIndex + 1);
    });
    $("tourReplayBtn")?.addEventListener("click", replayTourDemo);

    document.addEventListener("keydown", (ev) => {
      if (!$("tourWelcomeBackdrop")?.classList.contains("is-hidden") && ev.key === "Escape") {
        closeTour();
        return;
      }
      if (!tourActive) return;
      if (ev.key === "Escape") closeTour();
      else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        if (tourStepIndex >= TOUR_STEPS.length - 1) closeTour();
        else goToTourStep(tourStepIndex + 1);
      } else if (ev.key === "ArrowLeft" && tourStepIndex > 0) {
        ev.preventDefault();
        goToTourStep(tourStepIndex - 1);
      }
    });

    let tourScrollRaf = 0;
    document.addEventListener("scroll", (ev) => {
      if (!tourActive || tourScrollRaf || performance.now() < tourTransitionUntil) return;
      const targets = getStepTargetElements(TOUR_STEPS[tourStepIndex]);
      const src = ev.target;
      const isPageScroll = src === document || src === document.documentElement || src === document.body;
      if (!isPageScroll && (!(src instanceof Element) || !targets.some((el) => src === el || src.contains(el)))) return;
      tourScrollRaf = requestAnimationFrame(() => {
        tourScrollRaf = 0;
        realignTour(true);
      });
    }, { capture: true, passive: true });

    window.addEventListener("resize", () => {
      realignTour(true);
    });

    let done = false;
    try {
      done = localStorage.getItem(TOUR_STORAGE_KEY) === "1";
    } catch (_e) {}
    const forceWelcome = window.location.search.includes("welcome=1");
    if (!done || forceWelcome) {
      setTimeout(() => {
        if (!tourActive) openTourWelcome();
      }, 480);
    }
  }

  function init() {
    applyTheme(state.theme, false);
    initCustomSelects();
    applyStaticTranslations();
    populateStaticSelects();
    loadStoredFields();
    initMap();
    bindEvents();
    if (window.innerWidth <= 900) {
      toggleSidebar(true);
    }
    selectField(state.activeFieldId, true);
    initTour();
    setTimeout(() => {
      hydratePortfolioAndZonesTelemetry();
    }, 900);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
