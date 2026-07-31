/**
 * Lazy-load MediaPipe Tasks Vision (Face + Pose landmarkers) from CDN.
 */

const VISION_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

let filesetPromise = null;
let facePromise = null;
let posePromise = null;

async function getFileset() {
  if (!filesetPromise) {
    filesetPromise = (async () => {
      const vision = await import(`${VISION_CDN}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(
        `${VISION_CDN}/wasm`
      );
      return { vision, fileset };
    })().catch((err) => {
      filesetPromise = null;
      throw err;
    });
  }
  return filesetPromise;
}

async function createFace(delegate) {
  const { vision, fileset } = await getFileset();
  return vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
  });
}

async function createPose(delegate) {
  const { vision, fileset } = await getFileset();
  return vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: POSE_MODEL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

/** @returns {Promise<object>} FaceLandmarker */
export async function createFaceLandmarker() {
  if (!facePromise) {
    facePromise = createFace("GPU").catch(() => {
      console.warn("[MediaPipe] Face GPU failed, retrying CPU");
      return createFace("CPU");
    });
  }
  return facePromise;
}

/** @returns {Promise<object>} PoseLandmarker */
export async function createPoseLandmarker() {
  if (!posePromise) {
    posePromise = createPose("GPU").catch(() => {
      console.warn("[MediaPipe] Pose GPU failed, retrying CPU");
      return createPose("CPU");
    });
  }
  return posePromise;
}

export function isVisionSupported() {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}
