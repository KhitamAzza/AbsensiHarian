
    // ═══════════════════════════════════════
// CONFIG: Replace with your GAS Web App URL
// ═══════════════════════════════════════
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxEOU-SnORm2EG6Na5mU0x-8VvH0YB32mkP52cey3JqlsS3hgFdSA2ddq-lB8Eg--y8/exec';
// ═══════════════════════════════════════

const LS = d => `absensi_${d}`;
let students = [], todayDate = '', sheetData = [];

document.addEventListener('DOMContentLoaded', () => {
  const opt = { day:'numeric', month:'long', year:'numeric' };
  todayDate = new Date().toLocaleDateString('id-ID', opt);
  document.getElementById('currentDate').textContent = todayDate;

  checkToday();
  loadStudents();
});

/* ─── API: ALL requests go through POST with action in body ─── */
async function api(action, payload = {}) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload })
  });
  return res.json();
}

/* ─── Data calls ─── */
async function checkToday() {
  try {
    const r = await api('checkToday');
    if (r.available) {
      setStatus('ok','Siap Input',`Kolom ${r.date} tersedia`);
      document.getElementById('btnInput').disabled = false;
      loadToday();
    } else {
      setStatus('err','Gagal', r.error || 'Tidak bisa membuat kolom');
    }
  } catch (e) {
    setStatus('err','Error', e.message);
  }
}

async function loadStudents() {
  try {
    const r = await api('getStudents');
    students = r.students || [];
  } catch (e) { console.error(e); }
}

async function loadToday() {
  try {
    const r = await api('getTodayData', { date: todayDate });
    sheetData = r.data || [];
    render();
    updatePending();
  } catch (e) { console.error(e); }
}

async function syncData() {
  const key = LS(todayDate);
  const data = JSON.parse(localStorage.getItem(key) || '{}');
  const keys = Object.keys(data);
  if (!keys.length) { toast('Tidak ada data pending'); return; }

  const btn = document.getElementById('btnSync');
  btn.disabled = true; btn.innerHTML = '⏳ Mengirim...';

  try {
    const r = await api('submitLaporan', { date: todayDate, attendance: data });
    btn.disabled = false; btn.innerHTML = '📤 Submit Laporan';
    if (r.success) {
      localStorage.removeItem(key);
      toast('✅ Laporan terkirim!');
      loadToday();
    } else {
      toast('❌ Gagal: ' + (r.message||'unknown'));
    }
    updatePending();
  } catch (e) {
    btn.disabled = false; btn.innerHTML = '📤 Submit Laporan';
    toast('❌ Error: ' + e.message);
  }
}
    /* ─── UI helpers ─── */
    function setStatus(type, title, desc) {
      const icon = document.getElementById('statusIcon');
      icon.className = 'status-icon ' + (type==='ok'?'ok':type==='err'?'err':'load');
      icon.textContent = type==='ok'?'✅':type==='err'?'❌':'⏳';
      document.getElementById('statusTitle').textContent = title;
      document.getElementById('statusDesc').textContent = desc;
    }

    function toast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg; t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2500);
    }

    /* ─── Modal ─── */
    function openModal() {
      document.getElementById('modal').classList.add('open');
      document.body.style.overflow = 'hidden';
      setTimeout(() => document.getElementById('inNama').focus(), 100);
    }
    function closeModal() {
      document.getElementById('modal').classList.remove('open');
      document.body.style.overflow = '';
      resetForm();
    }
    function closeModalOut(e) { if (e.target.id === 'modal') closeModal(); }

    function resetForm() {
      document.getElementById('inNama').value = '';
      document.getElementById('inKelas').value = '';
      document.getElementById('inStatus').value = '';
      document.getElementById('inKet').value = '';
      document.getElementById('suggest').classList.remove('open');
    }

  /* ─── Predictive Nama ─── */
function filterNama() {
  const v = document.getElementById('inNama').value.toLowerCase().trim();
  const box = document.getElementById('suggest');
  if (!v) { box.classList.remove('open'); return; }
  const filtered = students.filter(s => s.nama.toLowerCase().includes(v));
  if (!filtered.length) { box.classList.remove('open'); return; }
  
  box.innerHTML = filtered.map((s, idx) =>
    `<div class="suggest-item" data-nama="${escapeHtml(s.nama)}" data-kelas="${escapeHtml(s.kelas)}">
      ${escapeHtml(s.nama)}<span>• ${escapeHtml(s.kelas)}</span>
    </div>`
  ).join('');
  box.classList.add('open');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Event delegation for suggest items — handles special chars safely
document.getElementById('suggest').addEventListener('click', function(e) {
  const item = e.target.closest('.suggest-item');
  if (!item) return;
  const nama = item.dataset.nama;
  const kelas = item.dataset.kelas;
  document.getElementById('inNama').value = nama;
  document.getElementById('inKelas').value = kelas;
  document.getElementById('suggest').classList.remove('open');
});

// Remove the old pickNama() function — no longer needed

    /* ─── Save to localStorage ─── */
    function saveLocal() {
      const nama = document.getElementById('inNama').value.trim();
      const kelas = document.getElementById('inKelas').value.trim();
      const status = document.getElementById('inStatus').value;
      const ket = document.getElementById('inKet').value.trim();

      if (!nama) { toast('Nama wajib diisi'); return; }
      if (!status) { toast('Status wajib dipilih'); return; }

      const key = LS(todayDate);
      const data = JSON.parse(localStorage.getItem(key) || '{}');
      data[nama] = { status, keterangan: ket, kelas };
      localStorage.setItem(key, JSON.stringify(data));

      toast('✅ Disimpan (lokal)');
      closeModal();
      render();
      updatePending();
    }

    function render() {
  const key = LS(todayDate);
  const local = JSON.parse(localStorage.getItem(key) || '{}');
  const box = document.getElementById('listBox');

  const merged = {};
  sheetData.forEach(d => {
    const p = d.value.split(' - ');
    merged[d.nama] = { nama: d.nama, kelas: d.kelas, status: p[0], ket: p[1] || '', src: 'sheet' };
  });
  for (const [n, item] of Object.entries(local)) {
    merged[n] = { nama: n, kelas: item.kelas, status: item.status, ket: item.keterangan || '', src: 'local' };
  }

  const items = Object.values(merged);
  if (!items.length) {
    box.innerHTML = '<div class="empty">Belum ada data absensi</div>';
    return;
  }

  box.innerHTML = items.map(it => {
    const bc = it.status === 'ALPHA' ? 'b-alpha' : it.status === 'SAKIT' ? 'b-sakit' : 'b-izin';
    const pending = it.src === 'local' ? '<span class="pending-tag">PENDING</span>' : '';
    const ket = it.ket ? `<div class="ket">${escapeHtml(it.ket)}</div>` : '';
    return `
      <div class="student-card" data-nama="${escapeHtml(it.nama)}" data-kelas="${escapeHtml(it.kelas)}" data-status="${escapeHtml(it.status)}" data-ket="${escapeHtml(it.ket)}">
        <div class="student-info">
          <h3>${escapeHtml(it.nama)} ${pending}</h3>
          <div class="kelas">${escapeHtml(it.kelas)}</div>
        </div>
        <div class="student-status">
          <span class="badge ${bc}">${escapeHtml(it.status)}</span>
          ${ket}
        </div>
      </div>`;
  }).join('');
}

// Event delegation for student cards
document.getElementById('listBox').addEventListener('click', function(e) {
  const card = e.target.closest('.student-card');
  if (!card) return;
  document.getElementById('inNama').value = card.dataset.nama;
  document.getElementById('inKelas').value = card.dataset.kelas;
  document.getElementById('inStatus').value = card.dataset.status;
  document.getElementById('inKet').value = card.dataset.ket;
  openModal();
});

// Remove the old editStudent() function — no longer needed

    function updatePending() {
  const key = LS(todayDate);
  const local = JSON.parse(localStorage.getItem(key) || '{}');
  const n = Object.keys(local).length;
  
  document.getElementById('pendingCount').textContent = n;
  document.getElementById('pendingBox').classList.toggle('active', n > 0);
  document.getElementById('btnSync').style.display = n > 0 ? 'flex' : 'none';
  
  // Show WA button if there's any data (local or sheet)
  const hasData = n > 0 || sheetData.length > 0;
  document.getElementById('btnWa').style.display = hasData ? 'flex' : 'none';
}

    document.addEventListener('click', e => {
      if (!e.target.closest('.field')) document.getElementById('suggest').classList.remove('open');
    });
/* ─── WhatsApp Report ─── */
async function kirimWa() {
  const btn = document.getElementById('btnWa');
  btn.disabled = true; btn.innerHTML = '⏳ Membuat laporan...';

  try {
    const r = await api('generateReport', { date: todayDate });
    btn.disabled = false; btn.innerHTML = '📱 Kirim WA';
    
    if (r.success) {
      window.open(r.waUrl, '_blank');
      toast('✅ Laporan tersimpan & WA dibuka');
    } else {
      toast('❌ Gagal: ' + (r.error || 'unknown'));
    }
  } catch (e) {
    btn.disabled = false; btn.innerHTML = '📱 Kirim WA';
    toast('❌ Error: ' + e.message);
  }
}
