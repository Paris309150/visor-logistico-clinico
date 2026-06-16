/**
 * VISOR ANALÍTICO - INTELIGENCIA OPERATIVA (SAR 360)
 * Arquitectura: Web Components + Firebase v10 Reactive
 */

import { db, auth } from './script.js';
import { 
    collection, onSnapshot, query, orderBy, limit, doc, getDoc, addDoc, serverTimestamp, setDoc, deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

/* ----------------------------------------------------
   1. CONFIGURACIÓN Y UTILIDADES GLOBALES
   ---------------------------------------------------- */

const PROD_PATH = 'Estadisticas_Operativas';
window.GLOBAL_DATA = {};

// --- SISTEMA DE NOTIFICACIONES TOAST ---
window.showToast = (message, type = 'success') => {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'info') icon = 'ℹ️';
    if (type === 'modified') icon = '📝';
    if (type === 'warning') icon = '⚠️';
    toast.innerHTML = `<span class="toast-icon">${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => { 
        toast.classList.remove('visible'); 
        setTimeout(() => toast.remove(), 400); 
    }, 4000);
};

// --- LÓGICA TITÁNICA: FERIADOS Y TURNOS ---
window.getHolidays = (year) => {
    const fixed = [
        `${year}-01-01`, `${year}-05-01`, `${year}-05-21`, `${year}-06-20`, `${year}-06-29`,
        `${year}-07-16`, `${year}-08-15`, `${year}-09-18`, `${year}-09-19`, `${year}-10-12`,
        `${year}-10-31`, `${year}-11-01`, `${year}-12-08`, `${year}-12-25`
    ];
    // Cálculo simplificado de Semana Santa (Algoritmo de Gauss)
    const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
    const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4); const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    const easterDate = new Date(year, month, day);
    const goodFriday = new Date(easterDate); goodFriday.setDate(easterDate.getDate() - 2);
    const holySaturday = new Date(easterDate); holySaturday.setDate(easterDate.getDate() - 1);
    const formatDate = (date) => date.toISOString().split('T')[0];
    return [...fixed, formatDate(goodFriday), formatDate(holySaturday)];
};

window.getShiftsForDate = (date) => {
    const d = new Date(date + 'T00:00:00'); 
    const day = d.getUTCDay(); 
    const dateString = d.toISOString().split('T')[0]; 
    const year = d.getUTCFullYear(); 
    const holidays = window.getHolidays(year);
    if (day === 6 || day === 0 || holidays.includes(dateString)) { 
        return [{ value: 'Turno Dia', text: 'Turno Día (08:00 - 20:00)' }, { value: 'Turno Noche', text: 'Turno Noche (20:00 - 08:00)' }]; 
    }
    return [{ value: 'Jornada SAR', text: 'Jornada SAR (17:00 - 08:00)' }];
};

window.getDateRangeOfWeek = (w, y) => {
    const d = new Date(y, 0, 4);
    const day = d.getDay() || 7; 
    const weekStart = new Date(y, 0, 4);
    weekStart.setDate(weekStart.getDate() - (day - 1) + (w - 1) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const fmt = date => `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`;
    return `${fmt(weekStart)} al ${fmt(weekEnd)}`;
};

/* ----------------------------------------------------
   2. PERSISTENCIA FIREBASE
   ---------------------------------------------------- */

window.dbSave = async (key, data) => {
    try {
        await setDoc(doc(db, PROD_PATH, key), { ...data, timestamp: serverTimestamp() }, { merge: true });
        window.showToast("Datos sincronizados con éxito");
    } catch (err) { window.showToast("Error al guardar", "error"); console.error(err); }
};

window.dbDelete = async (key) => {
    try {
        if (!confirm("¿Seguro que desea eliminar este registro?")) return;
        await deleteDoc(doc(db, PROD_PATH, key));
        window.showToast("Registro eliminado", "info");
    } catch (err) { console.error(err); }
};

/* ----------------------------------------------------
   3. COMPONENTES WEB (DISEÑO ZIPER 360)
   ---------------------------------------------------- */

// --- 3.1 Monthly Summary ---
class MonthlySummary extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); this.selectedYear = new Date().getFullYear(); this.metric = 'totalPacientes'; }
    connectedCallback() { this.render(); this.setupListeners(); window.addEventListener('data-updated', () => { this.updateYearSelector(); this.calculateStats(); }); }
    setupListeners() {
        this.shadowRoot.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', (e) => {
            this.metric = e.target.dataset.metric;
            this.shadowRoot.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            this.calculateStats();
        }));
        this.shadowRoot.getElementById('year-select').addEventListener('change', (e) => {
            this.selectedYear = parseInt(e.target.value);
            this.calculateStats();
        });
    }
    updateYearSelector() {
        const years = new Set([new Date().getFullYear()]);
        Object.keys(window.GLOBAL_DATA).forEach(k => { const y = parseInt(k.split(/[-_]/)[0]); if(!isNaN(y)) years.add(y); });
        const sel = this.shadowRoot.getElementById('year-select');
        sel.innerHTML = Array.from(years).sort((a,b)=>b-a).map(y => `<option value="${y}" ${y===this.selectedYear?'selected':''}>${y}</option>`).join('');
    }
    calculateStats() {
        const data = window.GLOBAL_DATA;
        const year = this.selectedYear;
        const prevYear = year - 1;
        let monthlyStats = Array(12).fill(0).map(() => ({ current: 0, prev: 0, cPac: 0, pPac: 0 }));

        Object.keys(data).forEach(key => {
            const entry = data[key];
            let eYear, eMonth;
            if (key.includes('monthlyTotal')) {
                const parts = key.split('_')[1].split('-');
                eYear = parseInt(parts[0]); eMonth = parseInt(parts[1]) - 1;
            } else {
                const d = new Date(key.split('_')[0] + 'T00:00:00');
                eYear = d.getFullYear(); eMonth = d.getMonth();
            }

            if (eYear === year || eYear === prevYear) {
                const target = eYear === year ? 'current' : 'prev';
                const pacTarget = eYear === year ? 'cPac' : 'pPac';
                monthlyStats[eMonth][target] += parseInt(entry[this.metric]) || 0;
                monthlyStats[eMonth][pacTarget] += parseInt(entry.totalPacientes) || 0;
            }
        });

        const grid = this.shadowRoot.getElementById('summary-grid');
        grid.innerHTML = '';
        const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
        
        monthlyStats.forEach((s, i) => {
            grid.appendChild(this.createCard(months[i], s, prevYear));
        });
        
        const global = monthlyStats.reduce((acc, s) => ({
            current: acc.current + s.current, prev: acc.prev + s.prev,
            cPac: acc.cPac + s.cPac, pPac: acc.pPac + s.pPac
        }), { current: 0, prev: 0, cPac: 0, pPac: 0 });
        grid.appendChild(this.createCard("ANUAL", global, prevYear, true));
    }
    createCard(title, stats, prevYear, isGlobal = false) {
        let val = stats.current;
        let pVal = stats.prev;
        let displayVal = val;
        let displayPrev = pVal;

        if (this.metric === 'altasAdministrativas') {
            const pct = stats.cPac > 0 ? (val / stats.cPac * 100).toFixed(1) : 0;
            const pPct = stats.pPac > 0 ? (pVal / stats.pPac * 100).toFixed(1) : 0;
            displayVal = pct + '%';
            displayPrev = pPct + '%';
        }

        const pctChange = pVal > 0 ? ((val - pVal) / pVal * 100) : (val > 0 ? 100 : 0);
        const color = pctChange >= 0 ? 'var(--ziper-success)' : 'var(--ziper-danger)';
        const icon = pctChange >= 0 ? '↑' : '↓';

        const card = document.createElement('div');
        card.className = `card ${isGlobal?'global':''}`;
        card.innerHTML = `
            <style>
                .card { background: #fff; padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0; text-align: center; }
                .global { border: 2px solid var(--ziper-primary); background: #f0f9ff; }
                h3 { font-size: 11px; color: #64748b; margin: 0 0 8px; text-transform: uppercase; }
                .val { font-size: 20px; font-weight: 800; color: #0f172a; }
                .trend { font-size: 10px; font-weight: 700; margin-top: 4px; color: ${color}; }
                .prev { font-size: 10px; color: #94a3b8; margin-top: 4px; }
            </style>
            <h3>${title}</h3>
            <div class="val">${displayVal}</div>
            ${!isGlobal ? `<div class="trend">${icon} ${Math.abs(pctChange).toFixed(1)}%</div>` : ''}
            <div class="prev">${displayPrev} <small>(${prevYear})</small></div>
        `;
        return card;
    }
    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; }
                .top-bar { display: flex; justify-content: space-between; margin-bottom: 16px; align-items: center; }
                .tab-btn { padding: 6px 16px; border-radius: 20px; border: 1px solid #e2e8f0; background: #fff; cursor: pointer; font-size: 12px; font-weight: 600; }
                .tab-btn.active { background: #005A9C; color: #fff; border-color: #005A9C; }
                .summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 12px; }
                #year-select { padding: 6px 12px; border-radius: 8px; border: 1px solid #e2e8f0; font-weight: 700; color: #005A9C; }
            </style>
            <div class="top-bar">
                <select id="year-select"></select>
                <div class="tabs">
                    <button class="tab-btn active" data-metric="totalPacientes">Pacientes</button>
                    <button class="tab-btn" data-metric="altasAdministrativas">Altas %</button>
                    <button class="tab-btn" data-metric="constatacionLesiones">Lesiones</button>
                    <button class="tab-btn" data-metric="traslados">Traslados</button>
                </div>
            </div>
            <div id="summary-grid" class="summary-grid"></div>
        `;
    }
}

// --- 3.2 Extreme Events Analysis ---
class ExtremeEventsAnalysis extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); }
    connectedCallback() { window.addEventListener('data-updated', () => this.update()); }
    update() {
        const data = Object.values(window.GLOBAL_DATA).filter(d => !d._isPartial).slice(0, 50);
        const criticals = data.filter(d => (d.constatacionLesiones > 10) || (d.traslados > 5) || (d.totalPacientes > 120));
        this.render(criticals);
    }
    render(items) {
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; background: #fff; padding: 24px; border-radius: 16px; border: 1px solid #fee2e2; }
                h2 { font-size: 16px; font-weight: 800; color: #991b1b; margin: 0 0 16px; display: flex; align-items: center; gap: 8px; }
                .item { padding: 12px; border-bottom: 1px solid #fef2f2; display: flex; justify-content: space-between; align-items: center; }
                .item:last-child { border-bottom: none; }
                .tag { font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; }
                .tag-red { background: #fee2e2; color: #991b1b; }
                .date { font-size: 12px; font-weight: 600; color: #64748b; }
                .desc { font-size: 13px; color: #0f172a; }
            </style>
            <h2>⚠️ Análisis de Alertas y Eventos Críticos</h2>
            ${items.length ? items.map(d => `
                <div class="item">
                    <div>
                        <div class="date">${d.date} - ${d.shift}</div>
                        <div class="desc">Equipo ${d.team}: ${d.totalPacientes} pac. (${d.constatacionLesiones} lesiones)</div>
                    </div>
                    <span class="tag tag-red">${d.constatacionLesiones > 10 ? 'ALTA VIOLENCIA' : 'ALTA CARGA'}</span>
                </div>
            `).join('') : '<div style="color:#94a3b8; font-size:13px; text-align:center; padding:20px;">No se detectan anomalías en los últimos turnos.</div>'}
        `;
    }
}

// --- 3.3 Team Comparison ---
class TeamComparison extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); }
    connectedCallback() { window.addEventListener('data-updated', () => this.update()); }
    update() {
        const data = Object.values(window.GLOBAL_DATA).filter(d => !d._isPartial);
        const stats = { '1': { p: 0, l: 0, t: 0, c: 0 }, '2': { p: 0, l: 0, t: 0, c: 0 }, '3': { p: 0, l: 0, t: 0, c: 0 } };
        data.forEach(d => {
            if (stats[d.team]) {
                stats[d.team].p += parseInt(d.totalPacientes) || 0;
                stats[d.team].l += parseInt(d.constatacionLesiones) || 0;
                stats[d.team].t += parseInt(d.traslados) || 0;
                stats[d.team].c++;
            }
        });
        this.render(stats);
    }
    render(stats) {
        const max = Math.max(...Object.values(stats).map(s => s.p), 1);
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; background: #fff; padding: 24px; border-radius: 16px; border: 1px solid #e2e8f0; }
                h2 { font-size: 16px; color: #005A9C; margin: 0 0 20px; font-weight: 800; }
                .chart { display: flex; align-items: flex-end; gap: 32px; height: 140px; padding-bottom: 20px; border-bottom: 1px solid #f1f5f9; }
                .bar-w { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; }
                .bar { width: 100%; background: #f1f5f9; border-radius: 6px; position: relative; height: 100px; overflow: hidden; }
                .fill { position: absolute; bottom: 0; left: 0; width: 100%; background: linear-gradient(0deg, #005A9C, #00c6ff); transition: height 0.6s cubic-bezier(0.4, 0, 0.2, 1); }
                .lbl { font-size: 11px; font-weight: 700; color: #64748b; }
                .val { font-size: 14px; font-weight: 800; color: #005A9C; }
                .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 20px; }
                .stat-box { text-align: center; font-size: 10px; color: #94a3b8; font-weight: 700; }
                .stat-val { display: block; font-size: 13px; color: #0f172a; margin-top: 2px; }
            </style>
            <h2>🏆 Comparativa de Rendimiento por Equipos</h2>
            <div class="chart">
                ${Object.entries(stats).map(([t, s]) => `
                    <div class="bar-w">
                        <div class="val">${s.p}</div>
                        <div class="bar"><div class="fill" style="height: ${(s.p / max * 100)}%"></div></div>
                        <div class="lbl">EQUIPO ${t}</div>
                    </div>
                `).join('')}
            </div>
            <div class="stats-grid">
                ${Object.entries(stats).map(([t, s]) => `
                    <div class="stat-box">Prom. Lesiones EQ${t}<span class="stat-val">${s.c > 0 ? (s.l / s.c).toFixed(1) : 0}</span></div>
                `).join('')}
            </div>
        `;
    }
}

// --- 3.4 Data Entry Form ---
class DataEntryForm extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); this.selectedTeam = '1'; }
    connectedCallback() { this.render(); this.setup(); }
    setup() {
        const f = this.shadowRoot.getElementById('f');
        const dateInp = this.shadowRoot.getElementById('date');
        const shiftSel = this.shadowRoot.getElementById('shift');
        
        dateInp.addEventListener('change', () => {
            const shifts = window.getShiftsForDate(dateInp.value);
            shiftSel.innerHTML = shifts.map(s => `<option value="${s.value}">${s.text}</option>`).join('');
            shiftSel.disabled = false;
        });

        this.shadowRoot.querySelectorAll('.team-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.shadowRoot.querySelectorAll('.team-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedTeam = btn.dataset.team;
            });
        });

        f.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(f);
            const data = Object.fromEntries(fd);
            data.team = this.selectedTeam;
            data._isPartial = false;
            ['totalPacientes', 'altasAdministrativas', 'constatacionLesiones', 'traslados', 'derivaciones'].forEach(k => data[k] = parseInt(data[k]) || 0);
            const key = `${data.date}_${data.shift}`;
            await window.dbSave(key, data);
            f.reset();
            shiftSel.disabled = true;
            this.shadowRoot.querySelectorAll('.team-btn').forEach(b => b.classList.remove('active'));
            this.shadowRoot.querySelector('.team-btn[data-team="1"]').classList.add('active');
            this.selectedTeam = '1';
        });
    }
    render() {
        this.shadowRoot.innerHTML = `
            <style>
                form { display: flex; flex-direction: column; gap: 16px; }
                h2 { font-size: 18px; color: #005A9C; margin: 0 0 4px; font-weight: 800; }
                p { font-size: 12px; color: #64748b; margin: 0 0 12px; }
                .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                input, select { padding: 12px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; outline: none; transition: border-color 0.2s; }
                input:focus { border-color: #005A9C; }
                .team-sel { display: flex; gap: 8px; }
                .team-btn { flex: 1; padding: 12px; border: 2px solid #cbd5e1; border-radius: 10px; cursor: pointer; font-weight: 800; background: #fff; transition: all 0.2s; }
                .team-btn.active { border-color: #005A9C; background: #f0f9ff; color: #005A9C; box-shadow: 0 4px 6px -1px rgba(0, 90, 156, 0.1); }
                button[type="submit"] { background: linear-gradient(135deg, #005A9C 0%, #003366 100%); color: #fff; border: none; padding: 16px; border-radius: 10px; font-weight: 800; cursor: pointer; margin-top: 8px; letter-spacing: 1px; }
            </style>
            <form id="f">
                <div><h2>Consola de Turno</h2><p>Registro de actividad operativa diaria</p></div>
                <input type="text" name="reporter" placeholder="Responsable del Reporte" required>
                <div class="grid">
                    <input type="date" name="date" id="date" required>
                    <select name="shift" id="shift" disabled required><option>Fecha primero...</option></select>
                </div>
                <div class="team-sel">
                    <button type="button" class="team-btn active" data-team="1">EQUIPO 1</button>
                    <button type="button" class="team-btn" data-team="2">EQUIPO 2</button>
                    <button type="button" class="team-btn" data-team="3">EQUIPO 3</button>
                </div>
                <div class="grid">
                    <input type="number" name="totalPacientes" placeholder="Pacientes Totales" required>
                    <input type="number" name="altasAdministrativas" placeholder="Altas Admin." required>
                    <input type="number" name="constatacionLesiones" placeholder="Lesiones" required>
                    <input type="number" name="traslados" placeholder="Traslados" required>
                    <input type="number" name="derivaciones" placeholder="Derivaciones" required>
                </div>
                <button type="submit">GUARDAR REPORTE OFICIAL</button>
            </form>
        `;
    }
}

// --- 3.5 Dashboard Chart ---
class DashboardChart extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); }
    connectedCallback() { this.render(); window.addEventListener('data-updated', () => this.update()); }
    update() {
        const data = Object.values(window.GLOBAL_DATA).filter(d => !d._isPartial).slice(0, 7).reverse();
        if (!data.length) return;
        const max = Math.max(...data.map(d => d.totalPacientes || 1));
        const canvas = this.shadowRoot.getElementById('c');
        const ctx = canvas.getContext('2d');
        const w = canvas.width; const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        
        // Ejes
        ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(40, 20); ctx.lineTo(40, h-40); ctx.lineTo(w-20, h-40); ctx.stroke();
        
        const step = (w - 60) / (data.length - 1 || 1);
        ctx.beginPath(); ctx.strokeStyle = '#005A9C'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
        data.forEach((d, i) => {
            const x = i * step + 40;
            const y = (h-40) - ((d.totalPacientes / max) * (h-80));
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            
            // Puntos
            ctx.fillStyle = '#005A9C';
            ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2); ctx.fill();
            ctx.stroke();
            
            // Labels
            ctx.fillStyle = '#64748b'; ctx.font = '9px Inter'; ctx.textAlign = 'center';
            ctx.fillText(d.date.split('-').slice(1).join('/'), x, h-20);
            ctx.fillStyle = '#0f172a'; ctx.font = 'bold 10px Inter';
            ctx.fillText(d.totalPacientes, x, y-10);
        });
        ctx.stroke();
    }
    render() {
        this.shadowRoot.innerHTML = `
            <style>:host { display: block; background:#fff; padding:24px; border-radius:16px; border:1px solid #e2e8f0; } h2 { font-size: 16px; margin: 0 0 16px; color: #005A9C; font-weight: 800; } canvas { width: 100%; height: 250px; }</style>
            <h2>📈 Tendencia Semanal de Atenciones</h2>
            <canvas id="c" width="600" height="250"></canvas>
        `;
    }
}

// --- 3.6 Monthly Data View ---
class MonthlyDataView extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); }
    connectedCallback() { this.render(); window.addEventListener('data-updated', () => this.update()); }
    update() {
        const data = Object.values(window.GLOBAL_DATA).filter(d => !d._isPartial).slice(0, 10);
        const tbody = this.shadowRoot.querySelector('tbody');
        tbody.innerHTML = data.map(d => `
            <tr>
                <td><b>${d.date}</b><br><small>${d.shift}</small></td>
                <td>EQ ${d.team}</td>
                <td>${d.totalPacientes}</td>
                <td>${d.constatacionLesiones}</td>
                <td><button class="del-btn" data-id="${d.date}_${d.shift}">🗑️</button></td>
            </tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#94a3b8;">Sin datos registrados.</td></tr>';
        
        this.shadowRoot.querySelectorAll('.del-btn').forEach(btn => {
            btn.addEventListener('click', () => window.dbDelete(btn.dataset.id));
        });
    }
    render() {
        this.shadowRoot.innerHTML = `
            <style>
                table { width: 100%; border-collapse: collapse; font-size: 13px; }
                th { background: #f8fafc; padding: 12px; text-align: left; color: #64748b; font-weight: 700; border-bottom: 2px solid #e2e8f0; }
                td { padding: 12px; border-bottom: 1px solid #f1f5f9; }
                .del-btn { background: none; border: none; cursor: pointer; opacity: 0.5; transition: opacity 0.2s; }
                .del-btn:hover { opacity: 1; }
            </style>
            <table>
                <thead><tr><th>Fecha / Turno</th><th>Equipo</th><th>Pac.</th><th>Les.</th><th>Acción</th></tr></thead>
                <tbody></tbody>
            </table>
        `;
    }
}

// --- 3.7 Gemini Analysis ---
class GeminiAnalysis extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); }
    connectedCallback() { this.render(); window.addEventListener('data-updated', () => this.update()); }
    update() {
        const data = Object.values(window.GLOBAL_DATA).filter(d => !d._isPartial);
        if (!data.length) return;
        const lat = data[0];
        const text = `Asistente Operativo: En el turno ${lat.shift} del ${lat.date}, el Equipo ${lat.team} gestionó ${lat.totalPacientes} pacientes. ${lat.constatacionLesiones > 10 ? 'Se observa un incremento crítico en las constataciones de lesiones.' : 'La operación se mantiene dentro de los rangos normales.'}`;
        this.shadowRoot.querySelector('.content').innerText = text;
    }
    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; padding: 20px; border-radius: 12px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #fff; position: relative; overflow: hidden; }
                .ai-badge { position: absolute; top: 0; right: 0; background: #3b82f6; color: #fff; font-size: 10px; font-weight: 800; padding: 4px 12px; border-bottom-left-radius: 12px; text-transform: uppercase; }
                h4 { margin: 0 0 10px; font-size: 14px; display: flex; align-items: center; gap: 8px; color: #3b82f6; }
                .content { font-size: 13px; line-height: 1.6; color: #cbd5e1; }
            </style>
            <div class="ai-badge">Google Gemini v1.5</div>
            <h4>✨ Handover Intelligence</h4>
            <div class="content">Analizando flujos de datos...</div>
        `;
    }
}

// Registro de Componentes
customElements.define('monthly-summary', MonthlySummary);
customElements.define('extreme-events-analysis', ExtremeEventsAnalysis);
customElements.define('team-comparison', TeamComparison);
customElements.define('data-entry-form', DataEntryForm);
customElements.define('dashboard-chart', DashboardChart);
customElements.define('monthly-data-view', MonthlyDataView);
customElements.define('gemini-analysis', GeminiAnalysis);

// Placeholders para componentes adicionales
['period-stats-explorer', 'tableau-lite-explorer', 'bulk-data-entry', 'monthly-total-entry'].forEach(tag => {
    customElements.define(tag, class extends HTMLElement {
        constructor() { super(); this.attachShadow({ mode: 'open' }); }
        connectedCallback() {
            this.shadowRoot.innerHTML = `<style>:host { display: flex; align-items: center; justify-content: center; min-height: 100px; color: #94a3b8; font-size: 12px; font-weight: 700; text-transform: uppercase; background: #f8fafc; border: 2px dashed #e2e8f0; border-radius: 12px; }</style><div>[ ${tag.replace(/-/g, ' ')} pronto ]</div>`;
        }
    });
});

/* ----------------------------------------------------
   4. MOTOR DE DATOS (REAL-TIME)
   ---------------------------------------------------- */

function startAnalyticRealTime() {
    if (!window.activeListeners) window.activeListeners = {};
    if (window.activeListeners.estadisticas) {
        window.activeListeners.estadisticas();
    }

    const q = query(collection(db, PROD_PATH), orderBy('timestamp', 'desc'), limit(100));
    window.activeListeners.estadisticas = onSnapshot(q, (snap) => {
        const newData = {};
        snap.forEach(doc => { newData[doc.id] = doc.data(); });
        window.GLOBAL_DATA = newData;
        window.dispatchEvent(new CustomEvent('data-updated'));
    }, (err) => {
        console.error("Firestore Error:", err);
        window.showToast("Error de conexión con la nube", "error");
    });
}

// Manejo del selector de modo de entrada
document.addEventListener('DOMContentLoaded', () => {
    const entryMode = document.getElementById('entry-mode');
    const dailyWrapper = document.getElementById('daily-entry-wrapper');
    const monthlyWrapper = document.getElementById('monthly-entry-wrapper');
    if (entryMode) {
        entryMode.addEventListener('change', () => {
            if (entryMode.value === 'daily') {
                dailyWrapper.style.display = 'block';
                monthlyWrapper.style.display = 'none';
            } else {
                dailyWrapper.style.display = 'none';
                monthlyWrapper.style.display = 'block';
            }
        });
    }
});

// Inicialización
onAuthStateChanged(auth, (u) => {
    if (u) startAnalyticRealTime();
});
