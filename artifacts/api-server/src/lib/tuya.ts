import { createHash, createHmac } from "node:crypto";

type TuyaResponse<T> = {
  success: boolean;
  result?: T;
  code?: number | string;
  msg?: string;
};

type TuyaStatusItem = {
  code?: string;
  value?: unknown;
};

type TuyaTokenResult = {
  access_token: string;
  expire_time: number;
};

type TuyaDeviceStatusResult = TuyaStatusItem[];
type TuyaDeviceDetailsResult = {
  name?: string;
  online?: boolean;
};

type TuyaCommandResult = boolean;
type TuyaDeviceFunctionsResult =
  | { functions?: Array<{ code?: string }> }
  | Array<{ code?: string }>;

export type SwitchCode = "switch_1" | "switch_led" | "switch";
export type DeviceSettings = {
  screenEnabled?: boolean;
  screenBrightness?: number;
  overVoltage?: number;
  underVoltage?: number;
  overPower?: number;
  maxTemperature?: number;
};

type TuyaConfig = {
  accessId: string;
  accessSecret: string;
  endpoint: string;
  deviceId: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

export class TuyaApiError extends Error {
  readonly details: {
    httpStatus: number;
    method: string;
    path: string;
    success: boolean;
    code?: number | string;
    msg?: string;
  };

  constructor(message: string, details: TuyaApiError["details"]) {
    super(message);
    this.name = "TuyaApiError";
    this.details = details;
  }
}

export class TuyaCommandError extends Error {
  readonly attempts: Array<{
    code: SwitchCode;
    error: ReturnType<typeof getTuyaErrorDetails>;
  }>;

  constructor(attempts: TuyaCommandError["attempts"]) {
    super("All supported Tuya switch command codes failed");
    this.name = "TuyaCommandError";
    this.attempts = attempts;
  }
}

function getConfig(): TuyaConfig {
  const missing = [
    ["TUYA_ACCESS_ID", process.env.TUYA_ACCESS_ID],
    ["TUYA_ACCESS_SECRET", process.env.TUYA_ACCESS_SECRET],
    ["TUYA_ENDPOINT", process.env.TUYA_ENDPOINT],
    ["TUYA_DEVICE_ID", process.env.TUYA_DEVICE_ID],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing Tuya configuration: ${missing.join(", ")}`);
  }

  return {
    accessId: process.env.TUYA_ACCESS_ID!,
    accessSecret: process.env.TUYA_ACCESS_SECRET!,
    endpoint: normalizeEndpoint(process.env.TUYA_ENDPOINT!),
    deviceId: process.env.TUYA_DEVICE_ID!,
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmacSha256(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex").toUpperCase();
}

function normalizeEndpoint(value: string) {
  const trimmed = value.trim();
  const markdownLink = trimmed.match(
    /^\u2060?\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/,
  );
  return (markdownLink?.[2] ?? trimmed).replace(/\/+$/, "");
}

function getRequestSign({
  accessId,
  accessToken,
  timestamp,
  method,
  path,
  body,
  secret,
}: {
  accessId: string;
  accessToken: string;
  timestamp: string;
  method: string;
  path: string;
  body: string;
  secret: string;
}) {
  const contentHash = sha256(body);
  const stringToSign = `${method.toUpperCase()}\n${contentHash}\n\n${path}`;
  return hmacSha256(
    `${accessId}${accessToken}${timestamp}${stringToSign}`,
    secret,
  );
}

function getTokenSign(
  accessId: string,
  timestamp: string,
  path: string,
  secret: string,
) {
  const stringToSign = `GET\n${sha256("")}\n\n${path}`;
  return hmacSha256(`${accessId}${timestamp}${stringToSign}`, secret);
}

async function readTuyaResponse<T>(
  response: Response,
  method: string,
  path: string,
): Promise<TuyaResponse<T>> {
  const rawBody = await response.text();
  let payload: TuyaResponse<T>;

  try {
    payload = JSON.parse(rawBody) as TuyaResponse<T>;
  } catch {
    payload = {
      success: false,
      msg: rawBody.slice(0, 1000) || "Tuya returned an empty response",
    };
  }

  if (!response.ok || payload.success !== true) {
    throw new TuyaApiError(
      payload.msg ?? `Tuya returned HTTP ${response.status}`,
      {
        httpStatus: response.status,
        method,
        path,
        success: payload.success,
        code: payload.code,
        msg: payload.msg,
      },
    );
  }
  return payload;
}

function getTuyaErrorDetails(error: unknown) {
  if (error instanceof TuyaApiError) {
    return error.details;
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: String(error) };
}

async function getAccessToken(config: TuyaConfig) {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.value;
  }

  const timestamp = String(now);
  const path = "/v1.0/token?grant_type=1";
  const response = await fetch(`${config.endpoint}${path}`, {
    headers: {
      client_id: config.accessId,
      sign: getTokenSign(config.accessId, timestamp, path, config.accessSecret),
      t: timestamp,
      sign_method: "HMAC-SHA256",
    },
  });
  const payload = await readTuyaResponse<TuyaTokenResult>(
    response,
    "GET",
    path,
  );

  if (!payload.result?.access_token) {
    throw new Error(
      payload.msg ?? `Tuya token request failed (${payload.code ?? "unknown"})`,
    );
  }

  cachedToken = {
    value: payload.result.access_token,
    expiresAt: now + payload.result.expire_time * 1000,
  };
  return cachedToken.value;
}

async function tuyaRequest<T>(
  config: TuyaConfig,
  accessToken: string,
  method: "GET" | "POST",
  path: string,
  body = "",
) {
  const timestamp = String(Date.now());
  const response = await fetch(`${config.endpoint}${path}`, {
    method,
    headers: {
      client_id: config.accessId,
      sign: getRequestSign({
        accessId: config.accessId,
        accessToken,
        timestamp,
        method,
        path,
        body,
        secret: config.accessSecret,
      }),
      t: timestamp,
      sign_method: "HMAC-SHA256",
      access_token: accessToken,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body || undefined,
  });
  const payload = await readTuyaResponse<T>(response, method, path);
  return payload.result as T;
}

async function getSupportedSwitchCodes(
  config: TuyaConfig,
  accessToken: string,
) {
  const functions = await getSupportedFunctionCodes(config, accessToken);
  return ["switch_1", "switch_led", "switch"].filter((code) =>
    functions.has(code),
  ) as SwitchCode[];
}

async function getSupportedFunctionCodes(
  config: TuyaConfig,
  accessToken: string,
) {
  const path = `/v1.0/devices/${encodeURIComponent(config.deviceId)}/functions`;
  const result = await tuyaRequest<TuyaDeviceFunctionsResult>(
    config,
    accessToken,
    "GET",
    path,
  );
  const functions = Array.isArray(result) ? result : (result.functions ?? []);
  return new Set(
    functions.map((item) => item.code).filter(Boolean) as string[],
  );
}

function numericValue(value: unknown) {
  if (typeof value === "string") {
    // Gestisce sia base64 che stringhe numeriche
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMetric(statuses: TuyaStatusItem[], codes: string[]) {
  const item = statuses.find(
    (status) => status.code && codes.includes(status.code),
  );
  return item ? numericValue(item.value) : null;
}

function normalizeMetric(
  value: number | null,
  divisor: number,
  threshold: number,
) {
  if (value === null) return null;
  return value > threshold ? value / divisor : value;
}

// Funzione per decodificare il campo binario/hex "phase_a" usato dai contatori Tuya
function parsePhaseA(rawVal: unknown) {
  if (typeof rawVal !== "string")
    return { voltage: null, current: null, power: null };

  try {
    let buf: Buffer;
    if (/^[A-Za-z0-9+/=]+$/.test(rawVal) && rawVal.length % 4 === 0) {
      buf = Buffer.from(rawVal, "base64");
    } else {
      buf = Buffer.from(rawVal, "hex");
    }

    // Struttura standard Tuya 8 byte: Voltage (2b), Current (3b), Power (3b)
    if (buf.length >= 8) {
      const voltage = buf.readUInt16BE(0) / 10;
      const current = ((buf[2] << 16) | (buf[3] << 8) | buf[4]) / 1000;
      const power = (buf[5] << 16) | (buf[6] << 8) | buf[7]; // Inizia al byte 5!

      return { voltage, current, power };
    }
    // Fallback per modelli a 6 byte
    else if (buf.length >= 6) {
      const voltage = buf.readUInt16BE(0) / 10;
      const current = buf.readUInt16BE(2) / 1000;
      const power = buf.readUInt16BE(4);

      return { voltage, current, power };
    }
  } catch (err) {
    console.error("Errore decodifica phase_a:", err);
  }

  return { voltage: null, current: null, power: null };
}

function parseDeviceMetrics(statuses: TuyaStatusItem[]) {
  console.log("Dati grezzi da Tuya:", JSON.stringify(statuses, null, 2)); // <-- Aggiungi questo log

  // 1. Estraiamo la frequenza (supply_frequency)
  const freqItem = statuses.find((s) => s.code === "supply_frequency");
  const frequency = freqItem ? numericValue(freqItem.value) : null;

  // 2. Estraiamo il consumo totale (forward_energy_total)
  const energyItem = statuses.find((s) => s.code === "forward_energy_total");
  const rawEnergy = energyItem ? numericValue(energyItem.value) : null;

  // 3. Estraiamo Tensione, Corrente e Potenza dal pacchetto phase_a
  const phaseAItem = statuses.find((s) => s.code === "phase_a");
  const phaseMetrics = parsePhaseA(phaseAItem?.value);

  return {
    voltage: phaseMetrics.voltage,
    current: phaseMetrics.current,
    power: phaseMetrics.power,
    frequency: frequency ? frequency / 100 : null,
    temperature: null,
    totalKwh: rawEnergy !== null ? rawEnergy / 100 : null,
  };
}

function parseSwitchValue(statuses: TuyaStatusItem[]) {
  const preferred =
    statuses.find((item) => item.code === "switch_1") ??
    statuses.find((item) => item.code === "switch_led") ??
    statuses.find((item) => item.code?.startsWith("switch"));

  if (!preferred || typeof preferred.value !== "boolean") {
    throw new Error(
      "Tuya device status does not contain a supported switch value",
    );
  }
  return {
    value: preferred.value,
    code: (preferred.code === "switch_led"
      ? "switch_led"
      : "switch_1") as SwitchCode,
  };
}

export async function getDeviceState() {
  const config = getConfig();
  const token = await getAccessToken(config);
  const statusPath = `/v1.0/devices/${encodeURIComponent(config.deviceId)}/status`;
  const detailsPath = `/v1.0/devices/${encodeURIComponent(config.deviceId)}`;
  const [statuses, details] = await Promise.all([
    tuyaRequest<TuyaDeviceStatusResult>(config, token, "GET", statusPath),
    tuyaRequest<TuyaDeviceDetailsResult>(
      config,
      token,
      "GET",
      detailsPath,
    ).catch(() => null),
  ]);

  // STAMPA DEI LOG GREZZI NELLA SHELL PER VERIFICA
  console.log("=== LOG STATUS TUYA DISPOSITIVO ===");
  console.log(JSON.stringify(statuses, null, 2));

  const switchState = parseSwitchValue(statuses);
  const metrics = parseDeviceMetrics(statuses);
  const updatedAt = new Date().toISOString();
  return {
    isOn: switchState.value,
    switchCode: switchState.code,
    deviceId: config.deviceId,
    deviceName: details?.name ?? "Interruttore principale",
    online: details?.online ?? true,
    metrics,
    consumption: {
      totalKwh: metrics.totalKwh,
      history:
        metrics.totalKwh === null
          ? []
          : [{ timestamp: updatedAt, kwh: metrics.totalKwh }],
    },
    statusCodes: statuses
      .map((status) => status.code)
      .filter((code): code is string => Boolean(code)),
    updatedAt,
  };
}

const settingCommands = [
  {
    key: "screenEnabled",
    codes: [
      "switch_dysplay",
      "light",
      "screen_switch",
      "display_switch",
      "screen_on",
      "led_switch",
      "switch_led",
    ],
  },
  {
    key: "screenBrightness",
    codes: [
      "screen_brightness",
      "display_brightness",
      "bright_value",
      "backlight_brightness",
    ],
  },
  {
    key: "overVoltage",
    codes: [
      "overvoltage_protect",
      "over_voltage",
      "overvoltage",
      "overvoltage_set",
    ],
  },
  {
    key: "underVoltage",
    codes: [
      "undervoltage_protect",
      "under_voltage",
      "undervoltage",
      "undervoltage_set",
    ],
  },
  {
    key: "overPower",
    codes: [
      "overpower_protect",
      "over_power",
      "overcurrent_protect",
      "overpower_set",
    ],
  },
  {
    key: "maxTemperature",
    codes: [
      "overtemperature_protect",
      "over_temperature",
      "overtemperature",
      "overtemp_set",
    ],
  },
] as const;

export async function setDeviceSettings(settings: DeviceSettings) {
  const config = getConfig();
  const token = await getAccessToken(config);
  const supportedFunctions = await getSupportedFunctionCodes(config, token);
  const commands: Array<{ code: string; value: boolean | number }> = [];
  const applied: string[] = [];
  const unsupported: string[] = [];

  for (const setting of settingCommands) {
    const value = settings[setting.key];
    if (value === undefined) continue;
    const code = setting.codes.find((candidate) =>
      supportedFunctions.has(candidate),
    );
    if (!code) {
      unsupported.push(setting.key);
      continue;
    }
    commands.push({ code, value });
    applied.push(setting.key);
  }

  if (commands.length === 0) {
    return { applied, unsupported, sent: false };
  }

  const body = JSON.stringify({ commands });
  await tuyaRequest<TuyaCommandResult>(
    config,
    token,
    "POST",
    `/v1.0/devices/${encodeURIComponent(config.deviceId)}/commands`,
    body,
  );

  return { applied, unsupported, sent: true };
}

export async function setDeviceState(
  isOn: boolean,
  preferredSwitchCode: SwitchCode = "switch_1",
) {
  const config = getConfig();
  const token = await getAccessToken(config);

  let discoveredCodes: SwitchCode[] = [];
  const attempts: TuyaCommandError["attempts"] = [];
  try {
    discoveredCodes = await getSupportedSwitchCodes(config, token);
  } catch (error) {
    attempts.push({
      code: preferredSwitchCode,
      error: getTuyaErrorDetails(error),
    });
  }

  const candidates = [
    preferredSwitchCode,
    ...discoveredCodes,
    "switch_1",
    "switch_led",
    "switch",
  ].filter((code, index, all) => all.indexOf(code) === index) as SwitchCode[];
  const path = `/v1.0/devices/${encodeURIComponent(config.deviceId)}/commands`;

  for (const switchCode of candidates) {
    const body = JSON.stringify({
      commands: [{ code: switchCode, value: isOn }],
    });

    try {
      const result = await tuyaRequest<TuyaCommandResult>(
        config,
        token,
        "POST",
        path,
        body,
      );

      if (!result) {
        throw new TuyaApiError("Tuya did not confirm the command", {
          httpStatus: 200,
          method: "POST",
          path,
          success: true,
          code: "COMMAND_NOT_CONFIRMED",
          msg: "Tuya returned success=false for the command result",
        });
      }

      return {
        isOn,
        switchCode,
        deviceId: config.deviceId,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      attempts.push({
        code: switchCode,
        error: getTuyaErrorDetails(error),
      });
    }
  }

  throw new TuyaCommandError(attempts);
}
