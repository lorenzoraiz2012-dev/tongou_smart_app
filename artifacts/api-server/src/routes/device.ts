import { Router, type IRouter } from "express";
import { getDeviceState, setDeviceState } from "../lib/tuya";

const router: IRouter = Router();

router.get("/device/status", async (req, res) => {
  try {
    res.json(await getDeviceState());
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
    req.log.error({ err: error }, "Unable to toggle Tuya device");
    res.status(502).json({
      error: "DEVICE_TOGGLE_FAILED",
      message: "Impossibile cambiare lo stato dell'interruttore tramite Tuya.",
    });
  }
});

export default router;
