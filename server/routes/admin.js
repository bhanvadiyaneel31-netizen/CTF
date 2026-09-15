const express = require('express');
const db = require('../db');
const logic = require('../lib/gameLogic');
const { issueAdminToken, requireAdmin, ADMIN_COOKIE } = require('../auth');

const router = express.Router();

router.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return res.status(500).json({ error: 'Server misconfigured: ADMIN_PASSWORD is not set.' });
  }
  if (password !== expected) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const token = issueAdminToken();
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12,
  });
  res.json({ ok: true });
});

router.post('/api/admin/logout', requireAdmin, (req, res) => {
  res.clearCookie(ADMIN_COOKIE);
  res.json({ ok: true });
});

router.get('/api/admin/session', requireAdmin, (req, res) => res.json({ ok: true }));

function questionCounts() {
  const rows = db
    .prepare('SELECT qrId, COUNT(*) as taken FROM teams GROUP BY qrId')
    .all();
  const map = {};
  for (let i = 1; i <= 6; i++) map[i] = 0;
  for (const r of rows) map[r.qrId] = r.taken;
  return map;
}

router.get('/api/admin/overview', requireAdmin, (req, res) => {
  const game = logic.getGame();
  const totalTeams = db.prepare('SELECT COUNT(*) c FROM teams').get().c;
  const counts = questionCounts();
  const questions = db.prepare('SELECT qrId, questionText, correctAnswer, updatedAt FROM questions ORDER BY qrId').all();
  res.json({
    game,
    totalTeams,
    perQrCounts: counts,
    teamsPerQr: logic.TEAMS_PER_QR,
    questions,
  });
});

router.get('/api/admin/teams', requireAdmin, (req, res) => {
  const teams = db
    .prepare(
      `SELECT teamId, player1Name, player2Name, qrId, registeredAt, status, attemptsUsed, successfulAt, globalRank
       FROM teams ORDER BY
         CASE WHEN globalRank IS NULL THEN 1 ELSE 0 END, globalRank ASC, registeredAt ASC`
    )
    .all();
  res.json({ teams });
});

router.get('/api/admin/team/:teamId', requireAdmin, (req, res) => {
  const team = logic.getTeamByTeamId(req.params.teamId);
  if (!team) return res.status(404).json({ error: 'Team not found.' });
  const attempts = db
    .prepare('SELECT attemptNumber, submittedAnswer, isCorrect, submittedAt FROM attempts WHERE teamId = ? ORDER BY attemptNumber ASC')
    .all(team.teamId);
  const question = logic.getQuestionFull(team.qrId);
  res.json({ team, attempts, correctAnswer: question.correctAnswer, questionText: question.questionText });
});

router.put('/api/admin/questions/:qrId', requireAdmin, (req, res) => {
  const qrId = parseInt(req.params.qrId, 10);
  if (![1, 2, 3, 4, 5, 6].includes(qrId)) return res.status(400).json({ error: 'Invalid QR id.' });
  const { questionText, correctAnswer } = req.body || {};
  try {
    const q = logic.updateQuestion(qrId, questionText, correctAnswer);
    res.json({ question: q });
  } catch (e) {
    const status = e.statusCode || 500;
    if (status === 500) console.error(e);
    res.status(status).json({ error: e.message || 'Could not update question.' });
  }
});

router.post('/api/admin/start', requireAdmin, (req, res) => {
  try {
    const game = logic.startGame();
    const io = req.app.get('io');
    io.emit('game:started');
    res.json({ game });
  } catch (e) {
    const status = e.statusCode || 500;
    if (status === 500) console.error(e);
    res.status(status).json({ error: e.message || 'Could not start game.' });
  }
});

router.post('/api/admin/end', requireAdmin, (req, res) => {
  try {
    const game = logic.endGame();
    const io = req.app.get('io');
    io.emit('leaderboard:update');
    io.emit('game:finished', { successfulCount: game.successfulCount });
    res.json({ game });
  } catch (e) {
    const status = e.statusCode || 500;
    if (status === 500) console.error(e);
    res.status(status).json({ error: e.message || 'Could not end game.' });
  }
});

router.post('/api/admin/publish-results', requireAdmin, (req, res) => {
  const game = logic.publishResults();
  const io = req.app.get('io');
  io.emit('results:published');
  res.json({ game });
});

router.post('/api/admin/unpublish-results', requireAdmin, (req, res) => {
  const game = logic.unpublishResults();
  const io = req.app.get('io');
  io.emit('results:unpublished');
  res.json({ game });
});

router.post('/api/admin/reset', requireAdmin, (req, res) => {
  logic.resetGame();
  const io = req.app.get('io');
  io.emit('game:reset');
  res.json({ ok: true });
});

router.get('/api/admin/results', requireAdmin, (req, res) => {
  const game = logic.getGame();
  const winners = db
    .prepare(`SELECT teamId, player1Name, player2Name, qrId, globalRank, successfulAt, attemptsUsed FROM teams WHERE status = 'WINNER' ORDER BY globalRank ASC`)
    .all();
  const losers = db
    .prepare(`SELECT teamId, player1Name, player2Name, qrId, attemptsUsed, status FROM teams WHERE status != 'WINNER' ORDER BY teamId ASC`)
    .all();
  res.json({ game, winners, losers });
});

module.exports = router;