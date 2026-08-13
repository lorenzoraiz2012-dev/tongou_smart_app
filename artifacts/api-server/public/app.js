const refreshButton = document.querySelector("#refresh-button");
const toggleButton = document.querySelector("#toggle-button");
const toggleLabel = document.querySelector("#toggle-label");
const statusPill = document.querySelector("#status-pill");
const deviceId = document.querySelector("#device-id");
const lastUpdated = document.querySelector("#last-updated");
const message = document.querySelector("#message");
const connection = document.querySelector("#connection");
const connectionLabel = document.querySelector("#connection-label");

let isOn = false;

function setMessage(text = "") {
  message.hidden = !text;
  message.textContent = text;
}

function setConnection(state, label) {
  connection.classList.toggle("is-online", state === "online");
  connection.classList.toggle("is-error", state === "error");
  connectionLabel.textContent = label;
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
  isOn = Boolean(data.isOn);
  toggleButton.disabled = false;
  toggleButton.classList.toggle("is-on", isOn);
  toggleButton.setAttribute("aria-pressed", String(isOn));
  toggleLabel.textContent = isOn ? "Acceso" : "Spento";
  statusPill.textContent = isOn ? "Online · acceso" : "Online · spento";
  statusPill.classList.toggle("on", isOn);
  deviceId.textContent = data.deviceId ? `ID · ${data.deviceId}` : "Dispositivo Tuya";
  lastUpdated.textContent = formatTime(data.updatedAt);
}

async function request(url, options) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Risposta non valida dal server.");
  return data;
}

async function loadStatus() {
  refreshButton.disabled = true;
  toggleButton.disabled = true;
  setMessage("");
  setConnection("loading", "Connessione in corso");
  try {
    const data = await request("/api/device/status");
    render(data);
    setConnection("online", "Tuya online");
  } catch (error) {
    statusPill.textContent = "Non disponibile";
    setConnection("error", "Connessione assente");
    setMessage(error.message);
  } finally {
    refreshButton.disabled = false;
    if (!message.textContent) toggleButton.disabled = false;
  }
}

async function toggle() {
  toggleButton.disabled = true;
  refreshButton.disabled = true;
  setMessage("");
  toggleLabel.textContent = "Aggiornamento…";
  try {
    const data = await request("/api/device/toggle", {
      method: "POST",
      body: JSON.stringify({ state: !isOn }),
    });
    render(data);
    setConnection("online", "Tuya online");
  } catch (error) {
    render({ isOn, updatedAt: new Date().toISOString() });
    setConnection("error", "Connessione assente");
    setMessage(error.message);
  } finally {
    refreshButton.disabled = false;
    toggleButton.disabled = false;
  }
}

refreshButton.addEventListener("click", loadStatus);
toggleButton.addEventListener("click", toggle);
loadStatus();
