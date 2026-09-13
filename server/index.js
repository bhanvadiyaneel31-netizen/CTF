require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const { Server } = require('socket.io');

const { router: playerRouter } = require('./routes/player');
const adminRouter = require('./routes/admin');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});
app.set('io', io);

app.use(
  helmet({
    contentSecurityPolicy: false, // keep simple for a small static frontend; tighten if you add a CDN
  })
);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ---- API routes ----
app.use(playerRouter);
app.use(adminRouter);

// ---- Static frontend ----
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// QR entry points: /q/1 .. /q/6 all serve the same player app shell.
// The client reads the QR number from the URL itself.
app.get('/q/:qrId', (req, res) => {
  const qrId = parseInt(req.params.qrId, 10);
  if (![1, 2, 3, 4, 5, 6].includes(qrId)) {
    return res.status(404).send('Unknown QR code.');
  }
  res.sendFile(path.join(PUBLIC_DIR, 'player.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Small helper endpoint so the admin dashboard can print real QR URLs.
app.get('/api/config', (req, res) => {
  const base = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
  res.json({
    publicAppUrl: base.replace(/\/$/, ''),
    qrUrls: [1, 2, 3, 4, 5, 6].map((n) => `${base.replace(/\/$/, '')}/q/${n}`),
  });
});

io.on('connection', () => {
  // No per-socket state needed: all real-time events are broadcast globally
  // and clients always re-fetch authoritative state from the REST API.
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`QR Relay Showdown server listening on port ${PORT}`);
  console.log(`Public URL: ${process.env.PUBLIC_APP_URL || '(not set - using request host)'}`);
});
