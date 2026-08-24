"use strict";

function createPreparedMotionTakeLive({ commands, atemService } = {}) {
  const inFlight = new Map();

  async function perform(cameraDeviceId) {
    const prepared = commands.getPreparedMotion(cameraDeviceId);
    const alreadyLive = atemService.getStatus()?.liveCameraId === cameraDeviceId;
    if (prepared) await commands.setPreparedMotionStatus(cameraDeviceId, "taking-live", alreadyLive ? "MOTION COMMANDING" : "TAKING LIVE");
    if (!alreadyLive) {
      try { await atemService.takeLive(cameraDeviceId); }
      catch (error) {
        if (prepared) await commands.setPreparedMotionStatus(cameraDeviceId, "ready", "READY / START COMMANDED", `ATEM switch failed: ${error.message}`);
        throw error;
      }
    }
    if (atemService.getStatus()?.liveCameraId !== cameraDeviceId) {
      if (prepared) await commands.setPreparedMotionStatus(cameraDeviceId, "ready", "READY / START COMMANDED", "ATEM PROGRAM confirmation was not received");
      throw Object.assign(new Error("ATEM did not confirm the camera on PROGRAM"), { code: "ATEM_CONFIRMATION_MISSING" });
    }
    if (!prepared) return { cameraDeviceId, switched: !alreadyLive, motion: null };
    await commands.setPreparedMotionStatus(cameraDeviceId, "motion-commanding", "MOTION COMMANDING");
    try {
      const state = await commands.runCameraMotion(cameraDeviceId, prepared.shotId);
      return { cameraDeviceId, switched: !alreadyLive, motion: "commanded", state };
    } catch (error) {
      await commands.setPreparedMotionStatus(cameraDeviceId, "ready", "READY / START COMMANDED", `Motion failed: ${error.message}`);
      throw error;
    }
  }

  function takeLive(cameraDeviceId) {
    if (inFlight.has(cameraDeviceId)) return inFlight.get(cameraDeviceId);
    const transaction = perform(cameraDeviceId).finally(() => inFlight.delete(cameraDeviceId));
    inFlight.set(cameraDeviceId, transaction);
    return transaction;
  }

  return Object.freeze({ takeLive });
}

module.exports = { createPreparedMotionTakeLive };
