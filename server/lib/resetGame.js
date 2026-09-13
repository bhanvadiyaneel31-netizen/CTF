// Run with: npm run seed:reset
// Wipes all teams and attempts and puts the game back in WAITING state.
// Questions/answers are left untouched.
const { resetGame } = require('./gameLogic');

resetGame();
console.log('Game reset: all teams and attempts cleared, status = WAITING.');
process.exit(0);
