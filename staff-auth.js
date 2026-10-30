// ════════════════════════════════════════
//  직원 로그인 게이트 (Firebase 구글 로그인)
//  사용처: 기록, 청소년참여기구관리시스템, 기록참석투표/admin.html
//
//  Firestore 규칙이 "직원 계정으로 로그인한 경우에만" 청소년 개인정보를 읽고 쓰게 막혀 있으므로,
//  페이지는 로그인이 확인된 뒤에만 DB를 불러와야 한다.
//    requireStaff(시작함수, { clearKeys: [...] })
//  - 시작함수: 직원 로그인이 확인되면 한 번만 호출된다 (여기서 DB 로드·리스너 시작).
//  - clearKeys: 로그아웃할 때 지울 localStorage 키 (끝이 '*'이면 그 접두어로 시작하는 키 전부).
//
//  직원 계정 목록은 Firebase 콘솔의 Firestore 규칙 isStaff() 에만 둔다 (공개 소스에 이메일을 남기지 않음).
//  페이지는 직원 전용 경로(staffcheck/ping)를 읽어 보고, 규칙이 막으면 "권한 없음"으로 본다.
// ════════════════════════════════════════
function requireStaff(onReady, opts) {
  opts = opts || {};
  const auth = firebase.auth();
  let started = false;

  const style = document.createElement('style');
  style.textContent = `
    #staffGate { position: fixed; inset: 0; z-index: 2147483000; background: #F7F6F2;
      display: flex; align-items: center; justify-content: center; padding: 16px;
      font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif; }
    #staffGate .sg-card { background: #fff; border: 1px solid rgba(0,0,0,.1); border-radius: 14px;
      padding: 32px 28px; max-width: 380px; width: 100%; text-align: center; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
    #staffGate h2 { font-size: 18px; margin: 10px 0 8px; color: #1A1918; }
    #staffGate p { font-size: 13px; color: #6B6A66; line-height: 1.7; margin: 0 0 18px; }
    #staffGate .sg-btn { display: inline-flex; align-items: center; gap: 8px; border: 1px solid rgba(0,0,0,.18);
      background: #fff; border-radius: 8px; padding: 11px 18px; font-size: 14px; font-weight: 600; cursor: pointer; }
    #staffGate .sg-btn:hover { background: #F1EFE8; }
    #staffGate .sg-err { color: #A32D2D; font-size: 12px; margin-top: 14px; line-height: 1.6; }
    #staffLogout { position: fixed; left: 10px; bottom: 10px; z-index: 2147482000; font-size: 11px;
      background: rgba(255,255,255,.92); border: 1px solid rgba(0,0,0,.15); border-radius: 999px;
      padding: 4px 10px; color: #6B6A66; cursor: pointer; font-family: inherit; }
    #staffLogout:hover { color: #A32D2D; border-color: #A32D2D; }
    @media print { #staffLogout, #staffGate { display: none !important; } }
  `;
  document.head.appendChild(style);

  const gate = document.createElement('div');
  gate.id = 'staffGate';
  document.body.appendChild(gate);

  function show(html) { gate.innerHTML = '<div class="sg-card">' + html + '</div>'; gate.style.display = 'flex'; }
  function escText(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function showLogin(errMsg) {
    show(`<div style="font-size:36px">🔒</div>
      <h2>직원 로그인이 필요해요</h2>
      <p>청소년 개인정보를 보호하기 위해<br>센터 직원 구글 계정으로 로그인해야 열 수 있어요.</p>
      <button class="sg-btn" id="sgLoginBtn"><span style="font-size:16px">G</span> 구글 계정으로 로그인</button>
      ${errMsg ? `<div class="sg-err">${escText(errMsg)}</div>` : ''}`);
    document.getElementById('sgLoginBtn').onclick = signIn;
  }

  function showDenied(email) {
    show(`<div style="font-size:36px">⛔</div>
      <h2>권한이 없는 계정이에요</h2>
      <p><b>${escText(email || '(이메일 없음)')}</b> 계정은<br>이 도구를 쓸 수 있는 직원 계정으로 등록되어 있지 않아요.</p>
      <button class="sg-btn" id="sgSwitchBtn">다른 계정으로 로그인</button>`);
    document.getElementById('sgSwitchBtn').onclick = () => auth.signOut().then(signIn);
  }

  function explain(e) {
    const code = (e && e.code) || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
    if (code === 'auth/unauthorized-domain') return '이 주소가 Firebase 로그인 허용 도메인에 없어요. (Firebase 콘솔 → Authentication → 설정 → 승인된 도메인)';
    if (code === 'auth/operation-not-allowed') return '구글 로그인이 아직 켜져 있지 않아요. (Firebase 콘솔 → Authentication → 로그인 방법 → Google 사용 설정)';
    if (code === 'auth/network-request-failed') return '인터넷 연결을 확인하고 다시 시도해주세요.';
    return '로그인하지 못했어요: ' + (e && e.message ? e.message : code);
  }

  async function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await auth.signInWithPopup(provider);
    } catch (e) {
      if (e && e.code === 'auth/popup-blocked') {
        try { await auth.signInWithRedirect(provider); return; } catch (e2) { e = e2; }
      }
      console.warn('로그인 실패:', e);
      const msg = explain(e);
      if (msg) showLogin(msg);
    }
  }

  function clearLocal() {
    (opts.clearKeys || []).forEach(k => {
      try {
        if (k.endsWith('*')) {
          const p = k.slice(0, -1);
          Object.keys(localStorage).filter(x => x.startsWith(p)).forEach(x => localStorage.removeItem(x));
        } else localStorage.removeItem(k);
      } catch (e) {}
    });
  }

  function addLogoutButton(email) {
    if (document.getElementById('staffLogout')) return;
    const b = document.createElement('button');
    b.id = 'staffLogout';
    b.textContent = '🔓 ' + email + ' · 로그아웃';
    const clears = (opts.clearKeys || []).length > 0;
    b.title = clears ? '로그아웃하면 이 PC에 저장된 사본도 지워요' : '로그아웃';
    b.onclick = async () => {
      if (!confirm(clears ? '로그아웃할까요?\n이 PC 브라우저에 저장된 명단·출석 사본도 함께 지워요.' : '로그아웃할까요?')) return;
      clearLocal();
      await auth.signOut();
      location.reload();
    };
    document.body.appendChild(b);
  }

  show('<div style="font-size:13px;color:#6B6A66">로그인 확인 중…</div>');
  auth.getRedirectResult().catch(e => { const msg = explain(e); if (msg) showLogin(msg); });

  // 규칙이 이 계정을 직원으로 인정하는지 확인. 오프라인이면('unavailable') 이 PC의 사본으로 쓰도록 통과시킨다.
  async function isStaffAccount() {
    try {
      await firebase.firestore().collection('staffcheck').doc('ping').get();
      return true;
    } catch (e) {
      if (e && e.code === 'permission-denied') return false;
      console.warn('직원 권한 확인 실패(오프라인으로 간주):', e);
      return true;
    }
  }

  auth.onAuthStateChanged(async user => {
    if (!user) {
      // 이미 시작된 화면에서 로그아웃되면 (다른 탭 등) DB 리스너를 끊기 위해 새로고침
      if (started) { location.reload(); return; }
      showLogin();
      return;
    }
    if (started) return;
    show('<div style="font-size:13px;color:#6B6A66">권한 확인 중…</div>');
    if (!(await isStaffAccount())) { showDenied(user.email); return; }
    gate.style.display = 'none';
    addLogoutButton(user.email);
    started = true;
    onReady(user);
  });
}
