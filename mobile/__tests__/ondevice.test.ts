import {
  confidenceBand,
  outputsToProbabilities,
  severityEstimate,
  toFloatTensor,
} from '../src/lib/ondevice';
import type { ModelMetadata } from '../src/types';

// Pure-function tests for the on-device inference pipeline. The native
// module itself is mocked globally in jest.setup.ts.

describe('confidenceBand', () => {
  it('matches the server thresholds (0.75 / 0.4)', () => {
    expect(confidenceBand(0.94)).toBe('high');
    expect(confidenceBand(0.75)).toBe('high');
    expect(confidenceBand(0.6)).toBe('medium');
    expect(confidenceBand(0.4)).toBe('medium');
    expect(confidenceBand(0.39)).toBe('low');
    expect(confidenceBand(0)).toBe('low');
  });
});

describe('severityEstimate', () => {
  it('flags confident potholes as high severity', () => {
    expect(severityEstimate('pothole', 0.8).level).toBe('high');
  });

  it('flags safety categories as moderate', () => {
    expect(severityEstimate('streetlight', 0.55).level).toBe('moderate');
    expect(severityEstimate('sidewalk damage', 0.5).level).toBe('moderate');
  });

  it('keeps low-confidence results low', () => {
    expect(severityEstimate('trash', 0.3).level).toBe('low');
  });
});

describe('outputsToProbabilities', () => {
  const LABELS = 6;

  it('passes through float probability outputs unchanged', () => {
    const probs = new Float32Array([0.9, 0.04, 0.03, 0.01, 0.01, 0.01]);
    const out = outputsToProbabilities(probs.buffer, LABELS);
    expect(out[0]).toBeCloseTo(0.9, 5);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });

  it('softmaxes raw float logits and preserves argmax', () => {
    const logits = new Float32Array([0.1, 3.0, -0.5, 0.2, 1.0, -2.0]);
    const out = outputsToProbabilities(logits.buffer, LABELS);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    const argmax = out.indexOf(Math.max(...out));
    expect(argmax).toBe(1); // logits[1] was the max
  });

  it('rejects non-finite output instead of producing NaN scores', () => {
    // Reading int8 weights as float32 is the classic way to get NaN bytes;
    // the caller must fall back to the server rather than show NaN%.
    const broken = new Float32Array([NaN, 0.5, 0.2, 0.1, 0.1, 0.1]);
    expect(() => outputsToProbabilities(broken.buffer, LABELS)).toThrow(
      /non-finite/,
    );
  });

  it('normalizes quantized uint8 outputs (one byte per label)', () => {
    const quantized = new Uint8Array([230, 10, 5, 5, 3, 3]);
    const out = outputsToProbabilities(quantized.buffer, LABELS);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(out[0]).toBeGreaterThan(0.8);
    expect(out.indexOf(Math.max(...out))).toBe(0);
  });
});

describe('tensor layout', () => {
  const rgba = (r: number, g: number, b: number, count: number) => {
    const px = new Uint8Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      px[i * 4] = r;
      px[i * 4 + 1] = g;
      px[i * 4 + 2] = b;
      px[i * 4 + 3] = 255;
    }
    return px;
  };

  const meta = (
    shape: [number, number, number, number],
  ): ModelMetadata => ({
    version: 'test',
    labels: ['pothole'],
    input: { shape, dtype: 'float32', normalization: 'none' },
  });

  it('writes NHWC tensors interleaved per pixel when the model is NHWC', () => {
    // 2x2 image, one red pixel then three blue ones: the first three values
    // must be that pixel's RGB, which only happens with NHWC ordering.
    const pixels = rgba(255, 0, 0, 1).slice(0, 4);
    const rest = rgba(0, 0, 255, 3);
    const px = new Uint8Array(16);
    px.set(pixels, 0);
    px.set(rest, 4);
    const out = new Float32Array(toFloatTensor(px, meta([1, 2, 2, 3])));
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[1]).toBeCloseTo(0, 5);
    expect(out[2]).toBeCloseTo(0, 5);
    expect(out[3]).toBeCloseTo(0, 5);
    expect(out[5]).toBeCloseTo(1, 5);
  });

  it('writes NCHW tensors plane-by-plane when the model is NCHW', () => {
    const px = new Uint8Array(16);
    px.set(rgba(255, 0, 0, 1), 0);
    px.set(rgba(0, 0, 255, 3), 4);
    const out = new Float32Array(toFloatTensor(px, meta([1, 3, 2, 2])));
    // Red plane first: pixel 0 red, then three zeros.
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[1]).toBeCloseTo(0, 5);
    // Blue plane starts after the red and green planes (4 values each);
    // its first entry is pixel 0, which is red, so check pixel 1.
    expect(out[9]).toBeCloseTo(1, 5);
  });
});
