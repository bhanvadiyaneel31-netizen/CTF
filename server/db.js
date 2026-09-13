const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || './data/game.db';
const resolved = path.resolve(DB_PATH);
fs.mkdirSync(path.dirname(resolved), { recursive: true });

const db = new Database(resolved);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS game (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'WAITING',      -- WAITING | LIVE | FINISHED
  startedAt TEXT,
  finishedAt TEXT,
  successfulCount INTEGER NOT NULL DEFAULT 0,
  maxWinners INTEGER NOT NULL DEFAULT 6
);

CREATE TABLE IF NOT EXISTS questions (
  qrId INTEGER PRIMARY KEY,                    -- 1..6, fixed forever
  questionText TEXT NOT NULL,
  correctAnswer TEXT NOT NULL,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teamId TEXT NOT NULL UNIQUE,
  player1Name TEXT NOT NULL,
  player2Name TEXT NOT NULL,
  qrId INTEGER NOT NULL,
  registeredAt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING',      -- WAITING | PLAYING | WINNER | LOSE
  attemptsUsed INTEGER NOT NULL DEFAULT 0,
  successfulAt TEXT,
  globalRank INTEGER,
  sessionToken TEXT NOT NULL UNIQUE,
  FOREIGN KEY (qrId) REFERENCES questions(qrId)
);

CREATE INDEX IF NOT EXISTS idx_teams_qr ON teams(qrId);
CREATE INDEX IF NOT EXISTS idx_teams_session ON teams(sessionToken);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teamId TEXT NOT NULL,
  attemptNumber INTEGER NOT NULL,
  submittedAnswer TEXT NOT NULL,
  isCorrect INTEGER NOT NULL,
  submittedAt TEXT NOT NULL,
  FOREIGN KEY (teamId) REFERENCES teams(teamId)
);
`);

// Seed the single game row
const gameRow = db.prepare('SELECT * FROM game WHERE id = 1').get();
if (!gameRow) {
  db.prepare(
    `INSERT INTO game (id, status, successfulCount, maxWinners) VALUES (1, 'WAITING', 0, 6)`
  ).run();
}

// Seed the six fixed questions if missing. QR->Question mapping never changes.
const DEFAULT_QUESTIONS = [
  { qrId: 1, questionText: 'What is the capital of Gujarat?', correctAnswer: 'Gandhinagar' },
  { qrId: 2, questionText: 'How many players are on one team?', correctAnswer: '2' },
  { qrId: 3, questionText: 'What is the national currency of India?', correctAnswer: 'Rupee' },
  { qrId: 4, questionText: 'How many continents are there on Earth?', correctAnswer: '7' },
  { qrId: 5, questionText: 'What planet is known as the Red Planet?', correctAnswer: 'Mars' },
  { qrId: 6, questionText: 'How many total winners does this game have?', correctAnswer: '6' },
];

const insertQ = db.prepare(
  `INSERT INTO questions (qrId, questionText, correctAnswer, updatedAt) VALUES (@qrId, @questionText, @correctAnswer, @updatedAt)`
);
for (const q of DEFAULT_QUESTIONS) {
  const exists = db.prepare('SELECT qrId FROM questions WHERE qrId = ?').get(q.qrId);
  if (!exists) {
    insertQ.run({ ...q, updatedAt: new Date().toISOString() });
  }
}

module.exports = db;
