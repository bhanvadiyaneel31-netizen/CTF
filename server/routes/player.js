const express = require('express');
const logic = require('../lib/gameLogic');

const router = express.Router();
const TEAM_COOKIE_PREFIX = 'team_session_qr'; // one cookie slot per browser is enough
const TEAM_COOKIE = 'team_session';

function setTeamCookie(res, token) {
  res.cookie(TEAM_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24, // 24h, long enough for one event
  });
}

function serializeTeamForClient(team, game, includeQuestionText) {
  const base = {
    teamId: team.teamId,
    player1: team.player1Name,
    player2: team.player2Name,
    qrId: team.qrId,
    status: team.status,
    attemptsUsed: team.attemptsUsed,
    maxAttempts: logic.MAX_ATTEMPTS,
    globalRank: team.globalRank || null,
    successfulAt: team.successfulAt || null,
    gameStatus: game.status,
  };
  if (includeQuestionText) {
    const q = logic.getQuestionPublic(team.qrId);
    base.questionText = q ? q.questionText : null;
  }
  return base;
}

// Info about a QR code: which question number it is, and whether it's full.
router.get('/api/qr/:qrId', (req, res) => {
  const qrId = parseInt(req.params.qrId, 10);
  if (![1, 2, 3, 4, 5, 6].includes(qrId)) {
    return res.status(400).json({ error: 'Invalid QR code.' });
  }
  const game = logic.getGame();
  const count = logic.countTeamsForQr(qrId);
  res.json({
    qrId,
    questionNumber: qrId,
    slotsTaken: count,
    slotsTotal: logic.TEAMS_PER_QR,
    full: count >= logic.TEAMS_PER_QR,
    gameStatus: game.status,
  });
});

router.post('/api/register', (req, res) => {
  try {
    const { qrId, teamId, player1Name, player2Name } = req.body || {};
    const qr = parseInt(qrId, 10);
    const cleanTeamId = String(teamId || '').trim();
    const p1 = String(player1Name || '').trim();
    const p2 = String(player2Name || '').trim();

    if (!cleanTeamId || !p1 || !p2) {
      return res.status(400).json({ error: 'Player 1 name, Player 2 name and Team ID are all required.' });
    }
    const team = logic.registerTeam(qr, cleanTeamId, p1, p2);
    setTeamCookie(res, team.sessionToken);
    const game = logic.getGame();
    res.json({ team: serializeTeamForClient(team, game, false) });
  } catch (e) {
    const status = e.statusCode || 500;
    if (status === 500) console.error(e);
    res.status(status).json({ error: e.message || 'Registration failed.' });
  }
});

// Restore state for a returning/refreshing player. Server is authoritative.
router.get('/api/team/state', (req, res) => {
  const token = req.cookies[TEAM_COOKIE];
  const team = logic.getTeamByToken(token);
  if (!team) return res.status(404).json({ error: 'No active registration found on this device.' });
  const game = logic.getGame();
  const includeQuestion = game.status === 'LIVE' || game.status === 'FINISHED';
  res.json({ team: serializeTeamForClient(team, game, includeQuestion) });
});

router.post('/api/answer', (req, res) => {
  const token = req.cookies[TEAM_COOKIE];
  const team = logic.getTeamByToken(token);
  if (!team) return res.status(404).json({ error: 'No active registration found on this device.' });
  const { answer } = req.body || {};
  if (answer === undefined || answer === null || String(answer).trim() === '') {
    return res.status(400).json({ error: 'Please enter an answer.' });
  }
  try {
    const result = logic.submitAnswer(team.teamId, String(answer));
    const io = req.app.get('io');

    if (result.outcome === 'CORRECT' && result.finished) {
      io.emit('game:finished', { successfulCount: result.game.successfulCount });
    }
    if (result.outcome === 'CORRECT' || result.outcome === 'OUT_OF_ATTEMPTS') {
      io.emit('leaderboard:update');
    }

    const game = logic.getGame();
    res.json({
      outcome: result.outcome,
      team: serializeTeamForClient(result.team, game, true),
    });
  } catch (e) {
    const status = e.statusCode || 500;
    if (status === 500) console.error(e);
    res.status(status).json({ error: e.message || 'Could not submit answer.' });
  }
});

router.get('/api/game/state', (req, res) => {
  const game = logic.getGame();
  res.json({
    status: game.status,
    successfulCount: game.successfulCount,
    maxWinners: game.maxWinners,
  });
});

module.exports = { router, TEAM_COOKIE, serializeTeamForClient };
