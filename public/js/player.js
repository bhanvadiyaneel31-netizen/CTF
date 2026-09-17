(function () {
  const views = {
    loading: document.getElementById('view-loading'),
    error: document.getElementById('view-error'),
    register: document.getElementById('view-register'),
    waiting: document.getElementById('view-waiting'),
    question: document.getElementById('view-question'),
    pending: document.getElementById('view-pending'),
    result: document.getElementById('view-result'),
  };

  function show(name) {
    Object.values(views).forEach((v) => v.classList.add('hidden'));
    views[name].classList.remove('hidden');
  }

  function showError(title, message) {
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-message').textContent = message;
    show('error');
  }

  const pathMatch = window.location.pathname.match(/^\/q\/(\d)$/);
  const qrIdFromUrl = pathMatch ? parseInt(pathMatch[1], 10) : null;

  async function api(path, options) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function renderAttemptDots(attemptsUsed, maxAttempts, lastWasWrong) {
    const el = document.getElementById('attempt-dots');
    el.innerHTML = '';
    for (let i = 0; i < maxAttempts; i++) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      if (i < attemptsUsed) dot.classList.add('used-wrong');
      el.appendChild(dot);
    }
    document.getElementById('attempts-left').textContent = `${maxAttempts - attemptsUsed} of ${maxAttempts}`;
  }

  function renderWaiting(team) {
    document.getElementById('wait-team').textContent = team.teamId;
    document.getElementById('wait-p1').textContent = team.player1;
    document.getElementById('wait-p2').textContent = team.player2;
    document.getElementById('wait-qnum').textContent = `Question ${team.qrId}`;
    show('waiting');
  }

  function renderQuestion(team) {
    document.getElementById('q-num').textContent = team.qrId;
    document.getElementById('q-team').textContent = team.teamId;
    document.getElementById('q-text').textContent = team.questionText || 'Loading question...';
    renderAttemptDots(team.attemptsUsed, team.maxAttempts);
    document.getElementById('q-feedback').classList.add('hidden');
    document.getElementById('answer').value = '';
    document.getElementById('answer-btn').disabled = false;
    show('question');
  }

  const LOSE_REASON_TEXT = {
    ATTEMPTS_USED: 'You used all 3 attempts.',
    ANSWERED_LATE: 'Correct answer — but the first six teams had already qualified.',
    GAME_ENDED: 'The game was ended before you finished.',
    ADMIN_DECISION: 'Decided by the event admin.',
  };

  function renderResult(team) {
    const isWinner = team.status === 'WINNER';
    document.getElementById('result-pill').textContent = isWinner ? 'Winner' : 'Game over';
    document.getElementById('result-pill').className = 'status-pill ' + (isWinner ? 'live' : 'finished');
    document.getElementById('result-big').textContent = isWinner ? 'You qualified!' : 'You lose';
    document.getElementById('result-big').className = 'big ' + (isWinner ? 'win' : 'lose');
    document.getElementById('result-rank').innerHTML = isWinner
      ? `<span class="rank-badge">Global rank #${team.globalRank}</span>`
      : '';
    document.getElementById('result-reason').textContent = isWinner
      ? (team.winReason === 'ADMIN_DECISION' ? 'Decided by the event admin.' : `Solved on attempt ${team.attemptsUsed} of ${team.maxAttempts}.`)
      : (LOSE_REASON_TEXT[team.loseReason] || 'The first six teams had already qualified.');
    document.getElementById('result-p1').textContent = team.player1;
    document.getElementById('result-p2').textContent = team.player2;
    document.getElementById('result-team').textContent = team.teamId;
    show('result');
  }

  function renderPending(team) {
    document.getElementById('pending-team').textContent = team.teamId;
    document.getElementById('pending-p1').textContent = team.player1;
    document.getElementById('pending-p2').textContent = team.player2;
    show('pending');
  }

  function renderFromTeam(team) {
    if (team.status === 'PENDING') return renderPending(team);
    if (team.status === 'WINNER' || team.status === 'LOSE') return renderResult(team);
    if (team.gameStatus === 'LIVE' && (team.status === 'PLAYING' || team.status === 'WAITING')) {
      return renderQuestion(team);
    }
    return renderWaiting(team);
  }

  async function refreshTeamState() {
    try {
      const { team } = await api('/api/team/state');
      renderFromTeam(team);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function initRegistrationView() {
    if (!qrIdFromUrl) {
      return showError('Invalid link', 'This QR code is not recognized. Please scan one of the official event codes.');
    }
    try {
      const info = await api(`/api/qr/${qrIdFromUrl}`);
      document.getElementById('reg-qnum').textContent = info.questionNumber;
      document.getElementById('reg-slots').textContent = `${info.slotsTaken}/${info.slotsTotal}`;
      if (info.gameStatus !== 'WAITING') {
        return showError('Registration closed', 'The game has already started, so new teams can no longer join.');
      }
      if (info.full) {
        return showError('This question is full', `All ${info.slotsTotal} teams for this QR code have already registered.`);
      }
      show('register');
    } catch (e) {
      showError('Can\'t load this QR code', e.message);
    }
  }

  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('register-btn');
    const errEl = document.getElementById('register-error');
    errEl.classList.add('hidden');
    btn.disabled = true;
    try {
      const player1Name = document.getElementById('p1').value.trim();
      const player2Name = document.getElementById('p2').value.trim();
      const teamId = document.getElementById('tid').value.trim();
      const { team } = await api('/api/register', {
        method: 'POST',
        body: JSON.stringify({ qrId: qrIdFromUrl, teamId, player1Name, player2Name }),
      });
      renderFromTeam(team);
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('answer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('answer-btn');
    const feedback = document.getElementById('q-feedback');
    feedback.classList.add('hidden');
    btn.disabled = true;
    try {
      const answer = document.getElementById('answer').value;
      const { outcome, team } = await api('/api/answer', {
        method: 'POST',
        body: JSON.stringify({ answer }),
      });
      if (outcome === 'WRONG') {
        renderAttemptDots(team.attemptsUsed, team.maxAttempts);
        feedback.textContent = `Wrong answer. ${team.maxAttempts - team.attemptsUsed} attempts remaining.`;
        feedback.classList.remove('hidden');
        document.getElementById('answer').value = '';
        btn.disabled = false;
      } else {
        // CORRECT, CORRECT_TOO_LATE, OUT_OF_ATTEMPTS, ALREADY_DECIDED, GAME_OVER_ALREADY,
        // or PENDING (results not published yet) — team.status already reflects the
        // right screen to show (PENDING/WINNER/LOSE), so just render from it.
        renderFromTeam(team);
      }
    } catch (e) {
      feedback.textContent = e.message;
      feedback.classList.remove('hidden');
      btn.disabled = false;
    }
  });

  // ---- Real-time updates ----
  const socket = io();
  socket.on('game:started', () => refreshTeamState());
  socket.on('game:finished', () => refreshTeamState());
  socket.on('results:published', () => refreshTeamState());
  socket.on('results:unpublished', () => refreshTeamState());
  socket.on('game:reset', () => window.location.reload());

  // ---- Boot ----
  (async function boot() {
    const restored = await refreshTeamState();
    if (!restored) {
      await initRegistrationView();
    }
  })();
})();
