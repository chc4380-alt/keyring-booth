// ════════════════════════════════════════
//  키링 부스 관리 화면 들어가기
//  - 동아리 친구들: 계정 없이 6자리 동아리 코드만 넣는다.
//    Firebase 익명 로그인 → keyringMembers/{uid} 에 코드를 적으면, 규칙이 keyring/secret 의 코드와 같은지 본다.
//    직원이 코드를 새로 만들면 예전 코드로 들어온 기기는 다시 코드를 넣어야 한다.
//  - 직원: 구글 로그인 → staffcheck/ping 으로 직원인지 확인 (staff-auth.js 와 같은 방식)
//
//  requireCrew(시작함수) — 들어오면 시작함수(role)를 한 번 부른다. role 은 'staff' 또는 'member'.
// ════════════════════════════════════════
function requireCrew(onReady) {
  const auth = firebase.auth();
  const db = firebase.firestore();
  let started = false;
  let startedUid = null;
  let busy = false;   // 코드 확인 중에는 로그인 상태 변화를 무시한다

  const style = document.createElement('style');
  style.textContent = `
    #crewGate { position: fixed; inset: 0; z-index: 2147483000; background: #F6F2EB;
      display: flex; align-items: center; justify-content: center; padding: 16px;
      font-family: 'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; color: #22201C; }
    #crewGate .cg-card { background: #fff; border: 1px solid rgba(34,32,28,.12); border-radius: 18px;
      padding: 30px 24px 22px; max-width: 360px; width: 100%; text-align: center; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
    #crewGate h2 { font-size: 20px; margin: 8px 0 6px; }
    #crewGate p { font-size: 14px; color: #6E685F; line-height: 1.65; margin: 0 0 18px; word-break: keep-all; }
    #crewGate .cg-code { display: block; width: 100%; border: 1.5px solid rgba(34,32,28,.16); border-radius: 12px;
      padding: 12px; font: inherit; font-size: 28px; font-weight: 800; letter-spacing: .35em; text-align: center;
      text-indent: .35em; outline: none; background: #fff; color: inherit; }
    #crewGate .cg-code:focus { border-color: #F2603F; }
    #crewGate .cg-primary { display: block; width: 100%; margin-top: 12px; border: 0; border-radius: 12px; padding: 14px;
      background: #F2603F; color: #fff; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; }
    #crewGate .cg-primary:disabled { background: #D9D2C8; cursor: default; }
    #crewGate .cg-err { color: #C0392B; font-size: 13.5px; margin-top: 12px; line-height: 1.6; min-height: 1em; word-break: keep-all; }
    #crewGate .cg-link { margin-top: 18px; border: 0; background: none; color: #6E685F; font: inherit; font-size: 13px;
      text-decoration: underline; cursor: pointer; }
    #crewOut { position: fixed; left: 10px; bottom: 10px; z-index: 2147482000; font-size: 11.5px;
      background: rgba(255,255,255,.92); border: 1px solid rgba(0,0,0,.15); border-radius: 999px;
      padding: 4px 10px; color: #6E685F; cursor: pointer; font-family: inherit; }
    #crewOut:hover { color: #C0392B; border-color: #C0392B; }
    @media print { #crewOut, #crewGate { display: none !important; } }
  `;
  document.head.appendChild(style);

  const gate = document.createElement('div');
  gate.id = 'crewGate';
  document.body.appendChild(gate);
  const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
  function show(html) { gate.innerHTML = '<div class="cg-card">' + html + '</div>'; gate.style.display = 'flex'; }
  function wait(msg) { show(`<div style="font-size:14px;color:#6E685F">${msg}</div>`); }

  function showGate(errMsg) {
    show(`<div style="font-size:38px">📸</div>
      <h2>키링 부스 관리</h2>
      <p>동아리 선생님께 받은<br><b>6자리 동아리 코드</b>를 넣어 주세요.</p>
      <input class="cg-code" id="cgCode" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="······">
      <button class="cg-primary" id="cgEnter" disabled>들어가기</button>
      <div class="cg-err" id="cgErr">${errMsg ? esc(errMsg) : ''}</div>
      <button class="cg-link" id="cgStaff">직원은 구글 계정으로 로그인</button>`);
    const input = document.getElementById('cgCode');
    const btn = document.getElementById('cgEnter');
    input.oninput = () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      btn.disabled = input.value.length !== 6;
    };
    input.onkeydown = e => { if (e.key === 'Enter' && !btn.disabled) enter(input.value); };
    btn.onclick = () => enter(input.value);
    document.getElementById('cgStaff').onclick = staffSignIn;
    setTimeout(() => input.focus(), 50);
  }

  function showDenied(email) {
    show(`<div style="font-size:38px">⛔</div>
      <h2>직원 계정이 아니에요</h2>
      <p><b>${esc(email || '(이메일 없음)')}</b> 계정은<br>직원 계정으로 등록되어 있지 않아요.<br>동아리 친구는 코드로 들어와요.</p>
      <button class="cg-primary" id="cgBack">동아리 코드로 들어가기</button>`);
    document.getElementById('cgBack').onclick = () => auth.signOut();
  }

  function explain(e) {
    const code = (e && e.code) || '';
    if (code === 'permission-denied') return '코드가 맞지 않아요. 다시 확인해 주세요.';
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation')
      return '계정 없이 들어가기가 아직 꺼져 있어요. (Firebase 콘솔 → Authentication → 로그인 방법 → 익명 사용 설정)';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
    if (code === 'auth/network-request-failed' || code === 'unavailable') return '인터넷 연결을 확인하고 다시 해 주세요.';
    return '들어가지 못했어요: ' + (e && e.message ? e.message : code);
  }

  async function enter(code) {
    if (busy || !/^\d{6}$/.test(code)) return;
    busy = true;
    wait('코드 확인 중…');
    try {
      let user = auth.currentUser;
      if (user && !user.isAnonymous) { await auth.signOut(); user = null; }
      if (!user) user = (await auth.signInAnonymously()).user;
      await db.doc('keyringMembers/' + user.uid).set({ code, at: firebase.firestore.FieldValue.serverTimestamp() });
      busy = false;
      begin('member');
    } catch (e) {
      busy = false;
      console.warn('동아리 코드 확인 실패:', e);
      showGate(explain(e));
    }
  }

  async function staffSignIn() {
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
      if (msg) showGate(msg);
    }
  }

  // 규칙이 막으면 false. 오프라인 같은 다른 문제는 일단 들여보낸다(화면에서 연결 오류가 뜬다).
  async function allowed(path) {
    try {
      if (path === 'photos') await db.collection('keyringPhotos').limit(1).get();
      else await db.collection('staffcheck').doc('ping').get();
      return true;
    } catch (e) {
      if (e && e.code === 'permission-denied') return false;
      console.warn('권한 확인 실패(오프라인으로 간주):', e);
      return true;
    }
  }

  function begin(role) {
    if (started) return;
    started = true;
    gate.style.display = 'none';
    const user = auth.currentUser;
    startedUid = user.uid;
    const b = document.createElement('button');
    b.id = 'crewOut';
    b.textContent = role === 'staff' ? '🔓 ' + user.email + ' · 로그아웃' : '🔓 동아리 코드로 들어옴 · 나가기';
    b.onclick = async () => {
      if (!confirm(role === 'staff' ? '로그아웃할까요?' : '나갈까요? 다시 들어올 때 동아리 코드를 넣어야 해요.')) return;
      if (role === 'member') { try { await db.doc('keyringMembers/' + user.uid).delete(); } catch (e) {} }
      await auth.signOut();
    };
    document.body.appendChild(b);
    onReady(role);
  }

  wait('확인 중…');
  auth.getRedirectResult().catch(e => { const msg = explain(e); if (msg) showGate(msg); });

  auth.onAuthStateChanged(async user => {
    if (started) {
      // 나가기·로그아웃하거나 다른 탭에서 계정이 바뀌면 처음부터
      if (!user || user.uid !== startedUid) location.reload();
      return;
    }
    if (busy) return;
    if (!user) { showGate(); return; }
    wait('확인 중…');
    if (user.isAnonymous) {
      // 예전에 코드를 넣은 기기: 코드가 아직 맞으면 바로 들어간다
      if (await allowed('photos')) begin('member');
      else showGate();
    } else if (await allowed('staff')) begin('staff');
    else showDenied(user.email);
  });
}
