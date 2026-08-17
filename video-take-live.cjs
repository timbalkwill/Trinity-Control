"use strict";

function createVideoTakeLive({ commands, videoRouter } = {}) {
  const inFlight = new Map();
  async function perform(videoSourceId) {
    const source = videoRouter.getSource(videoSourceId);
    if (!source) throw Object.assign(new Error(`Unknown Video Source: ${videoSourceId}`), { code: "VIDEO_SOURCE_UNAVAILABLE" });
    const cameraId = source.sourceType === "camera" ? source.cameraDeviceId : null;
    const prepared = cameraId ? commands.getPreparedMotion(cameraId) : null;
    const alreadyLive = videoRouter.getStatus().liveSourceId === videoSourceId;
    if (prepared) await commands.setPreparedMotionStatus(cameraId, "taking-live", alreadyLive ? "MOTION COMMANDING" : "TAKING LIVE");
    if (!alreadyLive) {
      try { await videoRouter.takeSource(videoSourceId); }
      catch (error) {
        if (prepared) await commands.setPreparedMotionStatus(cameraId, "ready", "READY / START COMMANDED", `Switcher failed: ${error.message}`);
        throw error;
      }
    }
    if (videoRouter.getStatus().liveSourceId !== videoSourceId) throw Object.assign(new Error("Switcher confirmation was not received"), { code: "SWITCHER_CONFIRMATION_MISSING" });
    if (!prepared) return { videoSourceId, switched: !alreadyLive, motion: null };
    await commands.setPreparedMotionStatus(cameraId, "motion-commanding", "MOTION COMMANDING");
    try {
      const state = await commands.runCameraMotion(cameraId, prepared.shotId);
      return { videoSourceId, switched: !alreadyLive, motion: "commanded", state };
    } catch (error) {
      await commands.setPreparedMotionStatus(cameraId, "ready", "READY / START COMMANDED", `Motion failed: ${error.message}`);
      throw error;
    }
  }
  function takeSource(videoSourceId) {
    if (inFlight.has(videoSourceId)) return inFlight.get(videoSourceId);
    const transaction = perform(videoSourceId).finally(() => inFlight.delete(videoSourceId));
    inFlight.set(videoSourceId, transaction);
    return transaction;
  }
  return Object.freeze({ takeSource });
}

module.exports = { createVideoTakeLive };
