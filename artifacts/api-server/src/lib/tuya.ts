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

type TuyaCommandResult = boolean;
type SwitchCode = "switch_1" | "switch_led";

type TuyaConfig = {
  accessId: string;
  accessSecret: string;
  endpoint: string;
  deviceId: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

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

async function readTuyaResponse<T>(response: Response): Promise<TuyaResponse<T>> {
  const payload = (await response.json()) as TuyaResponse<T>;
  if (!response.ok) {
    throw new Error(payload.msg ?? `Tuya returned HTTP ${response.status}`);
  }
  return payload;
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
      sign: getTokenSign(
        config.accessId,
        timestamp,
        path,
        config.accessSecret,
      ),
      t: timestamp,
      sign_method: "HMAC-SHA256",
    },
  });
  const payload = await readTuyaResponse<TuyaTokenResult>(response);

  if (!payload.success || !payload.result?.access_token) {
    throw new Error(payload.msg ?? `Tuya token request failed (${payload.code ?? "unknown"})`);
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
  const payload = await readTuyaResponse<T>(response);

  if (!payload.success) {
    throw new Error(payload.msg ?? `Tuya request failed (${payload.code ?? "unknown"})`);
  }
  return payload.result as T;
}

function parseSwitchValue(statuses: TuyaStatusItem[]) {
  const preferred =
    statuses.find((item) => item.code === "switch_1") ??
    statuses.find((item) => item.code === "switch_led") ??
    statuses.find((item) => item.code?.startsWith("switch"));

  if (!preferred || typeof preferred.value !== "boolean") {
    throw new Error("Tuya device status does not contain a supported switch value");
  }
  return {
    value: preferred.value,
    code: (preferred.code === "switch_led" ? "switch_led" : "switch_1") as SwitchCode,
  };
}

export async function getDeviceState() {
  const config = getConfig();
  const token = await getAccessToken(config);
  const statuses = await tuyaRequest<TuyaDeviceStatusResult>(
    config,
    token,
    "GET",
    `/v1.0/devices/${encodeURIComponent(config.deviceId)}/status`,
  );

  const switchState = parseSwitchValue(statuses);
  return {
    isOn: switchState.value,
    switchCode: switchState.code,
    deviceId: config.deviceId,
    updatedAt: new Date().toISOString(),
  };
}

export async function setDeviceState(
  isOn: boolean,
  switchCode: SwitchCode = "switch_1",
) {
  const config = getConfig();
  const token = await getAccessToken(config);
  const body = JSON.stringify({
    commands: [{ code: switchCode, value: isOn }],
  });

  const result = await tuyaRequest<TuyaCommandResult>(
    config,
    token,
    "POST",
    `/v1.0/devices/${encodeURIComponent(config.deviceId)}/commands`,
    body,
  );

  if (!result) {
    throw new Error("Tuya did not confirm the command");
  }

  return {
    isOn,
    deviceId: config.deviceId,
    updatedAt: new Date().toISOString(),
  };
}
