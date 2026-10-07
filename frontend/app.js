// ================================================
// FIREBASE CONFIGURATION — ISI SESUAI MILIK ANDA
// ================================================
const FIREBASE_CONFIG = {
    apiKey:      "YOUR_API_KEY",
    databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
};

// ================================================
// STATE
// ================================================
const products = {};
let doneCount    = 0;
let pendingRfid  = null;
let pendingOperator = '';

const STATIONS = {
    1: { label: 'Perakitan',  color: 'orange', status: 'Dirakit',    next: 2 },
    2: { label: 'Pengecatan', color: 'yellow', status: 'Dicat',      next: 3 },
    3: { label: 'Packing',    color: 'blue',   status: 'Packing',    next: 4 },
    4: { label: 'Pengiriman', color: 'green',  status: 'Siap Kirim', next: null },
};

// ================================================
// DOM REFERENCES
// ================================================
const stationLists = {
    1:      document.getElementById('station-1-list'),
    2:      document.getElementById('station-2-list'),
    3:      document.getElementById('station-3-list'),
    4:      document.getElementById('station-4-list'),
    rework: document.getElementById('station-rework-list'),
};
const colCounts = {
    1:      document.getElementById('count-1'),
    2:      document.getElementById('count-2'),
    3:      document.getElementById('count-3'),
    4:      document.getElementById('count-4'),
    rework: document.getElementById('count-rework'),
};
const pipeCounts = {
    1:      document.getElementById('pipe-count-1'),
    2:      document.getElementById('pipe-count-2'),
    3:      document.getElementById('pipe-count-3'),
    4:      document.getElementById('pipe-count-4'),
    rework: document.getElementById('pipe-count-rework'),
};
const pipeSteps = {
    1:      document.getElementById('pipe-1'),
    2:      document.getElementById('pipe-2'),
    3:      document.getElementById('pipe-3'),
    4:      document.getElementById('pipe-4'),
    rework: document.getElementById('pipe-rework'),
};

const totalCountEl    = document.getElementById('total-count');
const inprogressEl    = document.getElementById('inprogress-count');
const reworkCountEl   = document.getElementById('rework-count');
const doneCountEl     = document.getElementById('done-count');
const logList         = document.getElementById('log-list');

// Modal Registrasi
const regModal         = document.getElementById('reg-modal');
const modalRfidText    = document.getElementById('modal-rfid-text');
const productNameInput = document.getElementById('product-name-input');
const btnSave          = document.getElementById('btn-save');
const btnCancel        = document.getElementById('btn-cancel');

// Modal Rework
const reworkModal       = document.getElementById('rework-modal');
const reworkRfidText    = document.getElementById('rework-rfid-text');
const reworkReasonInput = document.getElementById('rework-reason-input');
const reworkTargetSt    = document.getElementById('rework-target-station');
const btnReworkSave     = document.getElementById('btn-rework-save');
const btnReworkCancel   = document.getElementById('btn-rework-cancel');
let pendingReworkRfid   = null;

// ================================================
// CLOCK
// ================================================
setInterval(() => {
    document.getElementById('clock').textContent =
        new Date().toLocaleTimeString('id-ID', { hour12: false });
}, 1000);
document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('id-ID', { hour12: false });

// ================================================
// FIREBASE INIT & LISTENER
// ================================================
function initFirebase() {
    if (typeof firebase === 'undefined') {
        console.warn('[Firebase] SDK tidak ditemukan → Mode Demo aktif.');
        addLog('yellow', '[DEMO] Firebase tidak terdeteksi. Gunakan mode demo.');
        runDemo();
        return;
    }

    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        const db = firebase.database();

        // Ambil data lama yang sudah ada (untuk restore state saat refresh)
        // Gunakan limitToLast agar tidak load data lama tak terbatas
        db.ref('/scans').limitToLast(50).on('child_added', (snapshot) => {
            const data = snapshot.val();
            if (!data || !data.rfid || !data.station) return;
            handleScanFromFirebase(data.rfid, data.station, data.operator || '—', data.stationName || '');
        });

        addLog('green', '[SYSTEM] Terhubung ke Firebase. Menunggu scan RFID...');
    } catch (e) {
        console.error('[Firebase] Error:', e);
        addLog('red', '[ERROR] Gagal inisialisasi Firebase: ' + e.message);
    }
}

// ================================================
// HANDLER SCAN DARI FIREBASE (dipanggil saat listener aktif)
// ================================================
function handleScanFromFirebase(rfid, stationId, operator, stationName) {
    stationId = parseInt(stationId);

    // Produk belum terdaftar → tampilkan modal registrasi
    if (!products[rfid]) {
        if (stationId !== 1) {
            addLog('red', `[ERROR] Kartu ${rfid} belum terdaftar! Scan di Stasiun 1 dulu.`);
            return;
        }
        pendingRfid      = rfid;
        pendingOperator  = operator;
        modalRfidText.textContent = rfid;
        productNameInput.value    = '';
        regModal.classList.add('active');
        setTimeout(() => productNameInput.focus(), 300);
        return;
    }

    const product    = products[rfid];
    const oldStation = product.station;

    // Scan di stasiun yang sama → abaikan (duplikat)
    if (oldStation === stationId) {
        addLog(STATIONS[stationId]?.color || 'orange',
            `[DUPLIKAT] ${product.name} sudah di ${STATIONS[stationId]?.label}`);
        return;
    }

    // Pindahkan kartu ke stasiun baru
    removeCardFromDOM(rfid, oldStation);
    product.station    = stationId;
    product.lastUpdate = now();
    product.operator   = operator;
    renderCard(product);
    refreshCounts();
    addLog(
        STATIONS[stationId]?.color || 'orange',
        `${product.name} → ${STATIONS[stationId]?.label} · oleh ${operator}`
    );
}

// ================================================
// REGISTRASI PRODUK BARU
// ================================================
btnSave.addEventListener('click', () => {
    const name = productNameInput.value.trim();
    if (!name) { shake(productNameInput); return; }

    products[pendingRfid] = {
        id:          pendingRfid,
        name,
        station:     1,
        lastUpdate:  now(),
        operator:    pendingOperator,
        reworkCount: 0,
    };

    regModal.classList.remove('active');
    renderCard(products[pendingRfid]);
    refreshCounts();
    addLog('orange', `[BARU] Terdaftar: ${name} (${pendingRfid}) · oleh ${pendingOperator}`);
    pendingRfid     = null;
    pendingOperator = '';
});

btnCancel.addEventListener('click', () => {
    regModal.classList.remove('active');
    pendingRfid = null;
});
productNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnSave.click(); });

// ================================================
// RENDER CARD
// ================================================
function renderCard(product) {
    const { id, name, station, lastUpdate, reworkCount, reason, operator } = product;
    const isRework = station === 'rework';
    const stCfg    = isRework ? null : STATIONS[station];

    const empty = stationLists[station].querySelector('.empty-state');
    if (empty) empty.remove();

    const existing = document.getElementById(`card-${id}`);
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.className = `product-card ${isRework ? 'st-rework' : 'st-' + station}`;
    card.id = `card-${id}`;

    const statusClass = isRework ? 'st-rework' : 'st-' + station;
    const statusText  = isRework ? 'REWORK' : stCfg.status.toUpperCase();

    const reasonHTML = (isRework && reason)
        ? `<div class="card-reason">⚠ ${reason}</div>` : '';

    const rwBadge = (reworkCount > 0 && !isRework)
        ? `<span class="rw-badge">RW×${reworkCount}</span>` : '';

    const operatorHTML = operator
        ? `<div class="card-operator"><span class="op-icon">👷</span>${operator}</div>` : '';

    // Aksi buttons
    let actionsHTML = '';
    if (isRework) {
        actionsHTML = `
            <div class="card-actions">
                <button class="btn-action btn-restore" onclick="openReworkModal('${id}', true)">↩ Kembalikan ke Stasiun</button>
            </div>`;
    } else {
        const nextStation = stCfg.next;
        const nextLabel   = nextStation ? STATIONS[nextStation].label : null;
        const nextBtn     = nextLabel
            ? `<button class="btn-action btn-next" onclick="moveNext('${id}')">→ ${nextLabel}</button>`
            : `<button class="btn-action btn-unregister" onclick="finishProduct('${id}')">✓ Selesai & Lepas Tag</button>`;
        const reworkBtn = station !== 4
            ? `<button class="btn-action btn-rework" onclick="openReworkModal('${id}', false)">↩ Rework</button>`
            : '';
        actionsHTML = `<div class="card-actions">${nextBtn}${reworkBtn}</div>`;
    }

    card.innerHTML = `
        <div class="card-top">
            <span class="product-name">${name}${rwBadge}</span>
            <span class="card-status ${statusClass}">${statusText}</span>
        </div>
        <div class="card-rfid">${id}</div>
        ${operatorHTML}
        ${reasonHTML}
        <div class="card-meta">
            <span class="card-time">${lastUpdate}</span>
        </div>
        ${actionsHTML}
    `;

    stationLists[station].prepend(card);
}

// ================================================
// MOVE NEXT STATION
// ================================================
function moveNext(rfid) {
    const product = products[rfid];
    if (!product) return;
    const nextStation = STATIONS[product.station]?.next;
    if (!nextStation) return;

    removeCardFromDOM(rfid, product.station);
    product.station    = nextStation;
    product.lastUpdate = now();
    renderCard(product);
    refreshCounts();
    addLog(STATIONS[nextStation].color, `${product.name} → ${STATIONS[nextStation].label} [Manual]`);
}

// ================================================
// REWORK FLOW
// ================================================
function openReworkModal(rfid, isRestore) {
    const product = products[rfid];
    if (!product) return;
    pendingReworkRfid = rfid;

    if (isRestore) {
        reworkModal.querySelector('h2').textContent = 'Kembalikan ke Stasiun';
        reworkModal.querySelector('p').textContent  = `${product.name} selesai diperbaiki`;
        reworkRfidText.textContent = product.name;
        reworkReasonInput.placeholder = 'Catatan perbaikan (opsional)';
    } else {
        reworkModal.querySelector('h2').textContent = 'Kirim ke Rework';
        reworkModal.querySelector('p').textContent  = `${product.name} akan masuk antrian perbaikan`;
        reworkRfidText.textContent = product.id;
        reworkReasonInput.placeholder = 'Contoh: Cat tidak merata, ada baret di sisi kanan';
    }

    reworkReasonInput.value = '';
    reworkModal.classList.add('active');
    reworkModal.__isRestore = isRestore;
    setTimeout(() => reworkReasonInput.focus(), 300);
}

btnReworkSave.addEventListener('click', () => {
    const product   = products[pendingReworkRfid];
    const reason    = reworkReasonInput.value.trim();
    const isRestore = reworkModal.__isRestore;

    if (isRestore) {
        const targetStation = parseInt(reworkTargetSt.value);
        removeCardFromDOM(pendingReworkRfid, 'rework');
        product.station    = targetStation;
        product.lastUpdate = now();
        product.reason     = null;
        renderCard(product);
        refreshCounts();
        reworkModal.classList.remove('active');
        addLog(STATIONS[targetStation].color,
            `[KEMBALI] ${product.name} → ${STATIONS[targetStation].label}`);
    } else {
        if (!reason) { shake(reworkReasonInput); return; }
        const oldStation = product.station;
        removeCardFromDOM(pendingReworkRfid, oldStation);
        product.station     = 'rework';
        product.lastUpdate  = now();
        product.reason      = reason;
        product.reworkCount = (product.reworkCount || 0) + 1;
        renderCard(product);
        refreshCounts();
        reworkModal.classList.remove('active');
        addLog('red', `[REWORK] ${product.name} — ${reason}`);
    }
    pendingReworkRfid = null;
});

btnReworkCancel.addEventListener('click', () => {
    reworkModal.classList.remove('active');
    pendingReworkRfid = null;
});
reworkReasonInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnReworkSave.click(); });

// ================================================
// FINISH / UNREGISTER
// ================================================
function finishProduct(rfid) {
    const product = products[rfid];
    if (!product) return;
    if (!confirm(`Konfirmasi: "${product.name}" sudah dikirim?\nTag ${rfid} akan dilepas.`)) return;

    removeCardFromDOM(rfid, product.station);
    delete products[rfid];
    doneCount++;
    refreshCounts();
    addLog('green', `[SELESAI] ${product.name} keluar produksi — Tag dilepas`);
}

// ================================================
// HELPERS
// ================================================
function removeCardFromDOM(rfid, stationKey) {
    const card = document.getElementById(`card-${rfid}`);
    if (!card) return;
    card.style.transition = 'opacity .18s, transform .18s';
    card.style.opacity    = '0';
    card.style.transform  = 'scale(.94)';
    setTimeout(() => {
        card.remove();
        showEmptyIfNeeded(stationKey);
    }, 180);
}

function showEmptyIfNeeded(stationKey) {
    if (!stationLists[stationKey].querySelector('.product-card')) {
        const msgs = {
            1: 'Menunggu produk masuk...',
            2: 'Menunggu produk masuk...',
            3: 'Menunggu produk masuk...',
            4: 'Belum ada produk siap kirim...',
            rework: 'Tidak ada produk bermasalah',
        };
        const div = document.createElement('div');
        div.className = 'empty-state';
        div.innerHTML = `<p>${msgs[stationKey] || '—'}</p>`;
        stationLists[stationKey].appendChild(div);
    }
}

function refreshCounts() {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, rework: 0 };
    Object.values(products).forEach(p => counts[p.station]++);

    for (const key of [1, 2, 3, 4, 'rework']) {
        colCounts[key].textContent  = counts[key];
        pipeCounts[key].textContent = counts[key] + ' unit';
        pipeSteps[key].classList.toggle('has-items', counts[key] > 0);
    }

    const inProgress = counts[1] + counts[2] + counts[3] + counts[4];
    totalCountEl.textContent  = inProgress + counts['rework'] + doneCount;
    inprogressEl.textContent  = inProgress;
    reworkCountEl.textContent = counts['rework'];
    doneCountEl.textContent   = doneCount;
}

function addLog(color, message) {
    while (logList.children.length >= 12) logList.removeChild(logList.lastChild);
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `
        <div class="log-dot ${color}"></div>
        <span class="log-time">${now()}</span>
        <span>${message}</span>
    `;
    logList.prepend(entry);
    if (logList.children.length > 1) {
        const sep = document.createElement('span');
        sep.className = 'log-sep';
        sep.textContent = '·';
        logList.insertBefore(sep, logList.children[1]);
    }
}

function now() {
    return new Date().toLocaleTimeString('id-ID', { hour12: false });
}

function shake(el) {
    el.style.borderColor = 'var(--red)';
    el.focus();
    setTimeout(() => { el.style.borderColor = ''; }, 1500);
}

// ================================================
// DEMO MODE (jika Firebase belum diisi)
// ================================================
function runDemo() {
    addLog('yellow', '[DEMO] Simulasi dimulai...');
    // Simulasi: kartu produk pertama masuk stasiun 1
    setTimeout(() => {
        pendingRfid     = '11 22 33 44';
        pendingOperator = 'Budi Santoso';
        modalRfidText.textContent = '11 22 33 44';
        productNameInput.value    = '';
        regModal.classList.add('active');
        setTimeout(() => productNameInput.focus(), 300);
        addLog('orange', '[DEMO] Kartu produk terdeteksi di Stasiun 1');
    }, 1500);
}

// ================================================
// START
// ================================================
initFirebase();
