import * as ImageManipulator from 'expo-image-manipulator';
import type { TfliteModel } from 'react-native-fast-tflite';
import { ensureModel, resetModelCache } from './modelManager';
import type {
  Category,
  ConfidenceBand,
  ModelMetadata,
  Prediction,
  Severity,
} from '../types';

/**
 * On-device classification with react-native-fast-tflite.
 *
 * IMPORTANT: this module loads a native Nitro module. It only works in a
 * development/production build, NOT in Expo Go, which is why the
 * react-native-fast-tflite config plugin lives in app.json. Every public
 * function here fails soft (returns null / throws a catchable error) so
 * callers can fall back to the server's POST /classify.
 *
 * ImageNet normalization math (constants below) mirrors torchvision's
 * MobileNetV3 preprocessing, which the server used to train/export
 * civic-classifier.tflite (mean/std per RGB channel).
 */

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

const SEVERE_CATEGORIES: ReadonlySet<Category> = new Set(['pothole']);

export interface LocalClassification {
  predictions: Prediction[];
  band: ConfidenceBand;
  severity: Severity;
  disclaimer: string;
  modelVersion: string;
}

// The native module is loaded lazily so importing this file (e.g. in Jest)
// never touches native code until classification is attempted.
let loadModel:
  | ((
      source: { url: string },
      delegates: Array<'nnapi' | 'android-gpu'>,
    ) => Promise<TfliteModel>)
  | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  loadModel = require('react-native-fast-tflite').loadTensorflowModel;
} catch {
  loadModel = null;
}

let model: TfliteModel | null = null;
let metadata: ModelMetadata | null = null;
let loadInFlight: Promise<boolean> | null = null;

/** Matches the server's services/classifier.confidence_band. */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.4) return 'medium';
  return 'low';
}

/**
 * Mirrors the server's heuristic severity estimate for local results.
 *
 * The reason states the rule that produced the level, not a claim about the
 * world: the app has no data on how often a pothole hurts someone, so it does
 * not pretend to.
 */
export function severityEstimate(
  category: Category,
  confidence: number,
): Severity {
  if (SEVERE_CATEGORIES.has(category) && confidence >= 0.6) {
    return {
      level: 'high',
      reason: 'Potholes are rated high whenever the photo is clear.',
    };
  }
  if (
    (category === 'streetlight' || category === 'sidewalk damage') &&
    confidence >= 0.5
  ) {
    return {
      level: 'moderate',
      reason: 'Rated moderate for this category when the photo is clear.',
    };
  }
  if (confidence >= 0.75) {
    return {
      level: 'moderate',
      reason:
        'Rated moderate: a confident match, but not one of the high-risk categories.',
    };
  }
  return {
    level: 'low',
    reason: 'Rated low: the model is unsure of the category. Check it before sending.',
  };
}

function stableSoftmax(logits: ArrayLike<number>): number[] {
  const values = Array.from(logits);
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/**
 * Decode raw model outputs into a probability per label.
 *
 * Handles the common export variants: quantized uint8/int8 output (the
 * week-2 plan targets int8 dynamic-range quantization) and plain float
 * logits or probabilities.
 */
export function outputsToProbabilities(
  buffer: ArrayBuffer,
  labelCount: number,
): number[] {
  const bytes = new Uint8Array(buffer);
  const looksQuantized =
    bytes.byteLength === labelCount || bytes.byteLength === labelCount * 4;

  if (looksQuantized && bytes.byteLength === labelCount) {
    // One quantized value per label. Dequantization scale/zero-point are not
    // exposed on the nitro Tensor type, so normalize the raw values into a
    // distribution; argmax (and therefore the top category) is unaffected.
    const sum = bytes.reduce((a, b) => a + b, 0);
    if (sum > 0) return Array.from(bytes, (b) => b / sum);
    return new Array(labelCount).fill(1 / labelCount);
  }

  const floats = new Float32Array(buffer);
  const scores = Array.from(floats.slice(0, labelCount));
  // Misaligned bytes (e.g. int8 output read as float32) produce NaN/Infinity.
  // Throw so the caller falls back to the server instead of rendering NaN%.
  if (scores.some((v) => !Number.isFinite(v))) {
    throw new Error('non-finite model output');
  }
  const allProbabilities = scores.every((v) => v >= 0 && v <= 1);
  const total = scores.reduce((a, b) => a + b, 0);
  if (allProbabilities && total > 0.99 && total < 1.01) return scores;
  return stableSoftmax(scores);
}

/**
 * Decode the photo to raw RGBA at the model's input size.
 *
 * `manipulateAsync` base64 is the *encoded* JPEG, not pixels — feeding those
 * bytes to the model produces garbage (and NaN logits). So the JPEG is
 * decoded here with a plain-JS decoder: 224² is small enough that this costs
 * well under 100 ms, and it keeps the whole path on device.
 */
async function readPixels(
  imageUri: string,
  width: number,
  height: number,
): Promise<Uint8Array> {
  // ImageManipulator returns base64 only in native builds; in Jest the mock
  // omits it and we fail soft into the server fallback.
  const result = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width, height } }],
    { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 1 },
  );
  if (!result.base64) {
    throw new Error('ImageManipulator did not return base64 pixel data');
  }
  const { toByteArray } = await import('base64-js');
  const { decode } = await import('jpeg-js');
  const image = decode(toByteArray(result.base64), {
    useTArray: true,
    formatAsRGBA: true,
  });
  if (image.width !== width || image.height !== height) {
    throw new Error(
      `decoded ${image.width}x${image.height}, expected ${width}x${height}`,
    );
  }
  return image.data;
}

/**
 * Pack decoded pixels into the model's input tensor.
 *
 * The layout has to come from the model, not from an assumption: the exported
 * TFLite graph is NHWC ([1,224,224,3]) even though the training code and the
 * metadata were written channel-first. Reading the shape and writing pixels in
 * the matching order is the difference between "pothole 100%" and garbage —
 * a scrambled tensor still produces a confident-looking softmax.
 *
 * Exported for tests; callers should use classifyLocal.
 */
export interface InputDimensions {
  height: number;
  width: number;
  /** True when the model expects [batch, height, width, channels]. */
  nhwc: boolean;
}

/**
 * Read the input geometry from the model's declared shape.
 *
 * NHWC ([1,224,224,3]) and NCHW ([1,3,224,224]) are both valid TFLite layouts
 * and exporters disagree, so never assume one — the wrong assumption scrambles
 * the image into a confident-looking wrong answer.
 */
export function inputDimensions(meta: ModelMetadata): InputDimensions {
  const shape = meta.input.shape;
  const nhwc = shape.length === 4 && shape[3] === 3 && shape[1] !== 3;
  return {
    nhwc,
    height: nhwc ? shape[1] : shape[2],
    width: nhwc ? shape[2] : shape[3],
  };
}

export function toFloatTensor(
  pixels: Uint8Array,
  meta: ModelMetadata,
): ArrayBuffer {
  const { height, width, nhwc } = inputDimensions(meta);
  const channels = 3;
  const pixelsPerChannel = width * height;
  const expectedRgb = pixelsPerChannel * channels;
  // 4 bytes per pixel → RGBA (JPEG decode may also emit 3-byte RGB).
  const bytesPerPixel = pixels.byteLength === expectedRgb ? channels : 4;

  const out = new Float32Array(expectedRgb);
  const normalize = meta.input.normalization !== 'none';
  const plane = pixelsPerChannel;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * bytesPerPixel;
      const spatial = y * width + x;
      for (let c = 0; c < channels; c += 1) {
        const mean = normalize ? IMAGENET_MEAN[c] : 0;
        const std = normalize ? IMAGENET_STD[c] : 1;
        const value = (pixels[src + c] / 255 - mean) / std;
        out[nhwc ? spatial * channels + c : c * plane + spatial] = value;
      }
    }
  }
  return out.buffer;
}

/**
 * Load the cached model into memory. Returns false when the model file or
 * the native runtime is unavailable. A model whose binary fails to load is
 * treated as corrupt and evicted so the next launch re-downloads it.
 */
export async function ensureLoaded(): Promise<boolean> {
  if (model && metadata) return true;
  if (!loadModel) return false;
  if (loadInFlight) return loadInFlight;

  loadInFlight = (async (): Promise<boolean> => {
    const cachedModel = await ensureModel();
    if (!cachedModel || !loadModel) return false;
    try {
      model = await loadModel({ url: cachedModel.uri }, ['nnapi']);
      metadata = cachedModel.metadata;
      return true;
    } catch {
      await resetModelCache(true);
      model = null;
      metadata = null;
      return false;
    }
  })();

  try {
    return await loadInFlight;
  } finally {
    loadInFlight = null;
  }
}

/**
 * Classify a photo with the on-device model. Returns null when on-device
 * inference is unavailable (model missing, native module absent, decode
 * failure); the caller must fall back to the server.
 */
export async function classifyLocal(
  imageUri: string,
): Promise<LocalClassification | null> {
  try {
    if (!(await ensureLoaded()) || !model || !metadata) return null;

    const { height, width } = inputDimensions(metadata);
    const pixels = await readPixels(imageUri, width, height);
    const input = toFloatTensor(pixels, metadata);

    const outputs = await model.run([input]);
    if (!outputs.length) return null;

    const probabilities = outputsToProbabilities(
      outputs[0],
      metadata.labels.length,
    );

    const predictions: Prediction[] = metadata.labels
      .map((label, i) => ({
        category: label,
        confidence: probabilities[i] ?? 0,
      }))
      .sort((a, b) => b.confidence - a.confidence);
    if (!predictions.length) return null;
    // A NaN or out-of-range score means the decode went wrong; hand the photo
    // to the server rather than showing a number we cannot stand behind.
    if (
      !predictions.every(
        (p) =>
          Number.isFinite(p.confidence) &&
          p.confidence >= 0 &&
          p.confidence <= 1,
      )
    ) {
      return null;
    }

    const top = predictions[0];
    return {
      predictions,
      band: confidenceBand(top.confidence),
      severity: severityEstimate(top.category, top.confidence),
      disclaimer: 'On-device AI estimate — please verify',
      modelVersion: metadata.version,
    };
  } catch {
    // Any failure here must never break the reporting flow.
    return null;
  }
}

/** Test hook: reset the loaded model. */
export function unloadLocalModel(): void {
  model = null;
  metadata = null;
}
