import { Router, type IRouter } from "express";
import healthRouter from "./health";
import deviceRouter from "./device";

const router: IRouter = Router();

router.use(healthRouter);
router.use(deviceRouter);

export default router;
