// Vercel Serverless Function. Storage: Upstash Redis (Vercel Marketplace integration).
const crypto = require('crypto');
const A = 'abcdefghjkmnpqrstuvwxyz23456789';
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = async (cmd) => {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOK }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'redis');
  return j.result;
};
const rid = (n) => [...crypto.randomBytes(n)].map((b) => A[b % A.length]).join('');
const cl = (s, n) => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f<>]/g, '').trim().slice(0, n);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { id, token, action } = req.query;
    const body = req.body || {};
    if (req.method === 'POST' && !id) {
      const d = {
        creatorName: cl(body.creatorName, 40), recipientName: cl(body.recipientName, 40), nickname: cl(body.nickname, 40),
        greeting: cl(body.greeting, 120), message: cl(body.message, 1200),
        dateQuestion: cl(body.dateQuestion, 160) || 'Will you go on a date with me?',
      };
      if (!d.creatorName || !d.recipientName || d.message.length < 5) return res.status(400).json({ error: 'invalid' });
      Object.assign(d, { createdAt: new Date().toISOString(), token: rid(16), response: null, respondedAt: null, reply: '' });
      for (let i = 0; i < 5; i++) {
        const nid = rid(7);
        if (await redis(['SET', 'c:' + nid, JSON.stringify(d), 'NX'])) return res.status(201).json({ id: nid, ...d });
      }
      return res.status(500).json({ error: 'id' });
    }
    if (!/^[a-z0-9]{4,12}$/i.test(id || '')) return res.status(404).json({ error: 'not found' });
    const raw = await redis(['GET', 'c:' + id]);
    if (!raw) return res.status(404).json({ error: 'not found' });
    const d = JSON.parse(raw);
    const owner = !!token && token === d.token;
    if (req.method === 'GET') {
      const { token: _t, reply, response, respondedAt, ...pub } = d;
      return res.json(owner ? { ...pub, response, respondedAt, reply } : pub); // recipients never see the owner's data
    }
    if (req.method === 'POST' && action === 'respond') {
      d.response = 'yes'; d.respondedAt = d.respondedAt || new Date().toISOString();
      const m = cl(body.reply, 300); if (m) d.reply = m;
      await redis(['SET', 'c:' + id, JSON.stringify(d), 'XX']);
      return res.json({ ok: true });
    }
    if (req.method === 'DELETE') {
      if (!owner) return res.status(403).json({ error: 'forbidden' });
      await redis(['DEL', 'c:' + id]);
      return res.json({ ok: true });
    }
    res.status(405).json({ error: 'method' });
  } catch (e) { res.status(500).json({ error: 'server' }); }
};
