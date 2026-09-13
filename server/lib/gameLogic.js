const crypto = require('crypto');
const db = require('../db');

const TEAMS_PER_QR = 3;
const MAX_ATTEMPTS = 3;

function normalizeAnswer(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function newSessionToken() {
  return crypto.randomBytes(24).toString('hex');
}

function getGame() {
  return db.prepare('SELECT * FROM game WHERE id = 1').get();
}

function getQuestionPublic(qrId) {
  const q = db.prepare('SELECT qrId, questionText FROM questions WHERE qrId = ?').get(qrId);
  return q || null;
}

function getQuestionFull(qrId) {
  return db.prepare('SELECT * FROM questions WHERE qrId = ?').get(qrId);
}

function countTeamsForQr(qrId) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM teams WHERE qrId = ?').get(qrId);
  return row.c;
}

function getTeamByToken(token) {
  if (!token) return null;
  return db.prepare('SELECT * FROM teams WHERE sessionToken = ?').get(token);
}

function getTeamByTeamId(teamId) {
  return db.prepare('SELECT * FROM teams WHERE teamId = ?').get(teamId);
}

/**
 * Register a new team for a fixed QR/question. Atomic: re-checks the
 * per-question capacity and teamId uniqueness inside the same transaction
 * so two simultaneous registrations for the last slot can't both succeed.
 */
const registerTeam = db.transaction((qrId, teamId, player1Name, player2Name) => {
  if (![1, 2, 3, 4, 5, 6].includes(qrId)) {
    throw new HttpError(400, 'Invalid QR code.');
  }
  const game = getGame();
  if (game.status !== 'WAITING') {
    throw new HttpError(409, 'Registration is closed. The game has already started.');
  }
  const existing = getTeamByTeamId(teamId);
  if (existing) {
    throw new HttpError(409, 'This Team ID is already registered.');
  }
  const count = countTeamsForQr(qrId);
  if (count >= TEAMS_PER_QR) {
    throw new HttpError(409, 'This QR code already has 3 registered teams.');
  }
  const token = newSessionToken();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO teams (teamId, player1Name, player2Name, qrId, registeredAt, status, attemptsUsed, sessionToken)
     VALUES (?, ?, ?, ?, ?, 'WAITING', 0, ?)`
  ).run(teamId, player1Name, player2Name, qrId, now, token);
  return getTeamByTeamId(teamId);
});

/**
 * Submit an answer attempt for a team. Fully atomic: game status,
 * successful count, attempt count, correctness, rank assignment and the
 * FINISHED transition all happen inside one transaction so a 6th-place tie
 * cannot occur and a stale client can never sneak in an extra attempt.
 */
const submitAnswer = db.transaction((teamId, rawAnswer) => {
  const game = getGame();
  const team = getTeamByTeamId(teamId);
  if (!team) throw new HttpError(404, 'Team not found.');

  if (game.status === 'FINISHED') {
    return { outcome: 'GAME_OVER_ALREADY', team, game };
  }
  if (game.status !== 'LIVE') {
    throw new HttpError(409, 'The game has not started yet.');
  }
  if (team.status === 'WINNER' || team.status === 'LOSE') {
    return { outcome: 'ALREADY_DECIDED', team, game };
  }
  if (team.attemptsUsed >= MAX_ATTEMPTS) {
    // Should not normally happen (status would already be LOSE), but guard anyway.
    db.prepare('UPDATE teams SET status = ? WHERE teamId = ?').run('LOSE', teamId);
    return { outcome: 'ALREADY_DECIDED', team: getTeamByTeamId(teamId), game };
  }

  const q = getQuestionFull(team.qrId);
  const attemptNumber = team.attemptsUsed + 1;
  const isCorrect = normalizeAnswer(rawAnswer) === normalizeAnswer(q.correctAnswer);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO attempts (teamId, attemptNumber, submittedAnswer, isCorrect, submittedAt)
     VALUES (?, ?, ?, ?, ?)`
  ).run(teamId, attemptNumber, rawAnswer, isCorrect ? 1 : 0, now);

  if (isCorrect) {
    // Re-read successful count fresh inside the transaction to avoid races.
    const fresh = getGame();
    if (fresh.status === 'FINISHED' || fresh.successfulCount >= fresh.maxWinners) {
      // Game finished between our status check and now (shouldn't happen
      // since this whole function is one transaction, but guard anyway).
      db.prepare('UPDATE teams SET attemptsUsed = ?, status = ? WHERE teamId = ?')
        .run(attemptNumber, 'LOSE', teamId);
      return { outcome: 'GAME_OVER_ALREADY', team: getTeamByTeamId(teamId), game: fresh };
    }
    const newCount = fresh.successfulCount + 1;
    const rank = newCount;
    db.prepare(
      `UPDATE teams SET attemptsUsed = ?, status = 'WINNER', successfulAt = ?, globalRank = ? WHERE teamId = ?`
    ).run(attemptNumber, now, rank, teamId);

    let finished = false;
    if (newCount >= fresh.maxWinners) {
      db.prepare(
        `UPDATE game SET successfulCount = ?, status = 'FINISHED', finishedAt = ? WHERE id = 1`
      ).run(newCount, now);
      finished = true;
      // Every team that has not already qualified immediately loses.
      db.prepare(
        `UPDATE teams SET status = 'LOSE' WHERE status NOT IN ('WINNER') `
      ).run();
    } else {
      db.prepare(`UPDATE game SET successfulCount = ? WHERE id = 1`).run(newCount);
    }

    return {
      outcome: 'CORRECT',
      team: getTeamByTeamId(teamId),
      game: getGame(),
      finished,
    };
  } else {
    let status = 'PLAYING';
    if (attemptNumber >= MAX_ATTEMPTS) status = 'LOSE';
    db.prepare('UPDATE teams SET attemptsUsed = ?, status = ? WHERE teamId = ?').run(
      attemptNumber,
      status,
      teamId
    );
    return {
      outcome: status === 'LOSE' ? 'OUT_OF_ATTEMPTS' : 'WRONG',
      team: getTeamByTeamId(teamId),
      game,
      attemptNumber,
    };
  }
});

const startGame = db.transaction(() => {
  const game = getGame();
  if (game.status !== 'WAITING') {
    throw new HttpError(409, 'The game has already been started.');
  }
  const totalTeams = db.prepare('SELECT COUNT(*) AS c FROM teams').get().c;
  if (totalTeams < 1) {
    throw new HttpError(409, 'No teams are registered yet.');
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE game SET status = 'LIVE', startedAt = ? WHERE id = 1`).run(now);
  db.prepare(`UPDATE teams SET status = 'PLAYING' WHERE status = 'WAITING'`).run();
  return getGame();
});

const updateQuestion = db.transaction((qrId, questionText, correctAnswer) => {
  const game = getGame();
  if (game.status !== 'WAITING') {
    throw new HttpError(403, 'Question editing is locked because the game has started.');
  }
  if (!questionText || !correctAnswer) {
    throw new HttpError(400, 'Question text and correct answer are required.');
  }
  db.prepare(
    `UPDATE questions SET questionText = ?, correctAnswer = ?, updatedAt = ? WHERE qrId = ?`
  ).run(questionText.trim(), correctAnswer.trim(), new Date().toISOString(), qrId);
  return getQuestionFull(qrId);
});

const resetGame = db.transaction(() => {
  db.prepare('DELETE FROM attempts').run();
  db.prepare('DELETE FROM teams').run();
  db.prepare(
    `UPDATE game SET status = 'WAITING', startedAt = NULL, finishedAt = NULL, successfulCount = 0, maxWinners = 6 WHERE id = 1`
  ).run();
});

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

module.exports = {
  TEAMS_PER_QR,
  MAX_ATTEMPTS,
  normalizeAnswer,
  getGame,
  getQuestionPublic,
  getQuestionFull,
  countTeamsForQr,
  getTeamByToken,
  getTeamByTeamId,
  registerTeam,
  submitAnswer,
  startGame,
  updateQuestion,
  resetGame,
  HttpError,
};
