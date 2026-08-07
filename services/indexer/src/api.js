const express = require('express');
const cors = require('cors');
const config = require('./config');

function createApi(db) {
  const app = express();
  app.use(cors());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/claims', async (req, res) => {
    const wallet = req.query.wallet;
    if (!wallet) {
      return res.status(400).json({ error: 'wallet query param is required' });
    }
    try {
      const claims = await db.getClaims(wallet);
      res.json({ wallet, claims });
    } catch (err) {
      res.status(500).json({ error: 'failed to fetch claims' });
    }
  });

  app.get('/stats', async (req, res) => {
    try {
      const stats = await db.getStats();
      res.json({ stats });
    } catch (err) {
      res.status(500).json({ error: 'failed to fetch stats' });
    }
  });

  app.get('/recent', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;
    try {
      const recent = await db.getRecent({ limit, offset });
      res.json({ page, limit, recent });
    } catch (err) {
      res.status(500).json({ error: 'failed to fetch recent verifications' });
    }
  });

  return app;
}

module.exports = { createApi };
