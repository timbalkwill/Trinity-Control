"use strict";

const MIN_PRESET = 0;
const MAX_PRESET = 254;

function cameraHeader(cameraAddress) {
  const address = Number(cameraAddress);
  if (!Number.isInteger(address) || address < 1 || address > 7) {
    throw new RangeError("VISCA camera address must be an integer from 1 to 7");
  }
  return 0x80 + address;
}

function presetRecallCommand(cameraAddress, presetNumber) {
  const preset = Number(presetNumber);
  if (!Number.isInteger(preset) || preset < MIN_PRESET || preset > MAX_PRESET) {
    throw new RangeError(`VISCA preset number must be an integer from ${MIN_PRESET} to ${MAX_PRESET}`);
  }
  return Buffer.from([cameraHeader(cameraAddress), 0x01, 0x04, 0x3f, 0x02, preset, 0xff]);
}

function powerInquiryCommand(cameraAddress) {
  return Buffer.from([cameraHeader(cameraAddress), 0x09, 0x04, 0x00, 0xff]);
}

function splitResponseFrames(buffer) {
  const frames = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0xff) continue;
    frames.push(buffer.subarray(start, index + 1));
    start = index + 1;
  }
  return frames;
}

function classifyResponse(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < 3 || frame.at(-1) !== 0xff) return "incomplete";
  const category = frame[1] & 0xf0;
  if (category === 0x40) return "acknowledgement";
  if (category === 0x50) return "completion";
  if (category === 0x60) return "error";
  return "unknown";
}

module.exports = {
  MAX_PRESET,
  MIN_PRESET,
  classifyResponse,
  powerInquiryCommand,
  presetRecallCommand,
  splitResponseFrames
};
