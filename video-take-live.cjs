"use strict";

function createVideoTakeLive({ commands, videoRouter, traceFactory = () => null } = {}) {
  const inFlight = new Map();
  async function perform(videoSourceId, options = {}) {
    const trace = options.trace || traceFactory({ sourceId: videoSourceId, origin: options.origin });
    const source = videoRouter.getSource(videoSourceId);
    if (!source) throw Object.assign(new Error(`Unknown Video Source: ${videoSourceId}`), { code: "VIDEO_SOURCE_UNAVAILABLE" });
    const cameraId = source.sourceType === "camera" ? source.cameraDeviceId : null;
    const prepared = cameraId ? commands.getPreparedMotion(cameraId) : null;
    const alreadyLive = videoRouter.getStatus().liveSourceId === videoSourceId;
    if (!alreadyLive) {
      const switching = videoRouter.takeSource(videoSourceId, { trace });
      switching.catch(() => {});
      if (prepared) await commands.setPreparedMotionStatus(cameraId, "taking-live", "TAKING LIVE");
      try { await switching; }
      catch (error) {
        trace?.finish("switch-failed");
        const ambiguous = new Set(["ATEM_CONFIRMATION_FAILED", "ATEM_TRANSITION_TIMEOUT", "SWITCHER_CONFIRMATION_MISSING"]).has(error?.code);
        if (prepared && ambiguous && typeof commands.cancelPreparedMotion === "function") await commands.cancelPreparedMotion(cameraId);
        else if (prepared) await commands.setPreparedMotionStatus(cameraId, "ready", "READY / START COMMANDED", `Switcher failed: ${error.message}`);
        throw error;
      }
    }
    if (videoRouter.getStatus().liveSourceId !== videoSourceId) throw Object.assign(new Error("Switcher confirmation was not received"), { code: "SWITCHER_CONFIRMATION_MISSING" });
    if (!prepared) { trace?.finish("switched"); return { videoSourceId, switched: !alreadyLive, motion: null }; }
    await commands.setPreparedMotionStatus(cameraId, "motion-commanding", "MOTION COMMANDING");
    try {
      const state = await commands.runCameraMotion(cameraId, prepared.shotId);
      trace?.finish("motion-commanded");
      return { videoSourceId, switched: !alreadyLive, motion: "commanded", state };
    } catch (error) {
      trace?.finish("motion-failed");
      await commands.setPreparedMotionStatus(cameraId, "ready", "READY / START COMMANDED", `Motion failed: ${error.message}`);
      throw error;
    }
  }
  function takeSource(videoSourceId, options = {}) {
    if (inFlight.has(videoSourceId)) return inFlight.get(videoSourceId);
    const transaction = perform(videoSourceId, options).finally(() => inFlight.delete(videoSourceId));
    inFlight.set(videoSourceId, transaction);
    return transaction;
  }
  return Object.freeze({ takeSource });
}

module.exports = { createVideoTakeLive };
