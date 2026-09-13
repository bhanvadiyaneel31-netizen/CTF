(function () {
  const loginView = document.getElementById('view-login');
  const dashView = document.getElementById('view-dashboard');

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

  function dashError(msg) {
    const el = document.getElementById('dash-error');
    if (!msg) return el.classList.add('hidden');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  // ---- Login ----
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    try {
      const password = document.getElementById('password').value;
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
      enterDashboard();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    loginView.classList.remove('hidden');
    dashView.classList.add('hidden');
  });

  document.getElementById('reset-btn').addEventListener('click', async () => {
    if (!confirm('This clears every team and answer and puts the game back to WAITING. Continue?')) return;
    try {
      await api('/api/admin/reset', { method: 'POST' });
      await loadAll();
    } catch (e) {
      dashError(e.message);
    }
  });

  document.getElementById('start-btn').addEventListener('click', async () => {
    if (!confirm('Start the game now? Question editing will lock immediately and every team will see its question.')) return;
    try {
      await api('/api/admin/start', { method: 'POST' });
      await loadAll();
    } catch (e) {
      dashError(e.message);
    }
  });

  // ---- Data loading ----
  let qrUrls = [];

  async function loadConfig() {
    const cfg = await api('/api/config');
    qrUrls = cfg.qrUrls;
  }

  function statusPillClass(status) {
    if (status === 'LIVE') return 'live';
    if (status === 'FINISHED') return 'finished';
    return 'waiting';
  }

  async function loadOverview() {
    const data = await api('/api/admin/overview');
    const game = data.game;

    const pill = document.getElementById('game-status-pill');
    pill.textContent = game.status;
    pill.className = 'status-pill ' + statusPillClass(game.status);

    document.getElementById('stat-teams').textContent = `${data.totalTeams}/18`;
    document.getElementById('stat-successful').textContent = `${game.successfulCount}/${game.maxWinners}`;
    document.getElementById('stat-remaining').textContent = Math.max(data.totalTeams - game.successfulCount, 0);

    const qrGrid = document.getElementById('qr-grid');
    qrGrid.innerHTML = '';
    for (let i = 1; i <= 6; i++) {
      const taken = data.perQrCounts[i] || 0;
      const box = document.createElement('div');
      box.className = 'qr-box';
      box.innerHTML = `
        <div class="count">${taken}/${data.teamsPerQr}</div>
        <div>Question ${i}</div>
        <code>${qrUrls[i - 1] || ''}</code>
      `;
      qrGrid.appendChild(box);
    }

    const isWaiting = game.status === 'WAITING';
    document.getElementById('questions-lock-note').textContent = isWaiting
      ? 'Editable until the game starts.'
      : 'Locked — the game has already started.';
    document.getElementById('start-btn').disabled = !isWaiting;

    const list = document.getElementById('questions-list');
    list.innerHTML = '';
    data.questions.forEach((q) => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      wrap.style.marginBottom = '20px';
      wrap.innerHTML = `
        <label>Question ${q.qrId}</label>
        <input type="text" value="${escapeAttr(q.questionText)}" data-role="qtext" data-qr="${q.qrId}" ${isWaiting ? '' : 'disabled'} />
        <label style="margin-top:8px;">Correct answer</label>
        <input type="text" value="${escapeAttr(q.correctAnswer)}" data-role="qanswer" data-qr="${q.qrId}" ${isWaiting ? '' : 'disabled'} />
        ${isWaiting ? `<button class="ghost" data-save-qr="${q.qrId}" style="margin-top:8px;">Save question ${q.qrId}</button>` : ''}
      `;
      list.appendChild(wrap);
    });
    list.querySelectorAll('[data-save-qr]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const qrId = btn.getAttribute('data-save-qr');
        const questionText = list.querySelector(`[data-role="qtext"][data-qr="${qrId}"]`).value;
        const correctAnswer = list.querySelector(`[data-role="qanswer"][data-qr="${qrId}"]`).value;
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
          await api(`/api/admin/questions/${qrId}`, {
            method: 'PUT',
            body: JSON.stringify({ questionText, correctAnswer }),
          });
          btn.textContent = 'Saved';
          setTimeout(() => { btn.textContent = `Save question ${qrId}`; btn.disabled = false; }, 1000);
        } catch (e) {
          dashError(e.message);
          btn.disabled = false;
          btn.textContent = `Save question ${qrId}`;
        }
      });
    });

    if (game.status === 'FINISHED') {
      document.getElementById('final-results-card').classList.remove('hidden');
      loadResults();
    } else {
      document.getElementById('final-results-card').classList.add('hidden');
    }
  }

  async function loadResults() {
    const data = await api('/api/admin/results');
    const ol = document.getElementById('final-winners');
    ol.innerHTML = '';
    data.winners.forEach((w) => {
      const li = document.createElement('li');
      li.textContent = `${w.teamId} — ${w.player1Name} & ${w.player2Name} (Q${w.qrId}, ${w.attemptsUsed} attempt${w.attemptsUsed > 1 ? 's' : ''})`;
      ol.appendChild(li);
    });
    document.getElementById('final-losers-count').textContent = `${data.losers.length} teams did not qualify.`;
  }

  async function loadTeams() {
    const data = await api('/api/admin/teams');
    const tbody = document.getElementById('teams-tbody');
    tbody.innerHTML = '';
    data.teams.forEach((t) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${t.globalRank || '—'}</td>
        <td>${t.teamId}</td>
        <td>${escapeHtml(t.player1Name)}</td>
        <td>${escapeHtml(t.player2Name)}</td>
        <td>Q${t.qrId}</td>
        <td>${t.attemptsUsed}/3</td>
        <td class="${t.status === 'WINNER' ? 'badge-win' : t.status === 'LOSE' ? 'badge-lose' : 'badge-neutral'}">${t.status}</td>
      `;
      tr.addEventListener('click', () => openTeamModal(t.teamId));
      tbody.appendChild(tr);
    });
  }

  async function openTeamModal(teamId) {
    try {
      const data = await api(`/api/admin/team/${encodeURIComponent(teamId)}`);
      const backdrop = document.getElementById('team-modal-backdrop');
      const content = document.getElementById('team-modal-content');
      const attemptsHtml = data.attempts
        .map((a) => `<tr><td>${a.attemptNumber}</td><td>${escapeHtml(a.submittedAnswer)}</td><td class="${a.isCorrect ? 'badge-win' : 'badge-lose'}">${a.isCorrect ? 'Correct' : 'Wrong'}</td></tr>`)
        .join('') || '<tr><td colspan="3">No attempts yet.</td></tr>';
      content.innerHTML = `
        <h2>${data.team.teamId}</h2>
        <p>${escapeHtml(data.team.player1Name)} &amp; ${escapeHtml(data.team.player2Name)} · Q${data.team.qrId} · <strong>${data.team.status}</strong></p>
        <p>Registered: ${new Date(data.team.registeredAt).toLocaleTimeString()}</p>
        ${data.team.globalRank ? `<p>Global rank: #${data.team.globalRank}</p>` : ''}
        <h3>Question</h3>
        <p>${escapeHtml(data.questionText)}</p>
        <p><strong>Correct answer (admin only):</strong> ${escapeHtml(data.correctAnswer)}</p>
        <h3>Attempts</h3>
        <table><thead><tr><th>#</th><th>Answer</th><th>Result</th></tr></thead><tbody>${attemptsHtml}</tbody></table>
        <button class="ghost" id="close-modal" style="margin-top:16px;">Close</button>
      `;
      backdrop.classList.remove('hidden');
      document.getElementById('close-modal').addEventListener('click', () => backdrop.classList.add('hidden'));
    } catch (e) {
      dashError(e.message);
    }
  }

  document.getElementById('team-modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'team-modal-backdrop') e.target.classList.add('hidden');
  });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  async function loadAll() {
    dashError(null);
    try {
      await loadOverview();
      await loadTeams();
    } catch (e) {
      dashError(e.message);
    }
  }

  async function enterDashboard() {
    loginView.classList.add('hidden');
    dashView.classList.remove('hidden');
    await loadConfig();
    await loadAll();
  }

  // ---- Real-time updates ----
  const socket = io();
  socket.on('game:started', () => { if (!dashView.classList.contains('hidden')) loadAll(); });
  socket.on('game:finished', () => { if (!dashView.classList.contains('hidden')) loadAll(); });
  socket.on('leaderboard:update', () => { if (!dashView.classList.contains('hidden')) loadAll(); });
  socket.on('game:reset', () => { if (!dashView.classList.contains('hidden')) loadAll(); });

  // ---- Boot: check for an existing admin session ----
  (async function boot() {
    try {
      await api('/api/admin/session');
      await enterDashboard();
    } catch (e) {
      loginView.classList.remove('hidden');
    }
  })();
})();
