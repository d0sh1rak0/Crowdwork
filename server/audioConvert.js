/**
 * Normalize browser MediaRecorder blobs to 16kHz mono WAV for Groq Whisper.
 * Fixes "Audio file is too short" when WebM has bytes but broken duration metadata.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

/**
 * @param {Buffer} inputBuffer
 * @param {string} [extHint] e.g. webm, m4a, ogg
 * @returns {Promise<{ buffer: Buffer, mimeType: string, filename: string, durationHint?: number }>}
 */
export async function toWhisperWav(inputBuffer, extHint = "webm") {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crowdwork-audio-"));
  const safeExt = String(extHint || "webm").replace(/[^a-z0-9]/gi, "") || "webm";
  const inPath = path.join(tmpDir, `in-${id}.${safeExt}`);
  const outPath = path.join(tmpDir, `out-${id}.wav`);

  try {
    await fs.writeFile(inPath, inputBuffer);

    // -analyzeduration/-probesize help with short MediaRecorder fragments
    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-analyzeduration",
      "100M",
      "-probesize",
      "100M",
      "-i",
      inPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      outPath,
    ]);

    const wav = await fs.readFile(outPath);
    if (wav.length < 100) {
      throw new Error("Converted WAV is empty — recorder produced no PCM frames.");
    }

    // Prefer finding the 'data' chunk (ffmpeg may insert LIST/INFO before data).
    // Fallback: assume PCM payload ≈ file size minus a small header.
    let dataBytes = 0;
    for (let i = 12; i < Math.min(wav.length - 8, 512); i++) {
      if (
        wav[i] === 0x64 &&
        wav[i + 1] === 0x61 &&
        wav[i + 2] === 0x74 &&
        wav[i + 3] === 0x61
      ) {
        dataBytes = wav.readUInt32LE(i + 4);
        break;
      }
    }
    if (!dataBytes) dataBytes = Math.max(0, wav.length - 78);
    const durationSec = dataBytes / (16000 * 2);

    return {
      buffer: wav,
      mimeType: "audio/wav",
      filename: "recording.wav",
      durationSec,
    };
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
