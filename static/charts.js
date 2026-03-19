document.addEventListener('DOMContentLoaded', () => {
    let dailyData = [];
    let detectionsData = [];
    let trendChartInstance = null;
    let distChartInstance = null;
    let selectedDateForNotes = null;
    let selectedDetectionId = null;
    let notesMode = 'daily'; // 'daily' or 'detection'
    let allMonthKeys = [];
    let currentMonthIndex = 0;
    let currentView = 'daily';

    const ENERGY_LABELS = ['Drained', 'Low', 'Okay', 'Good', 'Vibrant'];
    const ENERGY_EMOJIS = ['🪫', '🔋', '🔋', '🔋', '⚡'];

    const dayPicker = document.getElementById('week-picker');
    const sections = document.querySelectorAll('.tab-section');
    const navBtns = document.querySelectorAll('.nav-link');
    const modal = document.getElementById('notesModal');
    const closeModal = document.getElementById('closeModal');
    const saveNotesBtn = document.getElementById('saveNotesBtn');
    const moodNotes = document.getElementById('moodNotes');
    const modalDateTitle = document.getElementById('modalDateTitle');
    const saveStatus = document.getElementById('saveStatus');

    // ── ISO week helpers ──
    function dateToISOWeek(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        const jan4 = new Date(d.getFullYear(), 0, 4);
        const w1Start = new Date(jan4);
        w1Start.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
        const weekNum = Math.floor((d - w1Start) / (7 * 86400000)) + 1;
        return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    }

    function isoWeekToMonday(weekStr) {
        const [year, week] = weekStr.split('-W').map(Number);
        const jan4 = new Date(year, 0, 4);
        const w1Start = new Date(jan4);
        w1Start.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
        const monday = new Date(w1Start);
        monday.setDate(w1Start.getDate() + (week - 1) * 7);
        return monday.toISOString().split('T')[0];
    }

    // ── Styles ──
    const style = document.createElement('style');
    style.textContent = `
        .view-btn {
            background: transparent;
            border: 1px solid rgba(99,102,241,0.3);
            color: var(--text-secondary);
            padding: 0.35rem 0.9rem;
            border-radius: 20px;
            font-weight: 600;
            cursor: pointer;
            font-family: var(--font-family, 'Outfit', sans-serif);
            font-size: 0.85rem;
            transition: all 0.2s ease;
        }
        .view-btn:hover, .view-btn.active {
            background: rgba(99,102,241,0.15);
            border-color: rgba(99,102,241,0.5);
            color: var(--text-primary, #f8fafc);
        }
        .energy-avg-box {
            margin-top: 1.5rem;
            padding: 1.2rem 2rem;
            border-radius: 16px;
            display: flex;
            align-items: center;
            gap: 1rem;
            font-family: var(--font-family, 'Outfit', sans-serif);
            border: 1px solid var(--card-border, rgba(255,255,255,0.1));
            background: var(--card-bg, rgba(23,25,35,0.7));
            max-width: 360px;
            margin-left: auto;
            margin-right: auto;
        }
        #trendChart {
            background: rgba(255,255,255,0.9);
            border-radius: 12px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.07);
        }
        .energy-avg-swatch { width: 48px; height: 48px; border-radius: 12px; flex-shrink: 0; }
        .energy-avg-label { font-size: 0.85rem; color: var(--text-secondary, #94a3b8); }
        .energy-avg-value { font-size: 1.4rem; font-weight: 800; color: var(--text-primary, #f8fafc); }
    `;
    document.head.appendChild(style);

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Outfit';
    Chart.defaults.scale.grid.color = 'rgba(255, 255, 255, 0.05)';





    // ── Init ──
    async function init() {
        try {
            const [dailyRes, detectionsRes] = await Promise.all([
                fetch('/api/daily').then(r => r.json()),
                fetch('/api/detections').then(r => r.json())
            ]);
            dailyData = dailyRes || [];
            detectionsData = detectionsRes || [];

            if (dailyData.length > 0) {
                const latest = dailyData[dailyData.length - 1].date;
                if (dayPicker) { dayPicker.type = 'date'; dayPicker.value = latest; }

                const monthsData = {};
                dailyData.forEach(d => {
                    const mKey = d.date.substring(0, 7);
                    if (!monthsData[mKey]) {
                        const dt = new Date(d.date + 'T00:00:00');
                        monthsData[mKey] = { year: dt.getFullYear(), month: dt.getMonth(), days: {} };
                    }
                    monthsData[mKey].days[parseInt(d.date.split('-')[2])] = d;
                });
                allMonthKeys = Object.keys(monthsData).sort();
                currentMonthIndex = allMonthKeys.length - 1;

                injectViewToggle();
                refreshTrendChart();
                renderCalendar(monthsData);
            }
            if (detectionsData.length > 0) {
                distDate = dailyData.length > 0 ? dailyData[dailyData.length - 1].date : null;
                injectDistToggle();
                refreshDistChart();
            }
        } catch (e) { console.error("Init failed:", e); }
    }

    // ── View toggle ──
    function injectViewToggle() {
        const header = document.querySelector('#section-trend .card-header');
        if (!header || document.getElementById('viewToggle')) return;
        const badge = header.querySelector('.badge');
        if (badge) badge.remove();

        const toggle = document.createElement('div');
        toggle.id = 'viewToggle';
        toggle.style.cssText = 'display:flex; gap:0.4rem;';
        toggle.innerHTML = `
            <button class="view-btn active" data-view="daily">Daily</button>
            <button class="view-btn" data-view="weekly">Weekly</button>
            <button class="view-btn" data-view="monthly">Monthly</button>
        `;
        header.appendChild(toggle);

        toggle.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                toggle.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentView = btn.dataset.view;

                const label = document.querySelector('label[for="week-picker"]');
                const latest = dailyData.length > 0 ? dailyData[dailyData.length - 1].date : '';

                if (currentView === 'daily') {
                    if (label) label.textContent = 'Select Day';
                    if (dayPicker) { dayPicker.type = 'date'; if (latest) dayPicker.value = latest; }
                } else if (currentView === 'weekly') {
                    if (label) label.textContent = 'Select Week';
                    if (dayPicker) { dayPicker.type = 'week'; if (latest) dayPicker.value = dateToISOWeek(latest); }
                } else {
                    if (label) label.textContent = 'Select Month';
                    if (dayPicker) { dayPicker.type = 'month'; if (latest) dayPicker.value = latest.substring(0, 7); }
                }
                // Sync dist toggle
                document.querySelectorAll('.view-btn[data-view]').forEach(b => {
                    b.classList.toggle('active', b.dataset.view === currentView);
                });
                refreshTrendChart();
            });
        });
    }

    // ── Refresh dispatcher ──
    function refreshTrendChart() {
        const val = dayPicker ? dayPicker.value : null;
        if (!val) return;
        if (currentView === 'daily') renderDailyChart(val);
        else if (currentView === 'weekly') renderWeeklyChart(val);
        else renderMonthlyChart(val);
    }

    // ── Daily view ──
    function renderDailyChart(dateStr) {
        const dayDetections = detectionsData
            .filter(d => d.detected_at && d.detected_at.startsWith(dateStr))
            .sort((a, b) => a.detected_at.localeCompare(b.detected_at));

        renderLineChart(
            dayDetections.map(d => d.detected_at.split(' ')[1].substring(0, 5)),
            dayDetections.map(d => d.tag_id),
            dayDetections.map(d => d.color || '#6366f1'),
            'Time of Day',
            dayDetections
        );
        renderAvgBox(dateStr);
    }

    // ── Weekly view ──
    function renderWeeklyChart(val) {
        const mondayStr = val.includes('-W') ? isoWeekToMonday(val) : val;
        const sunday = new Date(mondayStr + 'T00:00:00');
        sunday.setDate(sunday.getDate() + 6);
        const sundayStr = sunday.toISOString().split('T')[0];

        const data = dailyData
            .filter(r => r.date >= mondayStr && r.date <= sundayStr)
            .sort((a, b) => a.date.localeCompare(b.date));

        const weekLabels = data.map(d => { const [,m,day] = d.date.split('-'); return `${m}-${day}`; });
        renderLineChart(weekLabels, data.map(d => d.avg_tag), data.map(d => d.color || '#6366f1'), 'Date', null, data);
        removeAvgBox();
    }

    // ── Monthly view ──
    function renderMonthlyChart(val) {
        const monthStr = val.length > 7 ? val.substring(0, 7) : val;
        const data = dailyData
            .filter(r => r.date.startsWith(monthStr))
            .sort((a, b) => a.date.localeCompare(b.date));

        const monthLabels = data.map(d => d.date.split('-')[2]);
        renderLineChart(monthLabels, data.map(d => d.avg_tag), data.map(d => d.color || '#6366f1'), 'Date', null, data);
        removeAvgBox();
    }

    // ── Shared dot plot ──
    function renderLineChart(labels, values, pointColors, xLabel, detections, dailyEntries) {
        const ctx = document.getElementById('trendChart')?.getContext('2d');
        if (!ctx) return;
        if (trendChartInstance) trendChartInstance.destroy();

        // Pad with empty slots so dots aren't flush to edges
        const paddedLabels = ['', ...labels, ''];
        const paddedValues = [null, ...values, null];
        const paddedColors = ['transparent', ...pointColors, 'transparent'];

        trendChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: paddedLabels,
                datasets: [{
                    label: 'Energy Level',
                    data: paddedValues,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    borderWidth: 0,
                    pointBackgroundColor: paddedColors,
                    pointBorderColor: 'rgba(0,0,0,0.25)',
                    pointBorderWidth: 2,
                    pointRadius: paddedValues.map(v => v === null ? 0 : 14),
                    pointHoverRadius: paddedValues.map(v => v === null ? 0 : 17),
                    fill: false,
                    tension: 0,
                    spanGaps: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (e, elements) => {
                    if (elements.length === 0) return;
                    const realIndex = elements[0].index - 1; // account for padding
                    if (detections) {
                        const det = detections[realIndex];
                        if (det) openDetectionNotesModal(det);
                    } else if (dailyEntries) {
                        const entry = dailyEntries[realIndex];
                        if (entry) openNotesModal(entry);
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        padding: 12,
                        cornerRadius: 12,
                        callbacks: {
                            title: items => items[0].label || '',
                            label: ctx => {
                                if (ctx.raw === null) return '';
                                const idx = Math.min(4, Math.max(0, Math.round(ctx.raw)));
                                const realIndex = ctx.dataIndex - 1;
                                const note = detections ? detections[realIndex]?.notes
                                           : dailyEntries ? dailyEntries[realIndex]?.notes : null;
                                return note ? ` ${ENERGY_LABELS[idx]} · 📝 ${note}` : ` ${ENERGY_LABELS[idx]} · click to add note`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        title: { display: true, text: xLabel, color: '#94a3b8', font: { size: 12, weight: '600' } }
                    },
                    y: {
                        min: -0.3,
                        max: 4.3,
                        grid: { color: 'rgba(200,200,220,0.15)' },
                        ticks: {
                            stepSize: 1,
                            callback: val => {
                                const l = ['Drained', 'Low', 'Okay', 'Good', 'Vibrant'];
                                return Number.isInteger(val) && val >= 0 && val <= 4 ? l[val] : '';
                            }
                        }
                    }
                }
            }
        });
    }

    // ── Avg box ──
    function renderAvgBox(dateStr) {
        removeAvgBox();
        const daily = dailyData.find(d => d.date === dateStr);
        const container = document.querySelector('#section-trend .card');
        if (!container) return;
        const box = document.createElement('div');
        box.id = 'energyAvgBox';
        box.className = 'energy-avg-box';
        if (daily) {
            const idx = Math.min(4, Math.max(0, Math.round(daily.avg_tag)));
            box.innerHTML = `
                <div class="energy-avg-swatch" style="background:${daily.color}"></div>
                <div>
                    <div class="energy-avg-label">Daily Average</div>
                    <div class="energy-avg-value">${ENERGY_LABELS[idx]}</div>
                </div>`;
        } else {
            box.innerHTML = `<div class="energy-avg-label">No data for ${dateStr}</div>`;
        }
        container.appendChild(box);
    }

    function removeAvgBox() {
        document.getElementById('energyAvgBox')?.remove();
    }

    // ── Distribution chart ──
    let distDate = null;

    function injectDistToggle() {
        const header = document.querySelector('#section-distribution .card-header');
        if (!header || document.getElementById('currentViewToggle')) return;
        const badge = header.querySelector('.badge-purple');
        if (badge) badge.remove();

        const toggle = document.createElement('div');
        toggle.id = 'currentViewToggle';
        toggle.style.cssText = 'display:flex; gap:0.4rem;';
        toggle.innerHTML = `
            <button class="view-btn active" data-view="daily">Daily</button>
            <button class="view-btn" data-view="weekly">Weekly</button>
            <button class="view-btn" data-view="monthly">Monthly</button>
        `;
        header.appendChild(toggle);

        toggle.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                currentView = btn.dataset.view;
                // Sync both toggles
                document.querySelectorAll('.view-btn[data-view]').forEach(b => {
                    b.classList.toggle('active', b.dataset.view === currentView);
                });
                // Update picker type
                const label = document.querySelector('label[for="week-picker"]');
                if (dayPicker) {
                    if (currentView === 'daily') {
                        dayPicker.type = 'date';
                        if (label) label.textContent = 'Select Day';
                    } else if (currentView === 'weekly') {
                        dayPicker.type = 'week';
                        if (label) label.textContent = 'Select Week';
                        if (dayPicker.value && !dayPicker.value.includes('-W'))
                            dayPicker.value = dateToISOWeek(dayPicker.value);
                    } else {
                        dayPicker.type = 'month';
                        if (label) label.textContent = 'Select Month';
                        if (dayPicker.value && dayPicker.value.length > 7)
                            dayPicker.value = dayPicker.value.substring(0, 7);
                    }
                }
                refreshDistChart();
            });
        });
    }

    function refreshDistChart() {
        const val = (dayPicker ? dayPicker.value : null) || distDate || (dailyData.length > 0 ? dailyData[dailyData.length - 1].date : null);
        if (!val) return;

        let sourceData = [];

        if (currentView === 'daily') {
            sourceData = detectionsData.filter(d => d.detected_at && d.detected_at.startsWith(val));
        } else if (currentView === 'weekly') {
            const mondayStr = val.includes('-W') ? isoWeekToMonday(val) : val;
            const sunday = new Date(mondayStr + 'T00:00:00');
            sunday.setDate(sunday.getDate() + 6);
            const sundayStr = sunday.toISOString().split('T')[0];
            sourceData = detectionsData.filter(d => {
                const det = d.detected_at ? d.detected_at.split(' ')[0] : '';
                return det >= mondayStr && det <= sundayStr;
            });
        } else {
            const monthStr = val.length > 7 ? val.substring(0, 7) : val;
            sourceData = detectionsData.filter(d => d.detected_at && d.detected_at.startsWith(monthStr));
        }

        renderDistributionChart(sourceData);
    }

    function renderDistributionChart(source) {
        const data = source !== undefined ? source : detectionsData;
        const ctx = document.getElementById('distributionChart')?.getContext('2d');
        if (!ctx || data.length === 0) return;
        if (distChartInstance) distChartInstance.destroy();
        const counts = {}, colors = {};
        data.forEach(d => {
            counts[d.tag_id] = (counts[d.tag_id] || 0) + 1;
            colors[d.tag_id] = d.color;
        });
        distChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(counts).map(k => {
                    const i = Math.min(4, Math.max(0, parseInt(k)));
                    return ENERGY_LABELS[i];
                }),
                datasets: [{ data: Object.values(counts), backgroundColor: Object.values(colors), borderWidth: 0, hoverOffset: 20 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '75%',
                plugins: { legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true } } }
            }
        });
    }

    // ── Calendar ──
    function renderCalendar(monthsData) {
        const container = document.getElementById('calendarContainer');
        if (!container || allMonthKeys.length === 0) return;
        container.innerHTML = '';
        const mKey = allMonthKeys[currentMonthIndex];
        const mData = monthsData[mKey];
        const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        const wrapper = document.createElement('div');
        wrapper.className = 'calendar-month-wrapper active';
        const firstDay = new Date(mData.year, mData.month, 1).getDay();
        const daysInMonth = new Date(mData.year, mData.month + 1, 0).getDate();
        let gridHtml = ['S','M','T','W','T','F','S'].map(d => `<div class="calendar-day-header">${d}</div>`).join('');
        for (let i = 0; i < firstDay; i++) gridHtml += '<div class="calendar-day empty"></div>';
        for (let day = 1; day <= daysInMonth; day++) {
            const d = mData.days[day];
            if (d) {
                const idx = Math.min(4, Math.max(0, Math.round(d.avg_tag || 0)));
                const noteHint = d.notes ? ` · 📝 ${d.notes}` : '';
                gridHtml += `<div class="calendar-day has-data" style="background:${d.color}" title="${ENERGY_LABELS[idx]}${noteHint}" onclick="window.openNotesFor('${d.date}')"><span class="day-number">${day}</span></div>`;
            } else {
                gridHtml += `<div class="calendar-day"><span class="day-number">${day}</span></div>`;
            }
        }
        wrapper.innerHTML = `
            <div class="calendar-nav-header">
                <button class="nav-btn" id="prevMonth" ${currentMonthIndex === 0 ? 'disabled' : ''}>&larr; Prev</button>
                <h3 class="calendar-month-title">${monthNames[mData.month]} ${mData.year}</h3>
                <button class="nav-btn" id="nextMonth" ${currentMonthIndex === allMonthKeys.length - 1 ? 'disabled' : ''}>Next &rarr;</button>
            </div>
            <div class="calendar-grid">${gridHtml}</div>`;
        container.appendChild(wrapper);
        document.getElementById('prevMonth').onclick = () => { if (currentMonthIndex > 0) { currentMonthIndex--; renderCalendar(monthsData); } };
        document.getElementById('nextMonth').onclick = () => { if (currentMonthIndex < allMonthKeys.length - 1) { currentMonthIndex++; renderCalendar(monthsData); } };
    }

    function openDetectionNotesModal(det) {
        notesMode = 'detection';
        selectedDetectionId = det.id;
        const time = det.detected_at.split(' ')[1].substring(0, 5);
        const idx = Math.min(4, Math.max(0, det.tag_id));
        modalDateTitle.innerText = `Note for ${det.detected_at.split(' ')[0]} at ${time} — ${ENERGY_LABELS[idx]}`;
        moodNotes.value = det.notes || '';
        saveStatus.innerText = '';
        modal.classList.add('show');
    }

    window.openNotesFor = (date) => {
        const d = dailyData.find(x => x.date === date);
        if (d) openNotesModal(d);
    };

    function openNotesModal(dp) {
        notesMode = 'daily';
        selectedDateForNotes = dp.date;
        modalDateTitle.innerText = `Notes for ${dp.date}`;
        moodNotes.value = dp.notes || '';
        saveStatus.innerText = '';
        modal.classList.add('show');
    }

    if (closeModal) closeModal.onclick = () => modal.classList.remove('show');
    if (saveNotesBtn) saveNotesBtn.onclick = async () => {
        saveStatus.innerText = 'Saving...';
        try {
            let url, updateLocal;
            if (notesMode === 'detection') {
                url = `/api/detections/${selectedDetectionId}/notes`;
                updateLocal = () => {
                    const det = detectionsData.find(d => d.id === selectedDetectionId);
                    if (det) det.notes = moodNotes.value;
                };
            } else {
                url = `/api/daily/${selectedDateForNotes}/notes`;
                updateLocal = () => {
                    const dp = dailyData.find(d => d.date === selectedDateForNotes);
                    if (dp) dp.notes = moodNotes.value;
                };
            }
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: moodNotes.value })
            });
            const result = await res.json();
            if (result.success) {
                saveStatus.innerText = 'Notes saved!';
                updateLocal();
                // Update calendar day title in-place if it exists
                if (notesMode === 'daily' && selectedDateForNotes) {
                    const calDay = document.querySelector(`.calendar-day[onclick="window.openNotesFor('${selectedDateForNotes}')"]`);
                    if (calDay) {
                        const existing = calDay.getAttribute('title') || '';
                        const base = existing.split(' · 📝')[0];
                        calDay.setAttribute('title', moodNotes.value ? `${base} · 📝 ${moodNotes.value}` : base);
                    }
                }
                setTimeout(() => modal.classList.remove('show'), 1500);
            }
        } catch (e) { saveStatus.innerText = 'Error saving notes.'; }
    };

    function showSection(id) {
        sections.forEach(s => { s.classList.toggle('active', s.id === id); s.style.display = s.id === id ? 'block' : 'none'; });
        navBtns.forEach(b => b.classList.toggle('active', b.dataset.target === id));
    }

    navBtns.forEach(b => b.onclick = () => showSection(b.dataset.target));
    if (dayPicker) dayPicker.onchange = () => {
        refreshTrendChart();
        distDate = dayPicker.value;
        refreshDistChart();
    };

    // Re-render chart on theme toggle so background updates
    document.getElementById('themeToggle')?.addEventListener('click', () => {
        setTimeout(() => refreshTrendChart(), 50);
    });

    init();
    showSection('section-trend');
});