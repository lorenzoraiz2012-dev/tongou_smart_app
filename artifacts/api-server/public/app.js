const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const SETTINGS_KEY = "smart-control-settings-v2";
const HISTORY_KEY = "smart-control-history-v2";
const defaultSettings = {
  deviceName: "Interruttore principale",
  energyPrice: "",
  notificationSound: "standard",
  screenEnabled: true,
  screenBrightness: 3,
  overVoltage: 250,
  underVoltage: 200,
  overPower: 3000,
  maxTemperature: 70,
};

const state = {
  data: null,
  settings: loadJson(SETTINGS_KEY, defaultSettings),
  history: loadJson(HISTORY_KEY, []),
  chart: null,
  range: "day",
  loaderCount: 0,
  toastTimer: null,
  alertTimes: {},
};

function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function setLoading(loading) {
  state.loaderCount = Math.max(0, state.loaderCount + (loading ? 1 : -1));
  $("#loader").classList.toggle("is-visible", state.loaderCount > 0);
  $("#refresh-button").disabled = state.loaderCount > 0;
}

async function withLoader(task) {
  setLoading(true);
  try {
    return await task();
  } finally {
    setLoading(false);
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.message || "Richiesta non riuscita.");
  return payload;
}

function showToast(text) {
  const toast = $("#toast");
  toast.hidden = false;
  toast.textContent = text;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value)))
    return "—";
  return Number(value).toLocaleString("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function render(data) {
  state.data = data;
  const settings = state.settings;
  const metrics = data.metrics || {};
  const isOn = Boolean(data.isOn);
  const deviceName =
    settings.deviceName || data.deviceName || "Interruttore principale";

  $("#device-name").textContent = deviceName;
  $("#online-label").textContent = data.online === false ? "Offline" : "Online";
  $("#online-badge").classList.toggle("is-offline", data.online === false);
  $("#switch-state").textContent = isOn ? "Acceso" : "Spento";
  $("#switch-code").textContent = data.switchCode
    ? `CODE · ${data.switchCode}`
    : "—";
  $("#power-toggle").disabled = false;
  $("#power-toggle").classList.toggle("is-on", isOn);
  $("#power-toggle").setAttribute("aria-pressed", String(isOn));
  $("#power-label").textContent = isOn ? "Spegni" : "Accendi";
  $("#metric-voltage").textContent = formatNumber(metrics.voltage, 1);
  $("#metric-current").textContent = formatNumber(metrics.current, 2);
  $("#metric-power").textContent = formatNumber(metrics.power, 1);
  $("#metric-frequency").textContent = formatNumber(metrics.frequency, 1);
  $("#metric-temperature").textContent = formatNumber(metrics.temperature, 1);
  $("#total-kwh").textContent = formatNumber(data.consumption?.totalKwh, 2);
  $("#last-updated").textContent = formatTime(data.updatedAt);

  checkThresholds(metrics);
  updateCost();
  updateChart();
}

function recordHistory(data) {
  const kwh = data.consumption?.totalKwh;
  if (kwh === null || kwh === undefined) return;
  const last = state.history[state.history.length - 1];
  if (
    !last ||
    Date.now() - new Date(last.timestamp).getTime() > 30_000 ||
    last.kwh !== kwh
  ) {
    state.history.push({
      timestamp: data.updatedAt || new Date().toISOString(),
      kwh,
    });
    state.history = state.history.slice(-2500);
    saveJson(HISTORY_KEY, state.history);
  }
}

function updateCost() {
  const price = Number(state.settings.energyPrice);
  const total = Number(state.data?.consumption?.totalKwh);
  const value = $("#cost-value");
  const caption = $("#cost-caption");
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(total)) {
    value.textContent = "— €";
    caption.textContent = "Imposta il prezzo per kWh";
    return;
  }
  value.textContent = `${(price * total).toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
  caption.textContent = `${price.toLocaleString("it-IT")} €/kWh`;
}

function filteredHistory() {
  const now = Date.now();
  const durations = {
    day: 86_400_000,
    month: 2_592_000_000,
    year: 31_536_000_000,
  };
  const min = state.range === "total" ? 0 : now - durations[state.range];
  return state.history.filter(
    (item) => new Date(item.timestamp).getTime() >= min,
  );
}

function updateChart() {
  const canvas = $("#consumption-chart");
  if (!canvas || typeof Chart === "undefined") return;
  const items = filteredHistory();
  const labels = items.map((item) =>
    new Date(item.timestamp).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
    }),
  );
  const values = items.map((item) => item.kwh);
  if (!state.chart) {
    state.chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data: values,
            borderColor: "#72d7ff",
            backgroundColor: "rgba(82, 146, 255, .14)",
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 5,
            pointBackgroundColor: "#72d7ff",
            fill: true,
            tension: 0.38,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { displayColors: false },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: "#52627d",
              font: { family: "DM Mono", size: 9 },
              maxTicksLimit: 6,
            },
          },
          y: {
            beginAtZero: false,
            grid: { color: "rgba(144,177,224,.1)" },
            ticks: { color: "#52627d", font: { family: "DM Mono", size: 9 } },
          },
        },
      },
    });
  } else {
    state.chart.data.labels = labels;
    state.chart.data.datasets[0].data = values;
    state.chart.update();
  }
}

async function loadStatus(showLoader = true) {
  try {
    const data = showLoader
      ? await withLoader(() => request("/api/device/status"))
      : await request("/api/device/status");
    recordHistory(data);
    render(data);
  } catch (error) {
    $("#online-label").textContent = "Offline";
    $("#online-badge").classList.add("is-offline");
    showToast(error.message);
  }
}

async function togglePower() {
  if (!state.data) return;
  const button = $("#power-toggle");
  button.disabled = true;
  try {
    const data = await withLoader(() =>
      request("/api/device/toggle", {
        method: "POST",
        body: JSON.stringify({ state: !state.data.isOn }),
      }),
    );
    state.data = { ...state.data, ...data };
    recordHistory(state.data);
    render(state.data);
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

function switchTab(tabName) {
  $$(".tab").forEach((tab) =>
    tab.classList.toggle("is-active", tab.dataset.tab === tabName),
  );
  $("#home-panel").hidden = tabName !== "home";
  $("#settings-panel").hidden = tabName !== "settings";
  $("#home-panel").classList.toggle("is-visible", tabName === "home");
  $("#settings-panel").classList.toggle("is-visible", tabName === "settings");
  if (tabName === "settings") fillSettings();
}

function fillSettings() {
  const s = state.settings;
  $("#setting-device-name").value = s.deviceName || "";
  $("#setting-energy-price").value = s.energyPrice ?? "";
  $("#setting-sound").value = s.notificationSound || "standard";
  $("#setting-screen-enabled").checked = s.screenEnabled !== false;
  $("#setting-brightness").value = s.screenBrightness || 3;
  $("#brightness-output").textContent = `${$("#setting-brightness").value} / 5`;
  $("#setting-over-voltage").value = s.overVoltage ?? "";
  $("#setting-under-voltage").value = s.underVoltage ?? "";
  $("#setting-over-power").value = s.overPower ?? "";
  $("#setting-max-temperature").value = s.maxTemperature ?? "";
}

function readNumber(id) {
  const value = Number($(id).value);
  return Number.isFinite(value) ? value : undefined;
}

async function saveSettings(event) {
  event.preventDefault();
  const next = {
    deviceName:
      $("#setting-device-name").value.trim() || "Interruttore principale",
    energyPrice: $("#setting-energy-price").value,
    notificationSound: $("#setting-sound").value,
    screenEnabled: $("#setting-screen-enabled").checked,
    screenBrightness: Number($("#setting-brightness").value),
    overVoltage: readNumber("#setting-over-voltage"),
    underVoltage: readNumber("#setting-under-voltage"),
    overPower: readNumber("#setting-over-power"),
    maxTemperature: readNumber("#setting-max-temperature"),
  };
  state.settings = next;
  saveJson(SETTINGS_KEY, next);
  try {
    const response = await withLoader(() =>
      request("/api/device/settings", {
        method: "POST",
        body: JSON.stringify(next),
      }),
    );
    render(state.data || {});
    showToast(
      response.unsupported?.length
        ? "Salvate. Alcune funzioni non sono supportate dal dispositivo."
        : "Impostazioni salvate.",
    );
  } catch (error) {
    showToast(error.message);
  }
}

function playSound(kind = state.settings.notificationSound) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const frequencies = {
    standard: [660],
    cyber: [880, 440, 880],
    soft: [520, 660],
  };
  const notes = frequencies[kind] || frequencies.standard;
  oscillator.type = kind === "soft" ? "sine" : "triangle";
  oscillator.frequency.setValueAtTime(notes[0], context.currentTime);
  notes.slice(1).forEach((frequency, index) => {
    oscillator.frequency.setValueAtTime(
      frequency,
      context.currentTime + (index + 1) * 0.12,
    );
  });
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.11, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    context.currentTime + Math.max(0.35, notes.length * 0.14),
  );
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + Math.max(0.4, notes.length * 0.15));
}

async function testNotification() {
  if ("Notification" in window && Notification.permission === "default")
    await Notification.requestPermission();
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Smart Control", { body: "Notifica di prova ricevuta." });
  }
  playSound();
  showToast("Notifica di prova inviata.");
}

function checkThresholds(metrics) {
  const checks = [
    [
      "voltage-high",
      metrics.voltage !== null &&
        metrics.voltage > Number(state.settings.overVoltage),
      "Sovratensione rilevata",
    ],
    [
      "voltage-low",
      metrics.voltage !== null &&
        metrics.voltage < Number(state.settings.underVoltage),
      "Sottotensione rilevata",
    ],
    [
      "power-high",
      metrics.power !== null &&
        metrics.power > Number(state.settings.overPower),
      "Potenza oltre soglia",
    ],
    [
      "temperature-high",
      metrics.temperature !== null &&
        metrics.temperature > Number(state.settings.maxTemperature),
      "Temperatura oltre soglia",
    ],
  ];
  for (const [key, triggered, text] of checks) {
    if (!triggered) continue;
    const last = state.alertTimes[key] || 0;
    if (Date.now() - last < 300_000) continue;
    state.alertTimes[key] = Date.now();
    showToast(text);
    playSound();
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Avviso Smart Control", { body: text });
    }
  }
}

function exportCsv() {
  const rows = [
    ["timestamp", "kwh"],
    ...filteredHistory().map((item) => [item.timestamp, item.kwh]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.join(";")).join("\n")}`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  link.download = "smart-control-consumi.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function resetHistory() {
  state.history = [];
  saveJson(HISTORY_KEY, []);
  updateChart();
  $("#reset-dialog").close();
  showToast("Storico consumi azzerato.");
}

$$(".tab").forEach((tab) =>
  tab.addEventListener("click", () => switchTab(tab.dataset.tab)),
);
$$("[data-tab-target]").forEach((button) =>
  button.addEventListener("click", () => switchTab(button.dataset.tabTarget)),
);
$$(".filter").forEach((filter) =>
  filter.addEventListener("click", () => {
    $$(".filter").forEach((item) =>
      item.classList.toggle("is-active", item === filter),
    );
    state.range = filter.dataset.range;
    updateChart();
  }),
);
$("#refresh-button").addEventListener("click", loadStatus);
$("#power-toggle").addEventListener("click", togglePower);
$("#settings-form").addEventListener("submit", saveSettings);
$("#setting-brightness").addEventListener("input", (event) => {
  $("#brightness-output").textContent = `${event.target.value} / 5`;
});
$("#preview-sound").addEventListener("click", () =>
  playSound($("#setting-sound").value),
);
$("#test-notification").addEventListener("click", testNotification);
$("#reset-consumption").addEventListener("click", () =>
  $("#reset-dialog").showModal(),
);
$("#cancel-reset").addEventListener("click", () => $("#reset-dialog").close());
$("#confirm-reset").addEventListener("click", resetHistory);

fillSettings();
loadStatus(true);
setInterval(() => loadStatus(false), 10000);
