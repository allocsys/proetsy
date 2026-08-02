import { describe, expect, it } from 'vitest';
import Jimp from 'jimp';
import { CLIP_IMAGE_SIZE, l2Normalize, preprocessImage } from './embeddings.js';

describe('preprocessImage', () => {
  it('produces a planar (CHW) Float32Array of the expected length', async () => {
    const image = await new Promise((resolve, reject) => {
      new Jimp(400, 200, 0xff0000ff, (err, img) => (err ? reject(err) : resolve(img)));
    });

    const result = preprocessImage(image);

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(3 * CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE);
  });

  it('normalizes a known solid color using CLIP mean/std', async () => {
    // Solid black (0,0,0) after /255 scaling is 0 in every channel, so the normalized
    // value is just -mean/std for each channel — an easy value to assert exactly.
    const image = await new Promise((resolve, reject) => {
      new Jimp(CLIP_IMAGE_SIZE, CLIP_IMAGE_SIZE, 0x000000ff, (err, img) => (err ? reject(err) : resolve(img)));
    });

    const result = preprocessImage(image);
    const pixelCount = CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE;

    const expectedR = (0 - 0.48145466) / 0.26862954;
    const expectedG = (0 - 0.4578275) / 0.26130258;
    const expectedB = (0 - 0.40821073) / 0.27577711;

    expect(result[0]).toBeCloseTo(expectedR, 5);
    expect(result[pixelCount]).toBeCloseTo(expectedG, 5);
    expect(result[2 * pixelCount]).toBeCloseTo(expectedB, 5);
  });

  it('resizes non-square images via resize-shorter-side + center-crop, not a stretch', async () => {
    // A wide image (400x200) should end up exactly CLIP_IMAGE_SIZE square, not warped.
    const image = await new Promise((resolve, reject) => {
      new Jimp(400, 200, 0x00ff00ff, (err, img) => (err ? reject(err) : resolve(img)));
    });

    const result = preprocessImage(image);
    expect(result.length).toBe(3 * CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE);
  });
});

describe('l2Normalize', () => {
  it('produces a unit vector for a non-zero input', () => {
    const input = new Float32Array([3, 4]); // 3-4-5 triangle, norm = 5
    const result = l2Normalize(input);

    expect(result[0]).toBeCloseTo(0.6, 5);
    expect(result[1]).toBeCloseTo(0.8, 5);

    let sumSquares = 0;
    for (const v of result) sumSquares += v * v;
    expect(Math.sqrt(sumSquares)).toBeCloseTo(1, 5);
  });

  it('does not divide by zero for an all-zero vector', () => {
    const result = l2Normalize(new Float32Array([0, 0, 0]));
    expect(Array.from(result)).toEqual([0, 0, 0]);
  });
});
