import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { getDb } from './db/init.js';
import { getPipelineConfig, getProductSizes } from './config/index.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Initializes the schema on boot (CREATE TABLE IF NOT EXISTS, so safe to call every start).
getDb();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/config/pipeline', (req, res) => {
  res.json(getPipelineConfig());
});

app.get('/api/config/product-sizes', (req, res) => {
  res.json(getProductSizes());
});

// Stub: list jobs with their artwork. Module wiring (upload -> job creation) comes in a later step.
app.get('/api/jobs', (req, res) => {
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT jobs.*, artworks.file_path AS artwork_file_path
       FROM jobs
       JOIN artworks ON artworks.id = jobs.artwork_id
       ORDER BY jobs.created_at DESC`
    )
    .all();
  res.json(jobs);
});

app.listen(PORT, () => {
  console.log(`ProEtsy backend listening on http://localhost:${PORT}`);
});
