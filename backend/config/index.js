import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadJsonConfig(filename) {
  const filePath = path.join(__dirname, filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function getPipelineConfig() {
  return loadJsonConfig('pipeline.config.json');
}

export function getProductSizes() {
  return loadJsonConfig('product-sizes.json');
}

export function getTrendsSeed() {
  return loadJsonConfig('trends.json');
}
