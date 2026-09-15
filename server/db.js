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
  maxWinners INTEGER NOT NULL DEFAULT 6,
  resultsPublished INTEGER NOT NULL DEFAULT 0  -- 0 = players see "pending", 1 = real WINNER/LOSE is visible
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

// Migration: existing databases created before resultsPublished existed
// won't have the column yet — add it rather than breaking on upgrade.
const gameColumns = db.prepare('PRAGMA table_info(game)').all().map((c) => c.name);
if (!gameColumns.includes('resultsPublished')) {
  db.exec('ALTER TABLE game ADD COLUMN resultsPublished INTEGER NOT NULL DEFAULT 0');
}

// Seed the single game row
const gameRow = db.prepare('SELECT * FROM game WHERE id = 1').get();
if (!gameRow) {
  db.prepare(
    `INSERT INTO game (id, status, successfulCount, maxWinners, resultsPublished) VALUES (1, 'WAITING', 0, 6, 0)`
  ).run();
}

// Seed the six fixed questions if missing. QR->Question mapping never changes.
const DEFAULT_QUESTIONS = [
  {
    qrId: 1,
    questionText:
      'I have no mass, yet I carry momentum. I can push an object without touching it. I travel fastest where there is nothing to stop me. What am I?',
    correctAnswer: 'Light',
  },
  {
    qrId: 2,
    questionText:
      'I pull without hands, I act without touching, and I keep you from floating away. I hold the Moon in its path and make every object with mass attract another. The farther you go from me, the weaker I become. What am I?',
    correctAnswer: 'Gravity',
  },
  {
    qrId: 3,
    questionText:
      'I am invisible, but I can make a machine come alive. I need a path to travel, and when my path is broken, my work stops. I can light a bulb, power a motor, and charge the device in your hand. What am I?',
    correctAnswer: 'Current',
  },
  {
    qrId: 4,
    questionText:
      'You cannot see me, but you can feel me pushing against you. Stand on one foot and I increase beneath that point. Spread your weight over a larger area and I decrease. A sharp needle uses me differently from a flat shoe. What am I?',
    correctAnswer: 'Pressure',
  },
  {
    qrId: 5,
    questionText:
      'I can be hard enough to build with, flow freely through a container, or spread invisibly through the air. I can change my form without becoming a different substance. Heat can make me change from one state to another. What am I?',
    correctAnswer: 'Matter',
  },
  {
    qrId: 6,
    questionText:
      'You cannot see me, but you can feel me when something moving hits you. A heavy object moving slowly can have me, while a light object moving very fast can also have me. Stop the object, and I disappear. The more mass and motion an object has, the greater I become. What am I?',
    correctAnswer: 'Momentum',
  },
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