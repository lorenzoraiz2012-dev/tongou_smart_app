import { Router, type IRouter } from "express";
import {
  getDeviceState,
  setDeviceState,
  setDeviceSettings,
  TuyaApiError,
  TuyaCommandError,
} from "../lib/tuya";

const router: IRouter = Router();
async function sendPushNotification(title: string, message: string) {
  try {
    await fetch("https://ntfy.sh/tuya-allarmi-elettrici-9988", {
      // Sostituisci con il tuo canale ntfy
      method: "POST",
      headers: {
        Title: title,
        Priority: "high",
        Tags: "warning",
      },
      body: message,
    });
  } catch (error) {
    console.error("Errore invio notifica push:", error);
  }
}
router.get("/device/status", async (req, res) => {
  try {
    const data = await getDeviceState();
    req.log.info(
      { tuyaStatusCodes: data.statusCodes },
      "Tuya status codes received",
    );
    const { statusCodes: _statusCodes, ...publicData } = data;

    // --- CONTROLLO SOGLIE E INVIO NOTIFICA PUSH ---
    // Adatta i nomi delle proprietà (es. publicData.voltage o publicData.metrics.voltage) in base alla struttura reale
    // Cast sicuro per far leggere i campi a TypeScript
    const dataAny = publicData as any;
    const voltage = dataAny.voltage ?? dataAny.metrics?.voltage;
    const power = dataAny.power ?? dataAny.metrics?.power;
    const temperature = dataAny.temperature ?? dataAny.metrics?.temperature;
    if (voltage && voltage > 200) {
      await sendPushNotification(
        "⚡ Sovratensione!",
        `Tensione rilevata: ${voltage} V`,
      );
    } else if (voltage && voltage < 200 && voltage > 0) {
      await sendPushNotification(
        "⚠️ Sottotensione!",
        `Tensione rilevata: ${voltage} V`,
      );
    }

    if (power && power > 3000) {
      await sendPushNotification(
        "🚨 Sovra-alimentazione!",
        `Assorbimento: ${power} W`,
      );
    }

    if (temperature && temperature > 70) {
      await sendPushNotification(
        "🔥 Temperatura Alta!",
        `Temperatura: ${temperature} °C`,
      );
    }
    // ----------------------------------------------

    res.json(publicData);
  } catch (error) {
    req.log.error({ err: error }, "Unable to read Tuya device status");
    res.status(502).json({
      error: "DEVICE_STATUS_UNAVAILABLE",
      message: "Impossibile leggere lo stato dell'interruttore dal cloud Tuya.",
    });
  }
});
router.post("/device/toggle", async (req, res) => {
  try {
    let nextState = req.body?.state;
    if (nextState !== undefined && typeof nextState !== "boolean") {
      res.status(400).json({
        error: "INVALID_STATE",
        message: "state deve essere un valore booleano.",
      });
      return;
    }

    const current = await getDeviceState();
    if (nextState === undefined) nextState = !current.isOn;

    res.json(await setDeviceState(nextState, current.switchCode));
  } catch (error) {
    if (error instanceof TuyaCommandError) {
      req.log.error(
        {
          err: error,
          tuyaAttempts: error.attempts,
        },
        "Unable to toggle Tuya device: all command codes failed",
      );
    } else if (error instanceof TuyaApiError) {
      req.log.error(
        {
          err: error,
          tuya: error.details,
        },
        "Unable to toggle Tuya device: Tuya API error",
      );
    } else {
      req.log.error({ err: error }, "Unable to toggle Tuya device");
    }
    res.status(502).json({
      error: "DEVICE_TOGGLE_FAILED",
      message: "Impossibile cambiare lo stato dell'interruttore tramite Tuya.",
    });
  }
});

router.post("/device/settings", async (req, res) => {
  try {
    const settings = req.body ?? {};
    const numericFields = [
      "screenBrightness",
      "overVoltage",
      "underVoltage",
      "overPower",
      "maxTemperature",
    ];
    for (const field of numericFields) {
      if (
        settings[field] !== undefined &&
        (typeof settings[field] !== "number" ||
          !Number.isFinite(settings[field]))
      ) {
        res.status(400).json({
          error: "INVALID_SETTING",
          message: `${field} deve essere un numero valido.`,
        });
        return;
      }
    }
    if (
      settings.screenEnabled !== undefined &&
      typeof settings.screenEnabled !== "boolean"
    ) {
      res.status(400).json({
        error: "INVALID_SETTING",
        message: "screenEnabled deve essere booleano.",
      });
      return;
    }

    res.json(await setDeviceSettings(settings));
  } catch (error) {
    if (error instanceof TuyaApiError) {
      req.log.error(
        { err: error, tuya: error.details },
        "Unable to apply Tuya device settings",
      );
    } else {
      req.log.error({ err: error }, "Unable to apply Tuya device settings");
    }
    res.status(502).json({
      error: "DEVICE_SETTINGS_FAILED",
      message: "Impossibile applicare le impostazioni al dispositivo Tuya.",
    });
  }
});

export default router;
