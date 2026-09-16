/**
 * UniStudio Front-end SPA Engine - Interactive Live Status & Admin Direct Booking
 */

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyKQyy-ZMhzCUNIdM2vDFK7-af3kZKkLF_Ev_T8r_Xe3P5Ong9FDr_Kh0ha-VZzOLXt/exec';

// Immediate LocalStorage-backed state for zero-wait loads
let db = {
  studios: JSON.parse(localStorage.getItem('uni_studios') || '[]'),
  operators: JSON.parse(localStorage.getItem('uni_operators') || '[]'),
  faculty: JSON.parse(localStorage.getItem('uni_faculty') || '[]'),
  bookings: JSON.parse(localStorage.getItem('uni_bookings') || '[]'),
  users: JSON.parse(localStorage.getItem('uni_users') || '[]')
};

let authSession = JSON.parse(localStorage.getItem('unistudio_session') || 'null');
let currentExportContext = 'admin';
let liveTelemetryTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  const today = getTodayDateStr();
  const dateIds = ['bookDate', 'operatorDateFilter', 'facultyFilterDate', 'adminLiveDate', 'auditFilterDate', 'adminBookDate', 'modalLiveDateSelect', 'exportStartDate', 'exportEndDate'];
  dateIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today;
  });

  if (authSession) {
    initDashboard();
    fetchDatabase();
  } else {
    showLoginView();
  }

  // Periodic heartbeat sync & clock updates
  setInterval(() => {
    if (authSession) fetchDatabase();
  }, 45000);
});

function getTodayDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeToMinutes(val) {
  if (!val) return 0;
  let str = String(val).trim();
  if (str.includes('1899-12-30') || str.includes('T')) {
    const parts = str.split(' ');
    str = parts.length > 1 ? parts[1] : parts[0];
  }
  const chunks = str.split(':');
  if (chunks.length < 2) return 0;
  return (parseInt(chunks[0], 10) || 0) * 60 + (parseInt(chunks[1], 10) || 0);
}

function cleanTimeStr(val) {
  if (!val) return '';
  let str = String(val);
  if (str.includes('1899-12-30') || str.includes('T')) {
    const parts = str.split(' ');
    str = parts.length > 1 ? parts[1] : parts[0];
  }
  return str.slice(0, 5);
}

function formatDateStr(d) {
  if (!d) return '';
  if (typeof d === 'string') {
    if (d.includes('T')) return d.split('T')[0];
    if (d.includes(' ')) return d.split(' ')[0];
    return d.slice(0, 10);
  }
  return d.toString().slice(0, 10);
}

// ---------------- AUTH & SESSION ----------------

function showLoginView() {
  authSession = null;
  localStorage.removeItem('unistudio_session');
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('appContent').classList.add('hidden');
  document.getElementById('headerAuthSection').classList.add('hidden');
  ['panel-admin', 'panel-faculty', 'panel-operator'].forEach(p => {
    document.getElementById(p).classList.add('hidden');
  });
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  const errorBox = document.getElementById('loginError');
  errorBox.classList.add('hidden');

  if (username === 'admin' && password === 'admin123') {
    authSession = { UserID: 'USR-ADMIN', Username: 'admin', Role: 'admin', RefID: 'ADMIN' };
    localStorage.setItem('unistudio_session', JSON.stringify(authSession));
    initDashboard();
    fetchDatabase();
    return;
  }

  showSyncPill(true);
  try {
    const res = await postApi('login', { username, password }, false);
    authSession = res.user;
    localStorage.setItem('unistudio_session', JSON.stringify(authSession));
    initDashboard();
    fetchDatabase();
  } catch (err) {
    errorBox.innerText = err.message || 'Login failed. Verify credentials.';
    errorBox.classList.remove('hidden');
  } finally {
    showSyncPill(false);
  }
}

function logout() {
  authSession = null;
  localStorage.removeItem('unistudio_session');
  showLoginView();
  notify('Logged out safely.', 'success');
}

function initDashboard() {
  if (!authSession) return showLoginView();

  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('appContent').classList.remove('hidden');
  document.getElementById('headerAuthSection').classList.remove('hidden');

  document.getElementById('loggedInUserLabel').innerText = authSession.Username;
  document.getElementById('loggedInRoleBadge').innerText = authSession.Role;

  ['panel-admin', 'panel-faculty', 'panel-operator'].forEach(p => {
    document.getElementById(p).classList.add('hidden');
  });

  if (authSession.Role === 'admin') {
    document.getElementById('panel-admin').classList.remove('hidden');
    refreshAdminUI();
  } else if (authSession.Role === 'faculty') {
    document.getElementById('panel-faculty').classList.remove('hidden');
    refreshFacultyUI();
  } else if (authSession.Role === 'operator') {
    document.getElementById('panel-operator').classList.remove('hidden');
    refreshOperatorUI();
  }
}

// ---------------- DATA PERSISTENCE & SYNC ----------------

function persistCache() {
  localStorage.setItem('uni_studios', JSON.stringify(db.studios));
  localStorage.setItem('uni_operators', JSON.stringify(db.operators));
  localStorage.setItem('uni_faculty', JSON.stringify(db.faculty));
  localStorage.setItem('uni_bookings', JSON.stringify(db.bookings));
  localStorage.setItem('uni_users', JSON.stringify(db.users));
}

async function fetchDatabase() {
  showSyncPill(true);
  try {
    const res = await fetch(`${SCRIPT_URL}?action=getAllData&_t=${Date.now()}`);
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message);

    db.studios = data.studios || [];
    db.operators = data.operators || [];
    db.faculty = data.faculty || [];
    db.bookings = data.bookings || [];
    db.users = data.users || [];

    persistCache();

    if (authSession) {
      if (authSession.Role === 'admin') refreshAdminUI();
      else if (authSession.Role === 'faculty') refreshFacultyUI();
      else if (authSession.Role === 'operator') refreshOperatorUI();
    }
  } catch (err) {
    console.error('Sync error:', err);
  } finally {
    showSyncPill(false);
  }
}

async function postApi(action, dataPayload, autoRefresh = true) {
  showSyncPill(true);
  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, data: dataPayload })
    });
    const resJson = await res.json();
    if (resJson.status === 'error') throw new Error(resJson.message);

    if (autoRefresh) {
      fetchDatabase();
    }
    return resJson;
  } catch (err) {
    notify(err.message || 'Action failed', 'error');
    throw err;
  } finally {
    showSyncPill(false);
  }
}

function showSyncPill(show) {
  const pill = document.getElementById('syncPill');
  if (pill) {
    if (show) { pill.classList.remove('hidden'); pill.classList.add('flex'); }
    else { pill.classList.add('hidden'); pill.classList.remove('flex'); }
  }
}

// ---------------- ADMIN PANEL ----------------

function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));

  document.getElementById(`adminTabBtn-${tab}`).classList.add('active');
  document.getElementById(`adminTab-${tab}`).classList.remove('hidden');

  if (tab === 'live') renderLiveStudioBoard();
  if (tab === 'bookings') renderAdminBookings();
  if (tab === 'bookForFaculty') populateAdminBookForFacultyForm();
  if (tab === 'audit') renderAdminAuditTable();
  if (tab === 'studios') renderAdminStudios();
  if (tab === 'operators') renderAdminOperators();
  if (tab === 'faculty') renderAdminFaculty();
}

function refreshAdminUI() {
  const today = getTodayDateStr();
  const todayBookings = db.bookings.filter(b => formatDateStr(b.Date) === today);

  document.getElementById('stat-studios').innerText = db.studios.length;
  document.getElementById('stat-pending').innerText = db.bookings.filter(b => b.Status === 'Pending').length;
  document.getElementById('stat-completed').innerText = todayBookings.filter(b => b.Status === 'Completed').length;
  const totalMins = todayBookings.reduce((sum, b) => sum + (Number(b.DurationMinutes) || 0), 0);
  document.getElementById('stat-duration').innerText = `${totalMins} m`;

  renderLiveStudioBoard();
  renderAdminBookings();
  renderAdminAuditTable();
  renderAdminStudios();
  renderAdminOperators();
  renderAdminFaculty();
  populateAdminBookForFacultyForm();
}

function renderLiveStudioBoard() {
  const container = document.getElementById('liveStudiosContainer');
  const targetDate = document.getElementById('adminLiveDate').value || getTodayDateStr();
  container.innerHTML = '';

  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const isTargetToday = targetDate === getTodayDateStr();

  db.studios.forEach(studio => {
    const operator = db.operators.find(o => String(o.OperatorID).trim() === String(studio.OperatorID).trim() || String(o.AssignedStudioID).trim() === String(studio.StudioID).trim());
    const dayBookings = db.bookings.filter(b => String(b.StudioID).trim() === String(studio.StudioID).trim() && formatDateStr(b.Date) === targetDate && b.Status !== 'Rejected');

    let studioState = { label: 'Idle / Vacant', badgeClass: 'bg-slate-100 text-slate-600' };
    const inProgress = dayBookings.find(b => b.Status === 'In-Progress');
    if (inProgress) {
      studioState = { label: 'RECORDING NOW', badgeClass: 'bg-rose-500 text-white animate-pulse' };
    } else if (isTargetToday) {
      const overdue = dayBookings.find(b => b.Status === 'Approved' && timeToMinutes(b.StartTime) < nowMinutes && timeToMinutes(b.EndTime) > nowMinutes);
      if (overdue) {
        studioState = { label: 'OVERDUE (NOT STARTED)', badgeClass: 'bg-rose-100 text-rose-700 font-bold border border-rose-300' };
      }
    }

    let itemsHtml = '';
    if (dayBookings.length === 0) {
      itemsHtml = `<div class="p-3 text-center text-slate-400 text-xs italic bg-slate-50 rounded-xl">No slots scheduled.</div>`;
    } else {
      dayBookings.sort((a, b) => timeToMinutes(a.StartTime) - timeToMinutes(b.StartTime)).forEach(b => {
        let colorClass = 'bg-slate-50 border-slate-200 text-slate-700';
        let statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">${b.Status}</span>`;

        if (b.Status === 'In-Progress') {
          colorClass = 'bg-rose-50 border-rose-200 text-rose-900 shadow-sm';
          statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-600 text-white animate-pulse">RECORDING</span>`;
        } else if (b.Status === 'Completed') {
          colorClass = 'bg-emerald-50 border-emerald-200 text-emerald-900';
          statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white">COMPLETED (${b.DurationMinutes}m)</span>`;
        } else if (b.Status === 'Not-Recorded') {
          colorClass = 'bg-rose-50 border-rose-200 text-rose-800';
          statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-200 text-rose-800">NOT RECORDED</span>`;
        } else if (b.Status === 'Approved') {
          colorClass = 'bg-amber-50 border-amber-200 text-amber-900';
          statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white">IN QUEUE</span>`;
        }

        itemsHtml += `
          <div class="p-2.5 rounded-xl border text-xs flex justify-between items-center ${colorClass}">
            <div>
              <div class="font-bold">${cleanTimeStr(b.StartTime)} - ${cleanTimeStr(b.EndTime)} • <span class="font-mono">${b.CourseCode}</span></div>
              <div class="text-[11px] opacity-80">${b.FacultyName} (${b.UnitNo} • ${b.LectureNo})</div>
              ${b.Remarks ? `<div class="text-[10px] text-rose-700 font-semibold mt-0.5"><i class="fa-solid fa-comment mr-1"></i>${b.Remarks}</div>` : ''}
            </div>
            <div class="text-right">${statusBadge}</div>
          </div>
        `;
      });
    }

    const card = document.createElement('div');
    card.className = 'bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4';
    card.innerHTML = `
      <div class="flex justify-between items-start">
        <div>
          <span class="text-xs font-mono font-bold text-indigo-600">${studio.StudioID}</span>
          <h3 class="text-base font-bold text-slate-800">${studio.StudioName}</h3>
          <p class="text-xs text-slate-400">${studio.Location}</p>
        </div>
        <span class="px-2.5 py-1 rounded-full text-xs font-bold ${studioState.badgeClass}">${studioState.label}</span>
      </div>
      <div class="p-2 bg-slate-50 rounded-xl text-xs flex justify-between border border-slate-100">
        <span class="text-slate-500">Incharge: <strong>${operator ? operator.Name : 'Unassigned'}</strong></span>
        <span class="text-slate-400 font-mono">${operator ? operator.Phone : ''}</span>
      </div>
      <div class="space-y-2">
        <div class="text-xs font-bold uppercase tracking-wider text-slate-400">Scheduled Queue</div>
        ${itemsHtml}
      </div>
    `;
    container.appendChild(card);
  });
}

function renderAdminBookings() {
  const tbody = document.getElementById('adminBookingsTableBody');
  const filter = document.getElementById('filterBookingStatus').value;
  tbody.innerHTML = '';

  const list = db.bookings.filter(b => filter === 'All' || b.Status === filter);
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-400">No matching bookings found</td></tr>`;
    return;
  }

  list.forEach(b => {
    const studio = db.studios.find(s => String(s.StudioID).trim() === String(b.StudioID).trim()) || { StudioName: b.StudioID };
    let act = `<button onclick="openEditSlotModal('${b.BookingID}')" class="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-bold mr-1">Edit</button>`;
    if (b.Status === 'Pending') {
      act += `
        <button onclick="changeBookingStatus('${b.BookingID}', 'Approved')" class="px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold mr-1">Approve</button>
        <button onclick="changeBookingStatus('${b.BookingID}', 'Rejected')" class="px-2 py-1 text-xs bg-rose-600 hover:bg-rose-700 text-white rounded font-bold">Reject</button>
      `;
    }

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50';
    tr.innerHTML = `
      <td class="py-3 px-4 font-mono font-bold text-slate-700">${b.BookingID}</td>
      <td class="py-3 px-4"><strong>${b.FacultyName}</strong><div class="text-xs text-slate-400 font-mono">${b.FacultyID}</div></td>
      <td class="py-3 px-4 font-medium">${studio.StudioName}</td>
      <td class="py-3 px-4"><div>${formatDateStr(b.Date)}</div><div class="text-xs text-slate-400 font-mono">${cleanTimeStr(b.StartTime)} - ${cleanTimeStr(b.EndTime)}</div></td>
      <td class="py-3 px-4"><span class="font-bold text-indigo-700">${b.CourseCode}</span><div class="text-xs text-slate-500">${b.UnitNo} • ${b.LectureNo}</div></td>
      <td class="py-3 px-4">${getStatusBadge(b.Status, b)}</td>
      <td class="py-3 px-4 font-mono">${b.DurationMinutes ? `${b.DurationMinutes}m` : '-'}</td>
      <td class="py-3 px-4 text-right">${act}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ADMIN DIRECT BOOKING FOR REGISTERED FACULTY
function populateAdminBookForFacultyForm() {
  const facultySelect = document.getElementById('adminBookFacultySelect');
  const studioSelect = document.getElementById('adminBookStudioId');
  if (!facultySelect || !studioSelect) return;

  facultySelect.innerHTML = '<option value="">-- Choose Registered Faculty --</option>';
  db.faculty.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.FacultyID;
    opt.innerText = `${f.Name} (${f.FacultyID} - ${f.Department})`;
    facultySelect.appendChild(opt);
  });

  studioSelect.innerHTML = '<option value="">-- Choose Studio Facility --</option>';
  db.studios.filter(s => s.Status === 'Active').forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.StudioID;
    opt.innerText = `${s.StudioName} (${s.Location})`;
    studioSelect.appendChild(opt);
  });
}

function checkAdminBookingAvailability() {
  const studioId = document.getElementById('adminBookStudioId').value;
  const date = document.getElementById('adminBookDate').value;
  const startStr = document.getElementById('adminBookStartTime').value;
  const endStr = document.getElementById('adminBookEndTime').value;
  const notice = document.getElementById('adminBookingNotice');

  if (!studioId || !date || !startStr || !endStr) {
    notice.classList.add('hidden');
    return true;
  }

  const reqStart = timeToMinutes(startStr);
  const reqEnd = timeToMinutes(endStr);

  if (reqEnd <= reqStart) {
    notice.className = 'text-xs p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold';
    notice.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1.5"></i> End time must be after start time.`;
    notice.classList.remove('hidden');
    return false;
  }

  const conflict = db.bookings.find(b => {
    if (String(b.StudioID).trim() !== String(studioId).trim() || formatDateStr(b.Date) !== formatDateStr(date) || b.Status === 'Rejected') return false;
    return Math.max(reqStart, timeToMinutes(b.StartTime)) < Math.min(reqEnd, timeToMinutes(b.EndTime));
  });

  if (conflict) {
    notice.className = 'text-xs p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-700 font-bold';
    notice.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1.5"></i> UNAVAILABLE: Studio already occupied by <strong>${conflict.FacultyName}</strong> (${cleanTimeStr(conflict.StartTime)} - ${cleanTimeStr(conflict.EndTime)}) [${conflict.Status}].`;
    notice.classList.remove('hidden');
    return false;
  } else {
    notice.className = 'text-xs p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 font-bold';
    notice.innerHTML = `<i class="fa-solid fa-circle-check mr-1.5"></i> Studio interval is VACANT and ready for instant reservation!`;
    notice.classList.remove('hidden');
    return true;
  }
}

async function handleAdminBookingForFaculty(e) {
  e.preventDefault();
  if (!checkAdminBookingAvailability()) return notify('Selected interval is already booked. Pick another time.', 'error');

  const facultyId = document.getElementById('adminBookFacultySelect').value;
  const facultyObj = db.faculty.find(f => String(f.FacultyID).trim() === String(facultyId).trim());
  if (!facultyObj) return notify('Please select a valid registered faculty member', 'error');

  const payload = {
    BookingID: 'BKG-' + new Date().getTime().toString().slice(-6),
    FacultyID: facultyObj.FacultyID,
    FacultyName: facultyObj.Name,
    StudioID: document.getElementById('adminBookStudioId').value,
    Date: document.getElementById('adminBookDate').value,
    StartTime: document.getElementById('adminBookStartTime').value,
    EndTime: document.getElementById('adminBookEndTime').value,
    CourseCode: document.getElementById('adminBookCourseCode').value.trim().toUpperCase(),
    UnitNo: document.getElementById('adminBookUnitNo').value.trim(),
    LectureNo: document.getElementById('adminBookLecNo').value.trim(),
    Topic: document.getElementById('adminBookTopic').value.trim(),
    Status: 'Approved', // Auto-approved because admin booked it
    ActualStartTime: '',
    ActualEndTime: '',
    DurationMinutes: 0,
    Remarks: ''
  };

  db.bookings.push(payload);
  persistCache();
  refreshAdminUI();

  document.getElementById('adminBookingForm').reset();
  document.getElementById('adminBookingNotice').classList.add('hidden');
  switchAdminTab('bookings');

  await postApi('createBooking', payload);
  await postApi('updateBookingStatus', { bookingId: payload.BookingID, status: 'Approved' });
  notify(`Slot successfully reserved & approved for ${facultyObj.Name}!`, 'success');
}

// NON-RECORDED AUDIT WITH CALENDAR DATE FILTER
function renderAdminAuditTable() {
  const tbody = document.getElementById('adminAuditTableBody');
  const filterDate = document.getElementById('auditFilterDate').value;
  tbody.innerHTML = '';

  let missed = db.bookings.filter(b => b.Status === 'Not-Recorded' || (b.Status === 'Approved' && formatDateStr(b.Date) < getTodayDateStr()));
  if (filterDate) {
    missed = missed.filter(b => formatDateStr(b.Date) === filterDate);
  }

  if (missed.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400">No non-recorded sessions found for this date.</td></tr>`;
    return;
  }

  missed.forEach(b => {
    const studio = db.studios.find(s => String(s.StudioID).trim() === String(b.StudioID).trim()) || { StudioName: b.StudioID };
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-rose-50/50';
    tr.innerHTML = `
      <td class="py-3 px-4 font-mono">${formatDateStr(b.Date)}</td>
      <td class="py-3 px-4 font-bold text-slate-800">${b.FacultyName} <span class="text-xs text-slate-400 font-mono">(${b.FacultyID})</span></td>
      <td class="py-3 px-4">${studio.StudioName}</td>
      <td class="py-3 px-4 font-mono">${cleanTimeStr(b.StartTime)} - ${cleanTimeStr(b.EndTime)}</td>
      <td class="py-3 px-4"><strong>${b.CourseCode}</strong> (${b.UnitNo} • ${b.LectureNo})</td>
      <td class="py-3 px-4"><span class="px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-700">Not Recorded</span></td>
      <td class="py-3 px-4 text-rose-900 font-semibold">${b.Remarks || '<span class="text-slate-400 italic">No remark entered</span>'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function clearAuditDateFilter() {
  document.getElementById('auditFilterDate').value = '';
  renderAdminAuditTable();
}

async function changeBookingStatus(bookingId, status) {
  const b = db.bookings.find(item => item.BookingID === bookingId);
  if (b) b.Status = status;
  persistCache();
  refreshAdminUI();

  await postApi('updateBookingStatus', { bookingId, status });
  notify(`Booking status updated to ${status}!`, 'success');
}

function renderAdminStudios() {
  const grid = document.getElementById('studiosGrid');
  grid.innerHTML = '';
  db.studios.forEach(s => {
    const op = db.operators.find(o => String(o.OperatorID).trim() === String(s.OperatorID).trim() || String(o.AssignedStudioID).trim() === String(s.StudioID).trim());
    const div = document.createElement('div');
    div.className = 'bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between';
    div.innerHTML = `
      <div>
        <div class="flex justify-between items-start">
          <span class="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">${s.StudioID}</span>
          <span class="text-xs px-2 py-0.5 rounded font-bold ${s.Status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">${s.Status}</span>
        </div>
        <h3 class="text-base font-bold text-slate-800 mt-2">${s.StudioName}</h3>
        <p class="text-xs text-slate-400">${s.Location}</p>
        <div class="mt-4 p-2.5 bg-slate-50 rounded-xl text-xs">
          <span class="text-slate-400 font-bold uppercase">Incharge:</span>
          <div class="font-bold text-slate-700 mt-0.5">${op ? `${op.Name} (${op.Phone || op.Email})` : '<span class="text-amber-600">Unassigned</span>'}</div>
        </div>
      </div>
      <div class="flex space-x-2 pt-4 border-t mt-4">
        <button onclick="editStudio('${s.StudioID}')" class="btn-secondary w-full justify-center text-xs">Edit</button>
        <button onclick="deleteStudioRecord('${s.StudioID}')" class="btn-danger justify-center px-3 text-xs"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
    grid.appendChild(div);
  });
}

function renderAdminOperators() {
  const tbody = document.getElementById('operatorsTableBody');
  tbody.innerHTML = '';
  if (db.operators.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">No Incharges found.</td></tr>`;
    return;
  }
  db.operators.forEach(op => {
    const studio = db.studios.find(s => String(s.StudioID).trim() === String(op.AssignedStudioID).trim());
    const userAcc = db.users.find(u => String(u.RefID).trim() === String(op.OperatorID).trim());
    const username = op.Username || (userAcc ? userAcc.Username : 'N/A');

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50';
    tr.innerHTML = `
      <td class="py-3 px-4 font-mono font-bold">${op.OperatorID}</td>
      <td class="py-3 px-4 font-bold text-slate-800">${op.Name}</td>
      <td class="py-3 px-4">${studio ? studio.StudioName : '<span class="text-slate-400">Unassigned</span>'}</td>
      <td class="py-3 px-4 font-mono text-indigo-600 font-bold">${username}</td>
      <td class="py-3 px-4 text-slate-600">${op.Phone || ''} ${op.Email ? `• ${op.Email}` : ''}</td>
      <td class="py-3 px-4 text-right space-x-2">
        <button onclick="editOperator('${op.OperatorID}')" class="text-indigo-600 font-bold text-xs">Edit</button>
        <button onclick="deleteOperatorRecord('${op.OperatorID}')" class="text-rose-600 font-bold text-xs">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderAdminFaculty() {
  const tbody = document.getElementById('facultyTableBody');
  tbody.innerHTML = '';
  if (db.faculty.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">No Faculty registered.</td></tr>`;
    return;
  }
  db.faculty.forEach(f => {
    const userAcc = db.users.find(u => String(u.RefID).trim() === String(f.FacultyID).trim());
    const username = f.Username || (userAcc ? userAcc.Username : 'N/A');

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50';
    tr.innerHTML = `
      <td class="py-3 px-4 font-mono font-bold">${f.FacultyID}</td>
      <td class="py-3 px-4 font-bold text-slate-800">${f.Name}</td>
      <td class="py-3 px-4 text-slate-600">${f.Department}</td>
      <td class="py-3 px-4 font-mono text-indigo-600 font-bold">${username}</td>
      <td class="py-3 px-4 text-slate-600">${f.Email}</td>
      <td class="py-3 px-4 text-right space-x-2">
        <button onclick="editFaculty('${f.FacultyID}')" class="text-indigo-600 font-bold text-xs">Edit</button>
        <button onclick="deleteFacultyRecord('${f.FacultyID}')" class="text-rose-600 font-bold text-xs">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------------- FACULTY PORTAL ----------------

function refreshFacultyUI() {
  const currentFaculty = db.faculty.find(f => String(f.FacultyID).trim() === String(authSession.RefID).trim() || String(f.Username).trim() === String(authSession.Username).trim());
  const facultyName = currentFaculty ? currentFaculty.Name : authSession.Username;
  document.getElementById('facultyWelcomeName').innerText = `Welcome, ${facultyName}`;

  const studioSelect = document.getElementById('bookStudioId');
  studioSelect.innerHTML = '<option value="">-- Choose Studio --</option>';
  db.studios.filter(s => s.Status === 'Active').forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.StudioID;
    opt.innerText = `${s.StudioName} (${s.Location})`;
    studioSelect.appendChild(opt);
  });

  renderFacultyReservations();
  checkSlotAvailability();
}

function renderFacultyReservations() {
  const currentFaculty = db.faculty.find(f => String(f.FacultyID).trim() === String(authSession.RefID).trim() || String(f.Username).trim() === String(authSession.Username).trim());
  const facultyId = currentFaculty ? currentFaculty.FacultyID : authSession.RefID;
  const container = document.getElementById('facultyBookingsList');
  const dateFilter = document.getElementById('facultyFilterDate').value;

  container.innerHTML = '';
  let myBookings = db.bookings.filter(b => String(b.FacultyID).trim() === String(facultyId).trim());
  if (dateFilter) {
    myBookings = myBookings.filter(b => formatDateStr(b.Date) === dateFilter);
  }

  if (myBookings.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-400 bg-slate-50 rounded-xl">No reservations found for ${dateFilter ? `date: ${dateFilter}` : 'your account'}.</div>`;
    return;
  }

  myBookings.sort((a, b) => new Date(b.Date) - new Date(a.Date)).forEach(b => {
    const s = db.studios.find(std => String(std.StudioID).trim() === String(b.StudioID).trim()) || { StudioName: b.StudioID };
    const div = document.createElement('div');
    div.className = 'p-4 rounded-xl border border-slate-200 bg-white space-y-2';
    div.innerHTML = `
      <div class="flex justify-between items-center">
        <div>
          <span class="text-xs font-mono font-bold text-slate-400">${b.BookingID}</span>
          <h4 class="font-bold text-slate-800 text-sm">${b.CourseCode} - ${b.UnitNo} (${b.LectureNo})</h4>
        </div>
        ${getStatusBadge(b.Status, b)}
      </div>
      <div class="grid grid-cols-2 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg">
        <div><strong>Studio:</strong> ${s.StudioName}</div>
        <div><strong>Slot:</strong> ${formatDateStr(b.Date)} (${cleanTimeStr(b.StartTime)} - ${cleanTimeStr(b.EndTime)})</div>
        <div><strong>Recorded:</strong> ${b.DurationMinutes ? `${b.DurationMinutes} mins` : 'Pending'}</div>
        <div><strong>Topic:</strong> ${b.Topic || '-'}</div>
      </div>
      ${b.Remarks ? `<div class="text-xs text-rose-700 bg-rose-50 p-2 rounded-lg font-semibold">Remark: ${b.Remarks}</div>` : ''}
    `;
    container.appendChild(div);
  });
}

function clearFacultyDateFilter() {
  document.getElementById('facultyFilterDate').value = '';
  renderFacultyReservations();
}

function checkSlotAvailability() {
  const studioId = document.getElementById('bookStudioId').value;
  const date = document.getElementById('bookDate').value;
  const startStr = document.getElementById('bookStartTime').value;
  const endStr = document.getElementById('bookEndTime').value;
  const notice = document.getElementById('availabilityNotice');
  const timelineDiv = document.getElementById('dayTimelineSlots');

  if (studioId && date) {
    const existing = db.bookings.filter(b => String(b.StudioID).trim() === String(studioId).trim() && formatDateStr(b.Date) === formatDateStr(date) && b.Status !== 'Rejected');
    if (existing.length === 0) {
      timelineDiv.innerHTML = `<div class="text-slate-400 text-xs italic">Studio is completely free on this day.</div>`;
    } else {
      timelineDiv.innerHTML = existing.map(b => `
        <div class="flex justify-between items-center p-2 rounded bg-slate-100 text-xs font-mono">
          <span>${cleanTimeStr(b.StartTime)} - ${cleanTimeStr(b.EndTime)}: <strong>${b.FacultyName}</strong></span>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${b.Status === 'Approved' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'}">${b.Status}</span>
        </div>
      `).join('');
    }
  }

  if (!studioId || !date || !startStr || !endStr) {
    notice.classList.add('hidden');
    return true;
  }

  const reqStart = timeToMinutes(startStr);
  const reqEnd = timeToMinutes(endStr);

  if (reqEnd <= reqStart) {
    notice.className = 'text-xs p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold';
    notice.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1.5"></i> End time must be after start time.`;
    notice.classList.remove('hidden');
    return false;
  }

  const conflict = db.bookings.find(b => {
    if (String(b.StudioID).trim() !== String(studioId).trim() || formatDateStr(b.Date) !== formatDateStr(date) || b.Status === 'Rejected') return false;
    return Math.max(reqStart, timeToMinutes(b.StartTime)) < Math.min(reqEnd, timeToMinutes(b.EndTime));
  });

  if (conflict) {
    notice.className = 'text-xs p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-700 font-bold';
    notice.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1.5"></i> UNAVAILABLE: Occupied by <strong>${conflict.FacultyName}</strong> (${cleanTimeStr(conflict.StartTime)} - ${cleanTimeStr(conflict.EndTime)}).`;
    notice.classList.remove('hidden');
    return false;
  } else {
    notice.className = 'text-xs p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 font-bold';
    notice.innerHTML = `<i class="fa-solid fa-circle-check mr-1.5"></i> Studio slot is VACANT & available!`;
    notice.classList.remove('hidden');
    return true;
  }
}

async function handleSlotBooking(e) {
  e.preventDefault();
  if (!checkSlotAvailability()) return notify('Interval occupied. Pick another time.', 'error');

  const currentFaculty = db.faculty.find(f => String(f.FacultyID).trim() === String(authSession.RefID).trim() || String(f.Username).trim() === String(authSession.Username).trim());
  const payload = {
    BookingID: 'BKG-' + new Date().getTime().toString().slice(-6),
    FacultyID: currentFaculty ? currentFaculty.FacultyID : authSession.RefID,
    FacultyName: currentFaculty ? currentFaculty.Name : authSession.Username,
    StudioID: document.getElementById('bookStudioId').value,
    Date: document.getElementById('bookDate').value,
    StartTime: document.getElementById('bookStartTime').value,
    EndTime: document.getElementById('bookEndTime').value,
    CourseCode: document.getElementById('bookCourseCode').value.trim().toUpperCase(),
    UnitNo: document.getElementById('bookUnitNo').value.trim(),
    LectureNo: document.getElementById('bookLecNo').value.trim(),
    Topic: document.getElementById('bookTopic').value.trim(),
    Status: 'Pending',
    ActualStartTime: '',
    ActualEndTime: '',
    DurationMinutes: 0,
    Remarks: ''
  };

  db.bookings.push(payload);
  persistCache();
  refreshFacultyUI();

  document.getElementById('bookingForm').reset();
  await postApi('createBooking', payload);
  notify('Booking submitted! Awaiting Admin Approval.', 'success');
}

// ---------------- OPERATOR CONSOLE ----------------

function refreshOperatorUI() {
  const operator = db.operators.find(o => String(o.OperatorID).trim() === String(authSession.RefID).trim() || String(o.Username).trim() === String(authSession.Username).trim());
  const studio = db.studios.find(s => String(s.OperatorID).trim() === String(operator ? operator.OperatorID : '').trim() || String(s.StudioID).trim() === String(operator ? operator.AssignedStudioID : '').trim());

  document.getElementById('operatorWelcomeTitle').innerText = `Incharge: ${operator ? operator.Name : authSession.Username}`;
  document.getElementById('operatorAssignedStudioText').innerText = studio ? `Studio: ${studio.StudioName}` : 'All studio queues active.';
  renderOperatorConsole(studio ? studio.StudioID : null);
}

function renderOperatorConsole(enforcedStudioId = null) {
  const container = document.getElementById('operatorSlotsContainer');
  const search = document.getElementById('operatorSearchInput').value.toLowerCase().trim();
  const date = document.getElementById('operatorDateFilter').value;
  container.innerHTML = '';

  const slots = db.bookings.filter(b => {
    const matchStudio = enforcedStudioId ? String(b.StudioID).trim() === String(enforcedStudioId).trim() : true;
    const matchDate = !date || formatDateStr(b.Date) === formatDateStr(date);
    const matchSearch = !search || b.FacultyID.toLowerCase().includes(search) || b.FacultyName.toLowerCase().includes(search) || b.CourseCode.toLowerCase().includes(search);
    return matchStudio && matchDate && matchSearch;
  });

  if (slots.length === 0) {
    container.innerHTML = `<div class="col-span-2 text-center py-10 text-slate-400 bg-white rounded-2xl border border-slate-200">No scheduled approved slots found.</div>`;
    return;
  }

  slots.forEach(b => {
    let action = '';
    if (b.Status === 'Approved') {
      action = `
        <div class="flex gap-2">
          <button onclick="triggerStartRecording('${b.BookingID}')" class="w-2/3 btn-primary justify-center py-2.5 bg-emerald-600 hover:bg-emerald-700 font-bold portal-operator-btn">
            <i class="fa-solid fa-play mr-1.5"></i>START RECORDING
          </button>
          <button onclick="openRemarkModal('${b.BookingID}')" class="w-1/3 btn-danger justify-center py-2.5 font-bold text-xs">
            Not Arrived
          </button>
        </div>
      `;
    } else if (b.Status === 'In-Progress') {
      action = `
        <div class="space-y-2">
          <div class="text-xs font-bold text-amber-600 flex justify-between">
            <span><i class="fa-solid fa-circle text-rose-500 animate-ping mr-1"></i>REC IN PROGRESS</span>
            <span>Started: ${b.ActualStartTime}</span>
          </div>
          <button onclick="triggerFinishRecording('${b.BookingID}', '${b.ActualStartTime}')" class="w-full btn-danger justify-center py-2.5 font-bold">
            <i class="fa-solid fa-stop mr-2"></i>FINISH RECORDING
          </button>
        </div>
      `;
    } else if (b.Status === 'Completed') {
      action = `<div class="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 p-2.5 rounded-xl text-center">Recorded: ${b.DurationMinutes}m (${cleanTimeStr(b.ActualStartTime)} - ${cleanTimeStr(b.ActualEndTime)})</div>`;
    } else if (b.Status === 'Not-Recorded') {
      action = `<div class="text-xs text-rose-700 bg-rose-50 p-2 rounded-xl font-semibold">Not Recorded: ${b.Remarks}</div>`;
    } else {
      action = `<div class="text-xs text-slate-400 italic">Status: ${b.Status}</div>`;
    }

    const card = document.createElement('div');
    card.className = 'bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3';
    card.innerHTML = `
      <div class="flex justify-between items-start">
        <div>
          <span class="text-xs font-mono font-bold text-indigo-600">${b.BookingID}</span>
          <h4 class="font-bold text-slate-800 text-base mt-0.5">${b.FacultyName}</h4>
          <span class="text-xs text-slate-400 font-mono">ID: ${b.FacultyID}</span>
        </div>
        ${getStatusBadge(b.Status, b)}
      </div>
      <div class="text-xs grid grid-cols-2 gap-1.5 bg-slate-50 p-3 rounded-xl">
        <div><strong>Course:</strong> ${b.CourseCode}</div>
        <div><strong>Unit / Lec:</strong> ${b.UnitNo} • ${b.LectureNo}</div>
        <div><strong>Slot:</strong> ${cleanTimeStr(b.StartTime)} - ${cleanTimeStr(b.EndTime)}</div>
        <div><strong>Topic:</strong> ${b.Topic || '-'}</div>
      </div>
      <div>${action}</div>
    `;
    container.appendChild(card);
  });
}

function clearOperatorDateFilter() {
  document.getElementById('operatorDateFilter').value = '';
  renderOperatorConsole();
}

async function triggerStartRecording(bookingId) {
  const time = new Date().toTimeString().split(' ')[0].slice(0, 5);
  const b = db.bookings.find(item => item.BookingID === bookingId);
  if (b) {
    b.Status = 'In-Progress';
    b.ActualStartTime = time;
  }
  persistCache();
  renderOperatorConsole();
  await postApi('startRecording', { bookingId, startTime: time });
  notify(`Recording started at ${time}!`, 'success');
}

async function triggerFinishRecording(bookingId, startTimeStr) {
  const now = new Date();
  const finishTime = now.toTimeString().split(' ')[0].slice(0, 5);
  let duration = 30;
  try {
    const today = getTodayDateStr();
    const diff = new Date(`${today}T${finishTime}`) - new Date(`${today}T${startTimeStr}`);
    duration = Math.max(1, Math.round(diff / 60000));
  } catch (e) {}

  const b = db.bookings.find(item => item.BookingID === bookingId);
  if (b) {
    b.Status = 'Completed';
    b.ActualEndTime = finishTime;
    b.DurationMinutes = duration;
  }
  persistCache();
  renderOperatorConsole();
  await postApi('finishRecording', { bookingId, endTime: finishTime, durationMinutes: duration });
  notify(`Session completed! Duration: ${duration} minutes.`, 'success');
}

// ---------------- INTERACTIVE LIVE STATUS MODAL (FACULTY & ADMIN) ----------------

function openLiveStatusModal() {
  const studioSelect = document.getElementById('modalLiveStudioSelect');
  const dateInput = document.getElementById('modalLiveDateSelect');
  dateInput.value = getTodayDateStr();

  studioSelect.innerHTML = '';
  db.studios.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.StudioID;
    opt.innerText = `${s.StudioName} (${s.Location})`;
    studioSelect.appendChild(opt);
  });

  document.getElementById('liveStatusModal').classList.remove('hidden');
  renderModalLiveQueue();

  if (liveTelemetryTimer) clearInterval(liveTelemetryTimer);
  liveTelemetryTimer = setInterval(updateLiveRecordingTelemetry, 1000);
}

function closeLiveStatusModal() {
  document.getElementById('liveStatusModal').classList.add('hidden');
  if (liveTelemetryTimer) {
    clearInterval(liveTelemetryTimer);
    liveTelemetryTimer = null;
  }
}

function renderModalLiveQueue() {
  const studioId = document.getElementById('modalLiveStudioSelect').value;
  const dateVal = document.getElementById('modalLiveDateSelect').value;
  const banner = document.getElementById('modalLiveActiveBanner');
  const container = document.getElementById('modalLiveQueueContainer');
  const counter = document.getElementById('modalLiveQueueCounter');

  if (!studioId) return;

  const studioObj = db.studios.find(s => String(s.StudioID).trim() === String(studioId).trim()) || { StudioName: studioId };
  const dayBookings = db.bookings.filter(b => String(b.StudioID).trim() === String(studioId).trim() && formatDateStr(b.Date) === dateVal && b.Status !== 'Rejected');
  dayBookings.sort((a, b) => timeToMinutes(a.StartTime) - timeToMinutes(b.StartTime));

  counter.innerText = `${dayBookings.length} Slots`;

  // Find active In-Progress recording
  const activeSession = dayBookings.find(b => b.Status === 'In-Progress');
  if (activeSession) {
    banner.className = 'block p-5 bg-gradient-to-r from-rose-600 via-red-600 to-rose-700 text-white rounded-2xl shadow-xl live-radar-box border border-rose-400/50';
    banner.innerHTML = `
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div class="flex items-center space-x-2">
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-black bg-white text-rose-700 uppercase tracking-wider animate-pulse">
              <i class="fa-solid fa-circle text-rose-600 mr-1.5 text-[9px]"></i>ON AIR RECORDING NOW
            </span>
            <span class="text-xs font-mono opacity-80">${activeSession.BookingID}</span>
          </div>
          <h3 class="text-xl font-black mt-1">${activeSession.FacultyName}</h3>
          <p class="text-xs text-rose-100 font-semibold">${activeSession.CourseCode} • ${activeSession.UnitNo} (${activeSession.LectureNo}) - ${activeSession.Topic || 'Topic In Progress'}</p>
        </div>
        <div class="bg-black/30 backdrop-blur-md px-4 py-2.5 rounded-xl border border-white/10 text-right">
          <div class="text-[10px] font-mono uppercase tracking-widest text-rose-200">Recording Telemetry</div>
          <div id="liveTelemetryElapsed" data-starttime="${activeSession.ActualStartTime}" class="text-2xl font-black font-mono tracking-tight text-white mt-0.5">
            Calculating...
          </div>
          <div class="text-[10px] text-rose-200 mt-0.5">Started at: ${cleanTimeStr(activeSession.ActualStartTime)}</div>
        </div>
      </div>
    `;
  } else {
    banner.className = 'block p-4 bg-slate-100 border border-slate-200 rounded-2xl text-slate-600 text-xs font-medium flex items-center justify-between';
    banner.innerHTML = `
      <div class="flex items-center space-x-2">
        <span class="w-3 h-3 rounded-full bg-emerald-500"></span>
        <span>Studio <strong>${studioObj.StudioName}</strong> is currently <strong>IDLE / VACANT</strong>. No live recording active at this moment.</span>
      </div>
      <span class="px-2.5 py-1 rounded-lg bg-white border font-bold text-slate-700">${dateVal}</span>
    `;
  }

  container.innerHTML = '';
  if (dayBookings.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl text-xs">No scheduled lecture recordings for this studio on ${dateVal}.</div>`;
    return;
  }

  dayBookings.forEach(b => {
    let statusTheme = '';
    let statusIcon = '';
    let badgeText = b.Status;

    if (b.Status === 'In-Progress') {
      statusTheme = 'bg-rose-50 border-rose-300 text-rose-950 shadow';
      statusIcon = '<i class="fa-solid fa-tower-broadcast text-rose-600 animate-pulse text-base"></i>';
      badgeText = 'RECORDING NOW';
    } else if (b.Status === 'Completed') {
      statusTheme = 'bg-emerald-50 border-emerald-200 text-emerald-950';
      statusIcon = '<i class="fa-solid fa-circle-check text-emerald-600 text-base"></i>';
      badgeText = `COMPLETED (${b.DurationMinutes}m)`;
    } else if (b.Status === 'Approved') {
      statusTheme = 'bg-amber-50 border-amber-200 text-amber-950';
      statusIcon = '<i class="fa-solid fa-clock text-amber-500 text-base"></i>';
      badgeText = 'IN QUEUE';
    } else if (b.Status === 'Not-Recorded') {
      statusTheme = 'bg-rose-50 border-rose-200 text-rose-900';
      statusIcon = '<i class="fa-solid fa-circle-xmark text-rose-500 text-base"></i>';
      badgeText = 'NOT RECORDED';
    } else {
      statusTheme = 'bg-slate-50 border-slate-200 text-slate-700';
      statusIcon = '<i class="fa-solid fa-hourglass-start text-slate-400 text-base"></i>';
      badgeText = 'PENDING APPROVAL';
    }

    const card = document.createElement('div');
    card.className = `p-4 rounded-2xl border transition hover:shadow-md flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 ${statusTheme}`;
    card.innerHTML = `
      <div class="flex items-start space-x-3">
        <div class="mt-1">${statusIcon}</div>
        <div>
          <div class="flex items-center space-x-2">
            <span class="font-bold text-sm text-slate-800">${b.FacultyName}</span>
            <span class="text-xs font-mono text-slate-400 font-semibold">${b.FacultyID}</span>
          </div>
          <div class="text-xs font-bold text-indigo-800 mt-0.5">
            ${b.CourseCode} • ${b.UnitNo} (${b.LectureNo}) ${b.Topic ? ` - <span class="font-normal text-slate-600">${b.Topic}</span>` : ''}
          </div>
          ${b.Remarks ? `<div class="text-[11px] text-rose-700 font-semibold mt-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${b.Remarks}</div>` : ''}
        </div>
      </div>
      <div class="flex flex-col sm:items-end w-full sm:w-auto">
        <span class="px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-wider ${b.Status === 'In-Progress' ? 'bg-rose-600 text-white animate-pulse' : b.Status === 'Completed' ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-800 border border-amber-300'}">
          ${badgeText}
        </span>
        <div class="text-xs font-mono font-bold text-slate-600 mt-1">
          ${cleanTimeStr(b.StartTime)} - ${cleanTimeStr(b.EndTime)}
        </div>
        ${b.ActualStartTime ? `<div class="text-[10px] font-mono text-slate-400">Actual: ${cleanTimeStr(b.ActualStartTime)} - ${cleanTimeStr(b.ActualEndTime) || 'Active'}</div>` : ''}
      </div>
    `;
    container.appendChild(card);
  });
}

function updateLiveRecordingTelemetry() {
  const telemetryEl = document.getElementById('liveTelemetryElapsed');
  if (!telemetryEl) return;
  const startStr = telemetryEl.getAttribute('data-starttime');
  if (!startStr) return;

  const now = new Date();
  const parts = startStr.split(':');
  const startH = parseInt(parts[0], 10);
  const startM = parseInt(parts[1], 10);

  const startObj = new Date();
  startObj.setHours(startH, startM, 0, 0);

  let diffMs = now - startObj;
  if (diffMs < 0) diffMs = 0;

  const totalSec = Math.floor(diffMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;

  telemetryEl.innerText = `${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

// ---------------- REMARKS FOR MISSED RECORDINGS ----------------

function openRemarkModal(bookingId) {
  document.getElementById('remarkBookingId').value = bookingId;
  document.getElementById('remarkText').value = '';
  document.getElementById('remarkModal').classList.remove('hidden');
}

async function handleSaveRemark(e) {
  e.preventDefault();
  const bookingId = document.getElementById('remarkBookingId').value;
  const remark = document.getElementById('remarkText').value.trim();

  closeModal('remarkModal');
  const b = db.bookings.find(item => item.BookingID === bookingId);
  if (b) {
    b.Status = 'Not-Recorded';
    b.Remarks = remark;
  }
  persistCache();
  if (authSession.Role === 'operator') renderOperatorConsole();
  if (authSession.Role === 'admin') refreshAdminUI();

  await postApi('submitRemark', { bookingId, remark });
  notify('Remark logged.', 'success');
}

// ---------------- UNIVERSAL EXPORT MODAL ----------------

function triggerUniversalExport(context) {
  currentExportContext = context;
  const studioSelect = document.getElementById('exportStudioFilter');
  studioSelect.innerHTML = '<option value="ALL">All Studios</option>';
  db.studios.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.StudioID;
    opt.innerText = s.StudioName;
    studioSelect.appendChild(opt);
  });

  const studioContainer = document.getElementById('exportStudioContainer');
  studioContainer.style.display = context === 'admin' || context === 'audit' ? 'block' : 'none';

  document.getElementById('exportFilterType').value = 'today';
  handleExportPresetChange('today');
  document.getElementById('exportModal').classList.remove('hidden');
}

function handleExportPresetChange(val) {
  const container = document.getElementById('exportCustomRangeContainer');
  container.classList.toggle('hidden', val !== 'custom');
}

function executeExportDownload() {
  const preset = document.getElementById('exportFilterType').value;
  const selectedStudio = document.getElementById('exportStudioFilter').value;
  const today = new Date();
  let start = getTodayDateStr();
  let end = getTodayDateStr();

  if (preset === 'weekly') {
    const first = new Date(today.setDate(today.getDate() - today.getDay()));
    const last = new Date(today.setDate(today.getDate() - today.getDay() + 6));
    start = formatDateStr(first);
    end = formatDateStr(last);
  } else if (preset === 'monthly') {
    start = formatDateStr(new Date(today.getFullYear(), today.getMonth(), 1));
    end = formatDateStr(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  } else if (preset === 'custom') {
    start = document.getElementById('exportStartDate').value;
    end = document.getElementById('exportEndDate').value;
  }

  let records = db.bookings.filter(b => {
    const d = formatDateStr(b.Date);
    const dateMatch = preset === 'all' || ((!start || d >= start) && (!end || d <= end));
    const studioMatch = currentExportContext !== 'admin' || selectedStudio === 'ALL' || String(b.StudioID).trim() === String(selectedStudio).trim();
    return dateMatch && studioMatch;
  });

  if (currentExportContext === 'faculty') {
    const currentFaculty = db.faculty.find(f => String(f.FacultyID).trim() === String(authSession.RefID).trim() || String(f.Username).trim() === String(authSession.Username).trim());
    const facultyId = currentFaculty ? currentFaculty.FacultyID : authSession.RefID;
    records = records.filter(b => String(b.FacultyID).trim() === String(facultyId).trim());
  } else if (currentExportContext === 'audit') {
    records = records.filter(b => b.Status === 'Not-Recorded' || b.Remarks);
  }

  if (records.length === 0) return notify('No records found for the selected criteria.', 'error');

  const exportRows = records.map(b => ({
    'Booking ID': b.BookingID,
    'Date': formatDateStr(b.Date),
    'Studio ID': b.StudioID,
    'Faculty ID': b.FacultyID,
    'Faculty Name': b.FacultyName,
    'Course': b.CourseCode,
    'Unit / Lec': `${b.UnitNo} • ${b.LectureNo}`,
    'Slot Time': `${cleanTimeStr(b.StartTime)} - ${cleanTimeStr(b.EndTime)}`,
    'Status': b.Status,
    'Actual Start': b.ActualStartTime || 'N/A',
    'Actual End': b.ActualEndTime || 'N/A',
    'Duration (Mins)': b.DurationMinutes || 0,
    'Reason / Remarks': b.Remarks || 'N/A'
  }));

  const ws = XLSX.utils.json_to_sheet(exportRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule_Report');
  XLSX.writeFile(wb, `Studio_Export_${preset}_${getTodayDateStr()}.xlsx`);
  closeModal('exportModal');
  notify('Report downloaded successfully!', 'success');
}

// ---------------- CRUD UTILITIES (EDIT & DELETE) ----------------

function openStudioModal() {
  document.getElementById('modalStudioId').value = '';
  document.getElementById('modalStudioName').value = '';
  document.getElementById('modalStudioLocation').value = '';
  const opSelect = document.getElementById('modalStudioOperator');
  opSelect.innerHTML = '<option value="">-- Unassigned --</option>';
  db.operators.forEach(op => {
    const opt = document.createElement('option');
    opt.value = op.OperatorID;
    opt.innerText = `${op.Name} (${op.OperatorID})`;
    opSelect.appendChild(opt);
  });
  document.getElementById('studioModal').classList.remove('hidden');
}

function editStudio(id) {
  const s = db.studios.find(std => String(std.StudioID).trim() === String(id).trim());
  if (!s) return;
  openStudioModal();
  document.getElementById('modalStudioId').value = s.StudioID;
  document.getElementById('modalStudioName').value = s.StudioName;
  document.getElementById('modalStudioLocation').value = s.Location;
  document.getElementById('modalStudioOperator').value = s.OperatorID || '';
  document.getElementById('modalStudioStatus').value = s.Status;
}

async function handleSaveStudio(e) {
  e.preventDefault();
  const id = document.getElementById('modalStudioId').value;
  const payload = {
    StudioID: id || 'STD-' + Math.floor(100 + Math.random() * 900),
    StudioName: document.getElementById('modalStudioName').value.trim(),
    Location: document.getElementById('modalStudioLocation').value.trim(),
    OperatorID: document.getElementById('modalStudioOperator').value,
    Status: document.getElementById('modalStudioStatus').value
  };

  const idx = db.studios.findIndex(s => String(s.StudioID).trim() === String(payload.StudioID).trim());
  if (idx !== -1) db.studios[idx] = payload;
  else db.studios.push(payload);
  persistCache();
  refreshAdminUI();

  closeModal('studioModal');
  await postApi('saveStudio', payload);
  notify('Studio saved successfully!', 'success');
}

async function deleteStudioRecord(id) {
  if (!confirm(`Are you sure you want to delete Studio ${id}?`)) return;
  db.studios = db.studios.filter(s => String(s.StudioID).trim() !== String(id).trim());
  persistCache();
  refreshAdminUI();

  await postApi('deleteStudio', { id });
  notify('Studio deleted successfully.', 'success');
}

function openOperatorModal() {
  document.getElementById('modalOpId').value = '';
  document.getElementById('modalOpName').value = '';
  document.getElementById('modalOpEmail').value = '';
  document.getElementById('modalOpPhone').value = '';
  document.getElementById('modalOpUsername').value = '';
  document.getElementById('modalOpPassword').value = '';
  const studioSelect = document.getElementById('modalOpStudio');
  studioSelect.innerHTML = '<option value="">-- Unassigned --</option>';
  db.studios.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.StudioID;
    opt.innerText = s.StudioName;
    studioSelect.appendChild(opt);
  });
  document.getElementById('operatorModal').classList.remove('hidden');
}

function editOperator(id) {
  const op = db.operators.find(o => String(o.OperatorID).trim() === String(id).trim());
  if (!op) return;
  openOperatorModal();
  const userAcc = db.users.find(u => String(u.RefID).trim() === String(op.OperatorID).trim());
  document.getElementById('modalOpId').value = op.OperatorID;
  document.getElementById('modalOpName').value = op.Name;
  document.getElementById('modalOpEmail').value = op.Email;
  document.getElementById('modalOpPhone').value = op.Phone;
  document.getElementById('modalOpStudio').value = op.AssignedStudioID || '';
  document.getElementById('modalOpUsername').value = op.Username || (userAcc ? userAcc.Username : '');
  document.getElementById('modalOpPassword').value = userAcc ? userAcc.Password : '';
}

async function handleSaveOperator(e) {
  e.preventDefault();
  const id = document.getElementById('modalOpId').value;
  const payload = {
    OperatorID: id || 'OP-' + Math.floor(1000 + Math.random() * 9000),
    Name: document.getElementById('modalOpName').value.trim(),
    AssignedStudioID: document.getElementById('modalOpStudio').value,
    Email: document.getElementById('modalOpEmail').value.trim(),
    Phone: document.getElementById('modalOpPhone').value.trim(),
    Username: document.getElementById('modalOpUsername').value.trim(),
    Password: document.getElementById('modalOpPassword').value.trim(),
    Status: 'Active'
  };

  const idx = db.operators.findIndex(o => String(o.OperatorID).trim() === String(payload.OperatorID).trim());
  if (idx !== -1) db.operators[idx] = payload;
  else db.operators.push(payload);
  persistCache();
  refreshAdminUI();

  closeModal('operatorModal');
  await postApi('saveOperator', payload);
  notify('Studio Incharge saved successfully!', 'success');
}

async function deleteOperatorRecord(id) {
  if (!confirm(`Are you sure you want to delete Incharge ${id}? Portal login will be revoked.`)) return;
  db.operators = db.operators.filter(o => String(o.OperatorID).trim() !== String(id).trim());
  db.users = db.users.filter(u => String(u.RefID).trim() !== String(id).trim());
  persistCache();
  refreshAdminUI();

  await postApi('deleteOperator', { id });
  notify('Incharge deleted successfully.', 'success');
}

function openFacultyModal() {
  document.getElementById('modalFacId').value = '';
  document.getElementById('modalFacName').value = '';
  document.getElementById('modalFacDept').value = '';
  document.getElementById('modalFacEmail').value = '';
  document.getElementById('modalFacPhone').value = '';
  document.getElementById('modalFacUsername').value = '';
  document.getElementById('modalFacPassword').value = '';
  document.getElementById('facultyModal').classList.remove('hidden');
}

function editFaculty(id) {
  const fac = db.faculty.find(f => String(f.FacultyID).trim() === String(id).trim());
  if (!fac) return;
  openFacultyModal();
  const userAcc = db.users.find(u => String(u.RefID).trim() === String(fac.FacultyID).trim());
  document.getElementById('modalFacId').value = fac.FacultyID;
  document.getElementById('modalFacName').value = fac.Name;
  document.getElementById('modalFacDept').value = fac.Department;
  document.getElementById('modalFacEmail').value = fac.Email;
  document.getElementById('modalFacPhone').value = fac.Phone;
  document.getElementById('modalFacUsername').value = fac.Username || (userAcc ? userAcc.Username : '');
  document.getElementById('modalFacPassword').value = userAcc ? userAcc.Password : '';
}

async function handleSaveFaculty(e) {
  e.preventDefault();
  const id = document.getElementById('modalFacId').value;
  const payload = {
    FacultyID: id || 'FAC-' + Math.floor(1000 + Math.random() * 9000),
    Name: document.getElementById('modalFacName').value.trim(),
    Department: document.getElementById('modalFacDept').value.trim(),
    Email: document.getElementById('modalFacEmail').value.trim(),
    Phone: document.getElementById('modalFacPhone').value.trim(),
    Username: document.getElementById('modalFacUsername').value.trim(),
    Password: document.getElementById('modalFacPassword').value.trim(),
    Status: 'Active'
  };

  const idx = db.faculty.findIndex(f => String(f.FacultyID).trim() === String(payload.FacultyID).trim());
  if (idx !== -1) db.faculty[idx] = payload;
  else db.faculty.push(payload);
  persistCache();
  refreshAdminUI();

  closeModal('facultyModal');
  await postApi('saveFaculty', payload);
  notify('Faculty registered successfully!', 'success');
}

async function deleteFacultyRecord(id) {
  if (!confirm(`Are you sure you want to delete Faculty ${id}? Portal login will be revoked.`)) return;
  db.faculty = db.faculty.filter(f => String(f.FacultyID).trim() !== String(id).trim());
  db.users = db.users.filter(u => String(u.RefID).trim() !== String(id).trim());
  persistCache();
  refreshAdminUI();

  await postApi('deleteFaculty', { id });
  notify('Faculty member removed.', 'success');
}

function openEditSlotModal(bookingId) {
  const b = db.bookings.find(item => String(item.BookingID).trim() === String(bookingId).trim());
  if (!b) return;

  document.getElementById('editBookingId').value = b.BookingID;
  document.getElementById('editSlotDate').value = formatDateStr(b.Date);
  document.getElementById('editSlotStart').value = cleanTimeStr(b.StartTime);
  document.getElementById('editSlotEnd').value = cleanTimeStr(b.EndTime);
  document.getElementById('editSlotCourse').value = b.CourseCode;
  document.getElementById('editSlotStatus').value = b.Status;

  const stdSelect = document.getElementById('editSlotStudio');
  stdSelect.innerHTML = '';
  db.studios.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.StudioID;
    opt.innerText = s.StudioName;
    if (String(s.StudioID).trim() === String(b.StudioID).trim()) opt.selected = true;
    stdSelect.appendChild(opt);
  });
  document.getElementById('editSlotModal').classList.remove('hidden');
}

async function handleSaveEditedSlot(e) {
  e.preventDefault();
  const bookingId = document.getElementById('editBookingId').value;
  const payload = {
    BookingID: bookingId,
    Date: document.getElementById('editSlotDate').value,
    StudioID: document.getElementById('editSlotStudio').value,
    StartTime: document.getElementById('editSlotStart').value,
    EndTime: document.getElementById('editSlotEnd').value,
    CourseCode: document.getElementById('editSlotCourse').value.toUpperCase(),
    Status: document.getElementById('editSlotStatus').value
  };

  const idx = db.bookings.findIndex(b => String(b.BookingID).trim() === String(bookingId).trim());
  if (idx !== -1) {
    db.bookings[idx] = { ...db.bookings[idx], ...payload };
  }
  persistCache();
  refreshAdminUI();

  closeModal('editSlotModal');
  await postApi('editBooking', payload);
  notify('Slot updated successfully!', 'success');
}

async function deleteEditedSlot() {
  const id = document.getElementById('editBookingId').value;
  if (!confirm(`Are you sure you want to delete booking ${id}?`)) return;

  db.bookings = db.bookings.filter(b => String(b.BookingID).trim() !== String(id).trim());
  persistCache();
  refreshAdminUI();

  closeModal('editSlotModal');
  await postApi('deleteBooking', { id });
  notify('Booking deleted successfully.', 'success');
}

// ---------------- ATTIRE INSPECTOR (DIRECT WEBRTC ENGINE) ----------------

let camStream = null;
let camAnimFrame = null;

function openAttireModal() {
  document.getElementById('attireModal').classList.remove('hidden');
  document.getElementById('camStartScreen').classList.remove('hidden');
}

function closeAttireModal() {
  document.getElementById('attireModal').classList.add('hidden');
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  if (camAnimFrame) cancelAnimationFrame(camAnimFrame);
}

async function startNativeCamera() {
  try {
    const video = document.getElementById('nativeCamVideo');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    camStream = stream;
    video.srcObject = stream;
    await video.play();

    document.getElementById('camStartScreen').classList.add('hidden');
    requestAnimationFrame(renderNativeAttireFrame);
  } catch (err) {
    alert('Camera permission denied or camera not found.');
  }
}

function renderNativeAttireFrame() {
  const video = document.getElementById('nativeCamVideo');
  const canvas = document.getElementById('nativeDisplayCanvas');
  const ctx = canvas.getContext('2d');

  if (video.readyState >= 2) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const roiX = Math.floor(canvas.width * 0.3);
    const roiY = Math.floor(canvas.height * 0.35);
    const roiW = Math.floor(canvas.width * 0.4);
    const roiH = Math.floor(canvas.height * 0.5);

    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 2;
    ctx.strokeRect(roiX, roiY, roiW, roiH);

    const frameData = ctx.getImageData(roiX, roiY, roiW, roiH).data;
    let greenCount = 0;
    let total = roiW * roiH;

    for (let i = 0; i < frameData.length; i += 4) {
      const r = frameData[i];
      const g = frameData[i + 1];
      const b = frameData[i + 2];
      if (g > 100 && g > r * 1.3 && g > b * 1.3) greenCount++;
    }

    const greenRatio = (greenCount / total) * 100;
    const score = Math.max(10, Math.round(100 - greenRatio * 4));

    document.getElementById('nativeScore').innerText = `${score}%`;
    const clashEl = document.getElementById('nativeChromaStatus');
    if (greenRatio > 6) {
      clashEl.innerText = 'CHROMA CLASH!';
      clashEl.className = 'font-bold text-rose-500 animate-pulse';
    } else {
      clashEl.innerText = 'CLEAN';
      clashEl.className = 'font-bold text-emerald-400';
    }
  }
  camAnimFrame = requestAnimationFrame(renderNativeAttireFrame);
}

// ---------------- UI UTILITIES ----------------

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function getStatusBadge(s, booking) {
  switch (s) {
    case 'Approved': return '<span class="px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">Queued / Approved</span>';
    case 'In-Progress': return '<span class="px-2 py-0.5 rounded text-xs font-bold bg-rose-500 text-white animate-pulse">Recording...</span>';
    case 'Completed': return '<span class="px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">Completed</span>';
    case 'Not-Recorded': return '<span class="px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">Not Recorded</span>';
    case 'Rejected': return '<span class="px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-500">Rejected</span>';
    default: return '<span class="px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-700">Pending Approval</span>';
  }
}

function notify(msg, type = 'success') {
  const banner = document.getElementById('statusBanner');
  banner.innerText = msg;
  banner.className = `text-white text-xs font-bold py-2 px-4 text-center ${type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'}`;
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), 4000);
}