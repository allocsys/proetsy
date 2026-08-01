import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLACEMENT_LAYER,
  detectTemplateKind,
  findPlacementLayer,
  flattenPaintOrder,
  resolvePlacementBounds,
} from './psd-template.js';

describe('detectTemplateKind', () => {
  it('detects .psd templates', () => {
    expect(detectTemplateKind('templates/framed-wall.psd')).toBe('psd');
    expect(detectTemplateKind('templates/framed-wall.PSD')).toBe('psd');
  });

  it('treats everything else as a flat template', () => {
    expect(detectTemplateKind('templates/8x10-frame.png')).toBe('flat');
    expect(detectTemplateKind('templates/square.jpg')).toBe('flat');
    expect(detectTemplateKind('templates/no-extension')).toBe('flat');
  });
});

describe('findPlacementLayer', () => {
  const artworkLayer = { name: 'artwork', left: 10, top: 10, right: 90, bottom: 90 };
  const backgroundLayer = { name: 'background', left: 0, top: 0, right: 100, bottom: 100 };

  it('finds a top-level layer by name', () => {
    expect(findPlacementLayer([backgroundLayer, artworkLayer], 'artwork')).toBe(artworkLayer);
  });

  it('finds a layer nested inside a group', () => {
    const group = { name: 'frame group', children: [backgroundLayer, artworkLayer] };
    expect(findPlacementLayer([group], 'artwork')).toBe(artworkLayer);
  });

  it('finds a layer nested several groups deep', () => {
    const nested = { name: 'outer', children: [{ name: 'inner', children: [artworkLayer] }] };
    expect(findPlacementLayer([nested], 'artwork')).toBe(artworkLayer);
  });

  it('returns null when no layer matches', () => {
    expect(findPlacementLayer([backgroundLayer], 'artwork')).toBeNull();
  });

  it('returns null for an empty/undefined layer list', () => {
    expect(findPlacementLayer(undefined, 'artwork')).toBeNull();
    expect(findPlacementLayer([], 'artwork')).toBeNull();
  });

  it('is case-sensitive', () => {
    expect(findPlacementLayer([artworkLayer], 'Artwork')).toBeNull();
  });

  it('respects the documented default placement layer name', () => {
    expect(DEFAULT_PLACEMENT_LAYER).toBe('artwork');
  });
});

describe('resolvePlacementBounds', () => {
  it('computes width/height from left/top/right/bottom', () => {
    const layer = { name: 'artwork', left: 20, top: 30, right: 220, bottom: 180 };
    expect(resolvePlacementBounds(layer)).toEqual({ left: 20, top: 30, width: 200, height: 150 });
  });

  it('defaults missing left/top to 0', () => {
    const layer = { name: 'artwork', right: 100, bottom: 50 };
    expect(resolvePlacementBounds(layer)).toEqual({ left: 0, top: 0, width: 100, height: 50 });
  });

  it('throws for a layer with zero-size bounds', () => {
    const layer = { name: 'empty', left: 10, top: 10, right: 10, bottom: 10 };
    expect(() => resolvePlacementBounds(layer)).toThrow(/empty or invalid bounds/);
  });

  it('throws for a layer with inverted/negative bounds', () => {
    const layer = { name: 'broken', left: 100, top: 100, right: 50, bottom: 50 };
    expect(() => resolvePlacementBounds(layer)).toThrow(/empty or invalid bounds/);
  });
});

describe('flattenPaintOrder', () => {
  it('yields leaf layers with a canvas, in array order', () => {
    const a = { name: 'a', canvas: {} };
    const b = { name: 'b', canvas: {} };
    expect(flattenPaintOrder([a, b])).toEqual([a, b]);
  });

  it('skips group layers themselves but includes their children in place', () => {
    const bg = { name: 'bg', canvas: {} };
    const art = { name: 'artwork', canvas: {} };
    const group = { name: 'frame group', children: [bg, art] };
    const fg = { name: 'fg', canvas: {} };
    expect(flattenPaintOrder([group, fg])).toEqual([bg, art, fg]);
  });

  it('skips layers with no canvas (e.g. adjustment/text layers not yet supported)', () => {
    const noCanvas = { name: 'text layer' };
    const withCanvas = { name: 'art', canvas: {} };
    expect(flattenPaintOrder([noCanvas, withCanvas])).toEqual([withCanvas]);
  });

  it('skips hidden layers', () => {
    const hidden = { name: 'hidden', canvas: {}, hidden: true };
    const visible = { name: 'visible', canvas: {} };
    expect(flattenPaintOrder([hidden, visible])).toEqual([visible]);
  });

  it('a hidden group hides its children even if their own hidden flag is false', () => {
    const child = { name: 'child', canvas: {}, hidden: false };
    const group = { name: 'group', hidden: true, children: [child] };
    expect(flattenPaintOrder([group])).toEqual([]);
  });

  it('returns an empty array for an empty/undefined layer list', () => {
    expect(flattenPaintOrder(undefined)).toEqual([]);
    expect(flattenPaintOrder([])).toEqual([]);
  });
});
