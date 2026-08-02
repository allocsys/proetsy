import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPsd } from 'ag-psd';
import { ensurePsdCanvasInitialized } from './psd-canvas.js';
import { findPlacementLayer } from './psd-template.js';
import { writePsdFixtureTo, PSD_FIXTURE } from './__fixtures__/load-psd-fixture.js';

// Unit-level coverage for the pureimage-backed Canvas2D shim itself (ARCHITECTURE.md ->
// Module 3 -> "Template formats" -> "Canvas2D requirement"). mockup-generator.psd.test.js
// already exercises this shim indirectly, end-to-end through the full compositing
// pipeline (composeMockup -> paintPsdCanvas); these tests instead decode the committed
// PSD fixture directly via ag-psd's readPsd() and assert on the shim's own contract --
// that createCanvas()/createImageData() hand ag-psd objects with a working
// .getContext('2d') and a correctly-sized, correctly-populated flat RGBA pixel buffer --
// without going through the rest of the mockup-generation pipeline.

let tmpRoot;
let psdPath;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-psd-canvas-'));
  psdPath = path.join(tmpRoot, 'framed-wall-test.psd');
  writePsdFixtureTo(psdPath);
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ensurePsdCanvasInitialized', () => {
  it('is idempotent -- calling it repeatedly does not throw', () => {
    expect(() => {
      ensurePsdCanvasInitialized();
      ensurePsdCanvasInitialized();
      ensurePsdCanvasInitialized();
    }).not.toThrow();
  });

  it('registers hooks that let ag-psd decode a real PSD without throwing', () => {
    ensurePsdCanvasInitialized();
    const buffer = fs.readFileSync(psdPath);
    expect(() => readPsd(buffer, { useImageData: false })).not.toThrow();
  });
});

describe('decoded layer canvases (createCanvas/createImageData contract)', () => {
  let psd;

  beforeAll(() => {
    ensurePsdCanvasInitialized();
    const buffer = fs.readFileSync(psdPath);
    psd = readPsd(buffer, { useImageData: false });
  });

  it('gives every leaf layer a canvas with a working getContext("2d")', () => {
    const artwork = findPlacementLayer(psd.children, 'artwork');
    const background = findPlacementLayer(psd.children, 'background');
    const topBorder = findPlacementLayer(psd.children, 'top border');

    for (const layer of [artwork, background, topBorder]) {
      expect(layer).toBeTruthy();
      expect(layer.canvas).toBeTruthy();
      expect(typeof layer.canvas.getContext).toBe('function');
      expect(layer.canvas.getContext('2d')).toBeTruthy();
    }
  });

  it("sizes each layer canvas to match the layer's own pixel bounds", () => {
    const artwork = findPlacementLayer(psd.children, 'artwork');
    const { width, height } = PSD_FIXTURE.placementLayerBounds;

    expect(artwork.canvas.width).toBe(width);
    expect(artwork.canvas.height).toBe(height);
  });

  it('populates a flat RGBA pixel buffer of the correct length (the createImageData role)', () => {
    const artwork = findPlacementLayer(psd.children, 'artwork');
    const { width, height } = PSD_FIXTURE.placementLayerBounds;

    expect(artwork.canvas.data.length).toBe(width * height * 4);
  });

  it('decodes the background layer as fully opaque across its full canvas', () => {
    // 'background' is documented (see __fixtures__/load-psd-fixture.js) as a full-canvas
    // opaque layer -- every alpha byte should be 255, confirming actual pixel bytes made
    // it through the shim's createImageData buffer, not just a correctly-sized zeroed one.
    const background = findPlacementLayer(psd.children, 'background');
    const { data } = background.canvas;
    for (let i = 3; i < data.length; i += 4) {
      expect(data[i]).toBe(255);
    }
  });
});
