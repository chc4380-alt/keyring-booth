// ══════════════════════════════════════════════════════════════
//  키링 부스 데이터 저장소
//  - 보통: Firestore(youthgroup-7f5d3)의 keyring/*, keyringPhotos, keyringFull
//  - 주소 끝에 ?demo 를 붙이면 이 브라우저 안에서만 도는 연습 모드(서버에 아무것도 안 올라감)
//
//  keyring/config      행사 이름·접수 열림·한 사람당 장수·키링 사진 크기 (누구나 읽기, 직원 쓰기)
//  keyring/counter     접수 번호 {n} (누구나 1씩만 올림)
//  keyringPhotos/{id}  번호·이름·작은 미리보기·상태 (직원만 목록, 참가자는 자기 문서만)
//  keyringFull/{id}    인쇄용 사진 (직원만 읽기)
// ══════════════════════════════════════════════════════════════
const KR_FIREBASE = {
  apiKey: "AIzaSyBkQ2_Hdv5Tzwr9OpZlb8tAYwWxigvyYKM",
  authDomain: "youthgroup-7f5d3.firebaseapp.com",
  projectId: "youthgroup-7f5d3",
  storageBucket: "youthgroup-7f5d3.firebasestorage.app",
  messagingSenderId: "387401045856",
  appId: "1:387401045856:web:34cde87c848d9cf67bb005"
};
const KR_DEMO = new URLSearchParams(location.search).has('demo');
const KR_DEFAULT_CONFIG = {
  eventName: '기록동아리 사진 키링 부스',
  open: true,
  maxPerPerson: 2,
  keyW: 40,
  keyH: 40,
  notice: ''
};
const KR_STATUS = {
  new: '접수됨',
  printed: '인쇄 완료',
  done: '전달 완료'
};

function krMakeStore() {
  return KR_DEMO ? krLocalStore() : krFirebaseStore();
}

function krEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function krFirebaseStore() {
  if (!firebase.apps.length) firebase.initializeApp(KR_FIREBASE);
  const db = firebase.firestore();
  const cfgRef = db.doc('keyring/config');
  const cntRef = db.doc('keyring/counter');
  const photos = db.collection('keyringPhotos');
  const full = db.collection('keyringFull');
  const toMs = t => (t && t.toMillis ? t.toMillis() : Date.now());

  async function inChunks(ids, perId) {
    // 한 번에 500건까지라 사진 하나에 2건(미리보기+원본)씩 200장 단위로 나눈다
    for (let i = 0; i < ids.length; i += 200) {
      const b = db.batch();
      ids.slice(i, i + 200).forEach(id => perId(b, id));
      await b.commit();
    }
  }

  return {
    demo: false,
    watchConfig(cb, onErr) {
      return cfgRef.onSnapshot(s => cb(Object.assign({}, KR_DEFAULT_CONFIG, s.exists ? s.data() : {}), s.exists), onErr);
    },
    saveConfig(patch) {
      return cfgRef.set(patch, { merge: true });
    },
    // items: [{ img, thumb, w, h }] → { no, ids }
    async submit(name, items) {
      const ids = items.map(() => photos.doc().id);
      const no = await db.runTransaction(async t => {
        const c = await t.get(cntRef);
        const n = (c.exists ? c.data().n : 0) + 1;
        t.set(cntRef, { n });
        items.forEach((it, i) => {
          t.set(photos.doc(ids[i]), {
            no: n, name, idx: i + 1, total: items.length,
            thumb: it.thumb, w: it.w, h: it.h, status: 'new',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          t.set(full.doc(ids[i]), { img: it.img });
        });
        return n;
      });
      return { no, ids };
    },
    watchMine(ids, cb) {
      const offs = ids.map(id => photos.doc(id).onSnapshot(
        s => cb(id, s.exists ? s.data() : null),
        () => cb(id, null)
      ));
      return () => offs.forEach(f => f());
    },
    watchPhotos(cb, onErr) {
      return photos.onSnapshot(qs => {
        cb(qs.docs.map(d => Object.assign({}, d.data(), { id: d.id, createdAt: toMs(d.data().createdAt) })));
      }, onErr);
    },
    setStatus(ids, status) {
      return inChunks(ids, (b, id) => b.update(photos.doc(id), { status }));
    },
    async getFull(id) {
      const s = await full.doc(id).get();
      return s.exists ? s.data().img : null;
    },
    remove(ids) {
      return inChunks(ids, (b, id) => { b.delete(photos.doc(id)); b.delete(full.doc(id)); });
    },
    async removeAll() {
      const qs = await photos.get();
      await inChunks(qs.docs.map(d => d.id), (b, id) => { b.delete(photos.doc(id)); b.delete(full.doc(id)); });
    },
    resetCounter() {
      return cntRef.set({ n: 0 });
    }
  };
}

// 연습 모드: localStorage에 넣고, 같은 브라우저의 다른 탭(참가자 화면 ↔ 관리 화면)에도 바로 보이게 한다
function krLocalStore() {
  const K = 'kr_demo_';
  const read = (k, d) => {
    try { const v = localStorage.getItem(K + k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
  };
  const subs = new Set();
  const emit = () => subs.forEach(f => f());
  const write = (k, v) => { localStorage.setItem(K + k, JSON.stringify(v)); };
  addEventListener('storage', e => { if (!e.key || e.key.startsWith(K)) emit(); });
  const sub = f => { subs.add(f); f(); return () => subs.delete(f); };
  const cfg = () => Object.assign({}, KR_DEFAULT_CONFIG, read('config', {}));
  const denied = msg => Object.assign(new Error(msg), { code: 'permission-denied' });

  return {
    demo: true,
    watchConfig(cb) {
      return sub(() => cb(cfg(), read('config', null) != null));
    },
    async saveConfig(patch) {
      write('config', Object.assign(read('config', {}), patch));
      emit();
    },
    async submit(name, items) {
      if (!cfg().open) throw denied('접수 마감');
      const n = read('counter', 0) + 1;
      const ps = read('photos', {});
      const ids = items.map(() => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      try {
        items.forEach((it, i) => {
          localStorage.setItem(K + 'full_' + ids[i], it.img);
          ps[ids[i]] = { no: n, name, idx: i + 1, total: items.length, thumb: it.thumb, w: it.w, h: it.h, status: 'new', createdAt: Date.now() };
        });
        write('photos', ps);
        write('counter', n);
      } catch (e) {
        ids.forEach(id => localStorage.removeItem(K + 'full_' + id));
        throw new Error('연습 모드 저장 공간이 꽉 찼어요. 관리 화면 설정에서 사진을 지워 주세요.');
      }
      emit();
      return { no: n, ids };
    },
    watchMine(ids, cb) {
      return sub(() => { const ps = read('photos', {}); ids.forEach(id => cb(id, ps[id] || null)); });
    },
    watchPhotos(cb) {
      return sub(() => cb(Object.entries(read('photos', {})).map(([id, d]) => Object.assign({}, d, { id }))));
    },
    async setStatus(ids, status) {
      const ps = read('photos', {});
      ids.forEach(id => { if (ps[id]) ps[id].status = status; });
      write('photos', ps);
      emit();
    },
    async getFull(id) {
      return localStorage.getItem(K + 'full_' + id);
    },
    async remove(ids) {
      const ps = read('photos', {});
      ids.forEach(id => { delete ps[id]; localStorage.removeItem(K + 'full_' + id); });
      write('photos', ps);
      emit();
    },
    async removeAll() {
      Object.keys(read('photos', {})).forEach(id => localStorage.removeItem(K + 'full_' + id));
      write('photos', {});
      emit();
    },
    async resetCounter() {
      write('counter', 0);
      emit();
    }
  };
}
