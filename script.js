// ═══════════════════════════════════════
// CONFIG: Replace with your GAS Web App URL
// ═══════════════════════════════════════
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxEOU-SnORm2EG6Na5mU0x-8VvH0YB32mkP52cey3JqlsS3hgFdSA2ddq-lB8Eg--y8/exec';
// ═══════════════════════════════════════

const LS = d => `absensi_${d}`;
const LSK = d => `absensi_kembali_${d}`;
let students = [], todayDate = '', sheetData = [];
let kembaliData = []; // Data from Absensi Kembali sheet
let kembaliLocal = {}; // Local changes before sync
let kembaliFilter = 'all'; // Current filter
let kembaliAvailable = false; // Whether today's column exists

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const opt = { day:'numeric', month:'long', year:'numeric' };
  todayDate = new Date().toLocaleDateString('id-ID', opt);
  document.getElementById('currentDate').textContent = todayDate;

  // Show loading overlay and fetch all data before showing app
  initAppWithLoading();

  // Setup event delegation for suggest dropdown
  document.getElementById('suggest').addEventListener('click', function(e) {
    const item = e.target.closest('.suggest-item');
    if (!item) return;
    document.getElementById('inNama').value = item.dataset.nama;
    document.getElementById('inKelas').value = item.dataset.kelas;
    document.getElementById('suggest').classList.remove('open');
  });

  // Setup event delegation for student cards
  document.getElementById('listBox').addEventListener('click', function(e) {
    if (e.target.closest('.del-btn')) return;
    const card = e.target.closest('.student-card');
    if (!card) return;
    document.getElementById('inNama').value = card.dataset.nama;
    document.getElementById('inKelas').value = card.dataset.kelas;
    document.getElementById('inStatus').value = card.dataset.status;
    document.getElementById('inKet').value = card.dataset.ket;
    openModal();
  });

  // Close suggest on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.field')) document.getElementById('suggest').classList.remove('open');
  });
});

// ═══════════════════════════════════════
// API: ALL requests go through POST with action in body
// ═══════════════════════════════════════
async function api(action, payload = {}) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload })
  });
  return res.json();
}

// ═══════════════════════════════════════
// INIT APP - Load all data
// ═══════════════════════════════════════
async function initAppWithLoading() {
  const loading = document.getElementById('loadingOverlay');
  const subtext = document.getElementById('loadingSubtext');

  try {
    // Step 1: Check attendance column
    subtext.textContent = 'Memeriksa kolom absensi...';
    await checkToday();

    // Step 2: Load student list
    subtext.textContent = 'Memuat daftar siswa...';
    await loadStudents();

    // Step 3: Check and load absensi kembali
    subtext.textContent = 'Memuat data absensi kembali...';
    await initKembali();

    // All done - hide loading
    subtext.textContent = 'Siap!';
    loading.classList.add('hidden');

  } catch (e) {
    console.error('Init error:', e);
    subtext.textContent = 'Error: ' + e.message;
    toast('❌ Error memuat data: ' + e.message);
    // Still hide loading after a delay so user can see error
    setTimeout(() => loading.classList.add('hidden'), 2000);
  }
}

// Keep old initApp for compatibility (just calls the new one)
async function initApp() {
  return initAppWithLoading();
}

// ═══════════════════════════════════════
// DATA CALLS - Attendance
// ═══════════════════════════════════════
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
    updateWaFabState();
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

/* ─── Delete data ─── */
async function hapusData(btn) {
  const nama = btn.dataset.nama;
  const src = btn.dataset.src;

  if (!confirm(`Hapus absensi untuk ${nama}?`)) return;

  const key = LS(todayDate);
  const local = JSON.parse(localStorage.getItem(key) || '{}');
  if (local[nama]) {
    delete local[nama];
    localStorage.setItem(key, JSON.stringify(local));
  }

  if (src === 'sheet') {
    try {
      const r = await api('deleteAttendance', { date: todayDate, nama: nama });
      if (!r.success) {
        toast('❌ Gagal hapus: ' + (r.error || 'unknown'));
        return;
      }
    } catch (e) {
      toast('❌ Error: ' + e.message);
      return;
    }
  }

  toast('✅ Data dihapus');
  loadToday();
}

// ═══════════════════════════════════════
// DATA CALLS - Absensi Kembali
// ═══════════════════════════════════════
async function initKembali() {
  try {
    // First check if today's column exists
    const r = await api('checkTodayAbsensiKembali');
    console.log('checkTodayAbsensiKembali response:', r);

    if (r.available) {
      kembaliAvailable = true;
      await loadKembali();
    } else {
      console.error('Absensi Kembali not available:', r.error);
      toast('⚠️ Sheet Absensi Kembali belum siap: ' + (r.error || 'Unknown error'));
    }
  } catch (e) {
    console.error('initKembali error:', e);
    toast('❌ Error memuat Absensi Kembali: ' + e.message);
  }
}

async function loadKembali() {
  try {
    console.log('Loading kembali data for date:', todayDate);
    const r = await api('getAbsensiKembali', { date: todayDate });
    console.log('getAbsensiKembali response:', r);

    if (r.success) {
      kembaliData = r.data || [];
      console.log('Kembali data loaded:', kembaliData.length, 'items');

      // Merge with local changes
      const localKey = LSK(todayDate);
      kembaliLocal = JSON.parse(localStorage.getItem(localKey) || '{}');

      updateKembaliBadge();
      updateWaFabState();
    } else {
      console.error('getAbsensiKembali failed:', r.error);
      toast('❌ Gagal memuat data kembali: ' + (r.error || 'Unknown'));
    }
  } catch (e) { 
    console.error('loadKembali error:', e);
    toast('❌ Error memuat data kembali: ' + e.message);
  }
}

async function simpanKembali() {
  const btn = document.getElementById('btnSimpanKembali');
  btn.disabled = true;
  btn.innerHTML = '⏳ Menyimpan...';

  try {
    const payload = {};
    // Merge sheet data with local changes
    kembaliData.forEach(item => {
      const kelas = item.kelas;
      payload[kelas] = kembaliLocal[kelas] || item.status || 'BELUM';
    });
    // Also include any local-only changes
    Object.entries(kembaliLocal).forEach(([kelas, status]) => {
      if (!payload[kelas]) payload[kelas] = status;
    });

    console.log('Saving kembali data:', payload);
    const r = await api('updateAbsensiKembali', { 
      date: todayDate, 
      attendance: payload 
    });

    btn.disabled = false;
    btn.innerHTML = '💾 Simpan Data';

    if (r.success) {
      localStorage.removeItem(LSK(todayDate));
      kembaliLocal = {};
      toast('✅ Data absensi kembali tersimpan!');
      closeKembaliModal();
      await loadKembali(); // Refresh data
    } else {
      toast('❌ Gagal: ' + (r.error || 'unknown'));
    }
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = '💾 Simpan Data';
    toast('❌ Error: ' + e.message);
  }
}

// ═══════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════
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

// ═══════════════════════════════════════
// MODAL - Input Absensi
// ═══════════════════════════════════════
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

function closeModalOut(e) { 
  if (e.target.id === 'modal') closeModal(); 
}

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

  box.innerHTML = filtered.map(s =>
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

// ═══════════════════════════════════════
// RENDER - Attendance List
// ═══════════════════════════════════════
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
      <div class="student-card" data-nama="${escapeHtml(it.nama)}" data-kelas="${escapeHtml(it.kelas)}" data-status="${escapeHtml(it.status)}" data-ket="${escapeHtml(it.ket)}" data-src="${it.src}">
        <div class="student-info">
          <h3>${escapeHtml(it.nama)} ${pending}</h3>
          <div class="kelas">${escapeHtml(it.kelas)}</div>
        </div>
        <div class="student-status" style="display:flex;align-items:center;gap:8px;">
          <span class="badge ${bc}">${escapeHtml(it.status)}</span>
          ${ket}
          <button class="del-btn" data-nama="${escapeHtml(it.nama)}" data-src="${it.src}" onclick="event.stopPropagation();hapusData(this)">🗑️</button>
        </div>
      </div>`;
  }).join('');
}

function updatePending() {
  const key = LS(todayDate);
  const local = JSON.parse(localStorage.getItem(key) || '{}');
  const n = Object.keys(local).length;

  document.getElementById('pendingCount').textContent = n;
  document.getElementById('pendingBox').classList.toggle('active', n > 0);
  document.getElementById('btnSync').style.display = n > 0 ? 'flex' : 'none';
}

// ═══════════════════════════════════════
// MODAL - Absensi Kembali
// ═══════════════════════════════════════
function openKembaliModal() {
  // Ensure data is loaded before showing
  if (!kembaliData.length && kembaliAvailable) {
    loadKembali().then(() => {
      document.getElementById('kembaliModal').classList.add('open');
      document.body.style.overflow = 'hidden';
      renderKembaliList();
    });
  } else {
    document.getElementById('kembaliModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    renderKembaliList();
  }
}

function closeKembaliModal() {
  document.getElementById('kembaliModal').classList.remove('open');
  document.body.style.overflow = '';
}

function closeKembaliModalOut(e) {
  if (e.target.id === 'kembaliModal') closeKembaliModal();
}

function renderKembaliList() {
  const filterBox = document.getElementById('kembaliFilter');
  const listBox = document.getElementById('kembaliList');

  console.log('Rendering kembali list, data:', kembaliData);

  // Hide filter box - no filters needed, show all
  filterBox.style.display = 'none';

  if (!kembaliData || kembaliData.length === 0) {
    listBox.innerHTML = '<div class="kembali-empty">Memuat data kelas...</div>';
    return;
  }

  // Group by grade for display (X, XI, XII sections)
  const grouped = {};
  kembaliData.forEach(item => {
    if (!item.kelas) return;
    // Extract first word as grade: "X DKV" → "X", "XI TSM" → "XI"
    const grade = item.kelas.split(/\s/)[0] || 'Lainnya';
    if (!grouped[grade]) grouped[grade] = [];
    grouped[grade].push(item);
  });

  // Render grouped list - all classes visible, no filtering
  let html = '';
  Object.entries(grouped).forEach(([grade, items]) => {
    html += `<div class="kembali-class-group">`;
    html += `<div class="kembali-class-title">Kelas ${grade}</div>`;
    items.forEach(item => {
      // Use local value if exists, otherwise use sheet value
      const status = kembaliLocal[item.kelas] || item.status || 'BELUM';
      const isKembali = status === 'KEMBALI';
      const className = isKembali ? 'kembali' : 'belum';
      const statusText = isKembali ? 'Kembali' : 'Belum';

      html += `
        <div class="kembali-item ${className}" data-kelas="${escapeHtml(item.kelas)}" onclick="toggleKembaliStatus('${escapeHtml(item.kelas)}')">
          <div class="kembali-item-name">${escapeHtml(item.kelas)}</div>
          <div class="kembali-item-status">${statusText}</div>
        </div>`;
    });
    html += `</div>`;
  });

  listBox.innerHTML = html;
}

function setKembaliFilter(grade) {
  kembaliFilter = grade;
  renderKembaliList();
}

function toggleKembaliStatus(kelas) {
  // Get current status (from local or sheet)
  const sheetItem = kembaliData.find(k => k.kelas === kelas);
  const currentStatus = kembaliLocal[kelas] || sheetItem?.status || 'BELUM';

  // Toggle
  const newStatus = currentStatus === 'KEMBALI' ? 'BELUM' : 'KEMBALI';

  // Save to local
  kembaliLocal[kelas] = newStatus;
  const localKey = LSK(todayDate);
  localStorage.setItem(localKey, JSON.stringify(kembaliLocal));

  // Re-render
  renderKembaliList();
  updateKembaliBadge();
  updateWaFabState();
}

function updateKembaliBadge() {
  // Count how many are BELUM (from sheet data, overridden by local)
  let belumCount = 0;
  kembaliData.forEach(item => {
    if (!item.kelas) return;
    const status = kembaliLocal[item.kelas] || item.status || 'BELUM';
    if (status !== 'KEMBALI') belumCount++;
  });

  const badge = document.getElementById('kembaliBadge');
  badge.textContent = belumCount;
  badge.classList.toggle('hidden', belumCount === 0);
}

// ═══════════════════════════════════════
// FAB - WhatsApp
// ═══════════════════════════════════════
function updateWaFabState() {
  const fabWa = document.getElementById('fabWa');

  // Check if all absensi kembali are marked as KEMBALI
  let allKembali = true;
  if (kembaliData.length === 0) {
    allKembali = false; // No data yet, disable
  } else {
    kembaliData.forEach(item => {
      if (!item.kelas) return;
      const status = kembaliLocal[item.kelas] || item.status || 'BELUM';
      if (status !== 'KEMBALI') allKembali = false;
    });
  }

  // Also check if there's attendance data to send
  const hasAttendance = sheetData.length > 0 || Object.keys(JSON.parse(localStorage.getItem(LS(todayDate)) || '{}')).length > 0;

  if (allKembali && hasAttendance) {
    fabWa.classList.add('active');
    fabWa.disabled = false;
  } else {
    fabWa.classList.remove('active');
    fabWa.disabled = !hasAttendance;
  }
}

function handleWaClick() {
  const fabWa = document.getElementById('fabWa');

  // Check if all absensi kembali are marked as KEMBALI
  let allKembali = true;
  let belumKelas = [];

  kembaliData.forEach(item => {
    if (!item.kelas) return;
    const status = kembaliLocal[item.kelas] || item.status || 'BELUM';
    if (status !== 'KEMBALI') {
      allKembali = false;
      belumKelas.push(item.kelas);
    }
  });

  if (!allKembali) {
    toast('❌ Ada absensi belum kembali');
    return;
  }

  kirimWa();
}

// ═══════════════════════════════════════
// WHATSAPP REPORT
// ═══════════════════════════════════════
let waPreviewData = null;

async function kirimWa() {
  const btn = document.getElementById('fabWa');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="fab-icon">⏳</span>';

  try {
    const r = await api('generateReport', { date: todayDate });
    btn.disabled = false;
    btn.innerHTML = originalHtml;

    if (r.success) {
      waPreviewData = r;
      openWaModal(r);
    } else {
      toast('❌ Gagal: ' + (r.error || 'unknown'));
    }
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    toast('❌ Error: ' + e.message);
  }
}

function openWaModal(data) {
  const modal = document.getElementById('waModal');
  const listBox = document.getElementById('waPreviewList');
  const summary = document.getElementById('waPreviewSummary');
  const searchInput = document.getElementById('waSearchInput');

  searchInput.value = '';

  const lines = data.waText.split('\n');
  let currentKelas = '';
  let items = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('*Laporan') || line === '—' || line.startsWith('Total siswa') || line.startsWith('Ketidakhadiran')) continue;

    if (line.startsWith('*') && line.endsWith('*') && !line.includes('•') && !line.includes('-')) {
      currentKelas = line.replace(/\*/g, '');
    } else if (line.startsWith('•') || line.includes(' - ')) {
      const cleanLine = line.replace(/^•\s*/, '');
      const match = cleanLine.match(/^(.+?)\s+-\s+([A-Z]+)(?:\s+—\s+(.+))?$/);
      if (match) {
        items.push({
          nama: match[1].trim(),
          kelas: currentKelas,
          status: match[2],
          keterangan: match[3] || '',
          fullLine: cleanLine
        });
      }
    }
  }

  waPreviewData.items = items;
  renderWaPreview(items);

  const totalKelas = [...new Set(items.map(i => i.kelas))].length;
  summary.textContent = `${items.length} siswa • ${totalKelas} kelas`;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function renderWaPreview(items) {
  const listBox = document.getElementById('waPreviewList');

  if (!items.length) {
    listBox.innerHTML = '<div class="empty" style="padding:20px;">Tidak ada data ketidakhadiran</div>';
    return;
  }

  listBox.innerHTML = items.map((item, idx) => {
    const bc = item.status === 'ALPHA' ? 'b-alpha' : item.status === 'SAKIT' ? 'b-sakit' : 'b-izin';
    const ket = item.keterangan ? ` — ${escapeHtml(item.keterangan)}` : '';
    return `
      <div class="wa-preview-item" data-nama="${escapeHtml(item.nama.toLowerCase())}" data-idx="${idx}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div class="nama">${escapeHtml(item.nama)}</div>
            <div class="detail">${escapeHtml(item.kelas)}${ket}</div>
          </div>
          <span class="badge ${bc}">${item.status}</span>
        </div>
      </div>`;
  }).join('');
}

function filterWaPreview() {
  const query = document.getElementById('waSearchInput').value.toLowerCase().trim();
  const items = document.querySelectorAll('.wa-preview-item');

  items.forEach(item => {
    const nama = item.dataset.nama;
    if (!query || nama.includes(query)) {
      item.classList.remove('hidden');
    } else {
      item.classList.add('hidden');
    }
  });
}

function confirmWaSend() {
  if (!waPreviewData) return;

  window.open(waPreviewData.waUrl, '_blank');
  closeWaModal();
  toast('✅ Laporan terkirim ke WhatsApp');
}

function closeWaModal() {
  document.getElementById('waModal').classList.remove('open');
  document.body.style.overflow = '';
  waPreviewData = null;
}

function closeWaModalOut(e) {
  if (e.target.id === 'waModal') closeWaModal();
}
