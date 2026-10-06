// Register Service Worker per PWA / Offline
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then((reg) => console.log('Service Worker registrato:', reg.scope))
            .catch((err) => console.warn('Errore Service Worker:', err));
    });
}

// IP del tuo laptop nella rete locale per il WebSocket dell'Agent
const LAPTOP_IP = '192.168.1.72';
const WS_URL = `ws://${window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') ? window.location.hostname : LAPTOP_IP}:8765`;

let ws = null;
let cpuChart = null;
let currentMetric = 'cpu';
const maxDataPoints = 20;
const chartLabels = Array(maxDataPoints).fill('');
const chartDataValues = Array(maxDataPoints).fill(0);

document.addEventListener('DOMContentLoaded', () => {
    initClock();
    initChart();
    initMenu();
    initActionButtons();
    initMetricDropdown();
    connectWebSocket();
    
    // Meteo autonomo dal tablet se agent non connesso
    fetchWeatherDirectly();
    setInterval(fetchWeatherDirectly, 30 * 60 * 1000);
});

// --- 1. OROLOGIO E DATA ---
function initClock() {
    function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        
        const clockElem = document.getElementById('clock');
        if (clockElem) {
            clockElem.textContent = `${hours}:${minutes}`;
        }

        const options = { weekday: 'long', day: 'numeric', month: 'long' };
        const dateStr = now.toLocaleDateString('it-IT', options);
        const dateElem = document.getElementById('date');

        if (dateElem) {
            dateElem.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
        }
    }
    
    updateClock();
    setInterval(updateClock, 1000);
}

// --- 2. METEO AUTONOMO ---
async function fetchWeatherDirectly() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    try {
        const lat = 37.5778; 
        const lon = 15.0964;
        
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        const data = await response.json();
        
        if (data && data.current_weather) {
            const temp = Math.round(data.current_weather.temperature);
            const code = data.current_weather.weathercode;
            
            let cond = "Sereno";
            let icon = "☀️";
            if (code >= 1 && code <= 3) { cond = "Nuvoloso"; icon = "⛅"; }
            else if (code >= 45 && code <= 48) { cond = "Nebbia"; icon = "🌫"; }
            else if (code >= 51 && code <= 67) { cond = "Pioggia"; icon = "🌧️"; }
            else if (code >= 71 && code <= 77) { cond = "Neve"; icon = "❄️"; }
            else if (code >= 80 && code <= 82) { cond = "Rovesci"; icon = "🌦️"; }
            else if (code >= 95) { cond = "Temporale"; icon = "⛈️"; }

            updateWeatherUI(temp, cond, icon);
        }
    } catch (err) {
        console.warn("Impossibile scaricare il meteo direttamente:", err);
    }
}

function updateWeatherUI(temp, condition, icon) {
    const tempElem = document.getElementById('weather-temp');
    const condElem = document.getElementById('weather-cond');

    if (tempElem) {
        tempElem.innerHTML = `<span style="font-size: 0.8em; margin-right: 6px;">${icon}</span>${temp}°C`;
    }
    if (condElem) {
        condElem.textContent = condition;
    }
}

// --- 3. MENU A TENDINA ---
function initMenu() {
    const menuBtn = document.getElementById('menu-btn');
    const menuDropdown = document.getElementById('menu-dropdown');

    if (menuBtn && menuDropdown) {
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            menuDropdown.classList.toggle('show');
        });

        document.addEventListener('click', () => {
            menuDropdown.classList.remove('show');
        });
    }

    // Elementi del menu
    const refreshBtn = document.getElementById('menu-refresh');
    if (refreshBtn) {
        refreshBtn.onclick = () => window.location.reload();
    }

    const suspendBtn = document.getElementById('menu-suspend');
    if (suspendBtn) {
        suspendBtn.onclick = () => sendAgentCommand('suspend');
    }

    const poweroffBtn = document.getElementById('menu-poweroff');
    if (poweroffBtn) {
        poweroffBtn.onclick = () => sendAgentCommand('poweroff');
    }
}

// --- 4. CONTROLLI MEDIA ---
function initActionButtons() {
    const prevBtn = document.querySelector('.media-btn.prev');
    const playBtn = document.querySelector('.media-btn.play');
    const nextBtn = document.querySelector('.media-btn.next');

    if (prevBtn) prevBtn.onclick = () => sendAgentCommand('media_previous');
    if (playBtn) playBtn.onclick = () => sendAgentCommand('media_play_pause');
    if (nextBtn) nextBtn.onclick = () => sendAgentCommand('media_next');
}

// --- 5. DROPDOWN METRICA ---
function initMetricDropdown() {
    const selectElem = document.getElementById('metric-select');
    if (selectElem) {
        selectElem.addEventListener('change', (e) => {
            currentMetric = e.target.value;
            chartDataValues.fill(0);
            if (cpuChart) cpuChart.update();
        });
    }
}

// --- 6. GRAFICO ---
function initChart() {
    const ctx = document.getElementById('cpuChart');
    if (!ctx) return;

    try {
        cpuChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartLabels,
                datasets: [{
                    label: 'Attività',
                    data: chartDataValues,
                    borderColor: '#4ed99c',
                    backgroundColor: 'rgba(78, 217, 156, 0.12)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                scales: {
                    x: { display: false },
                    y: {
                        min: 0,
                        suggestedMax: 100,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#8292a6', font: { size: 10 } }
                    }
                },
                plugins: { legend: { display: false } }
            }
        });
    } catch (err) {
        console.error("Errore Chart.js:", err);
    }
}

// --- 7. WEBSOCKET ---
function connectWebSocket() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        console.log('⚡ Connesso all\'Agent!');
        updateAgentStatus(true);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            updateDashboard(data);
            updateAgentStatus(true);
        } catch (e) {
            console.error('Errore parsing JSON:', e);
        }
    };

    ws.onclose = () => {
        updateAgentStatus(false);
        setTimeout(connectWebSocket, 4000);
    };

    ws.onerror = () => {
        updateAgentStatus(false);
    };
}

function sendAgentCommand(command) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ command: command }));
        console.log(`Comando inviato: ${command}`);
    } else {
        console.warn(`Impossibile inviare ${command}: Agent non connesso.`);
    }
}

// --- 8. AGGIORNAMENTO DASHBOARD ---
function updateDashboard(data) {
    // Laptop Info
    const laptopOs = document.getElementById('laptop-os');
    const laptopCpu = document.getElementById('laptop-cpu');
    const laptopRam = document.getElementById('laptop-ram');

    if (laptopOs) laptopOs.textContent = data.os || 'Windows 11';
    if (laptopCpu && data.cpu !== undefined) laptopCpu.textContent = `${data.cpu} %`;
    if (laptopRam && data.ram_used_gb !== undefined) {
        laptopRam.textContent = `${data.ram_used_gb} / ${data.ram_total_gb} GB (${data.ram_percent}%)`;
    }

    // Media
    if (data.media) {
        const titleElem = document.getElementById('media-title');
        const artistElem = document.getElementById('media-artist');
        if (titleElem) titleElem.textContent = data.media.title || 'Nothing playing';
        if (artistElem) artistElem.textContent = data.media.artist || 'In attesa di media...';
    }

    // Chart Data
    let valToPush = data.cpu || 0;
    if (currentMetric === 'ram') valToPush = data.ram_percent || 0;
    if (currentMetric === 'net') valToPush = data.net_recv_mb || 0;

    chartDataValues.push(valToPush);
    chartDataValues.shift();
    if (cpuChart) cpuChart.update('none');

    // Weather
    if (data.weather) {
        updateWeatherUI(data.weather.temp, data.weather.condition, data.weather.icon);
    }

    // Calendar Events Fix
    if (data.events) {
        updateCalendarUI(data.events);
    }
}

// --- 9. AGGIORNAMENTO CALENDARIO ---
function updateCalendarUI(events) {
    const eventsList = document.getElementById('events-list');
    if (!eventsList) return;

    if (!events || events.length === 0) {
        eventsList.innerHTML = `<div style="color: var(--text-sub); font-size: 0.85rem;">Nessun evento in programma oggi</div>`;
        return;
    }

    eventsList.innerHTML = events.map(ev => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <span style="font-size: 0.85rem; color: var(--text-main); font-weight: 500;">${ev.summary}</span>
            <span style="font-size: 0.75rem; color: var(--accent-green); background: rgba(78, 217, 156, 0.12); padding: 2px 8px; border-radius: 4px; font-weight: 600;">${ev.time}</span>
        </div>
    `).join('');
}

// --- 10. AGGIORNAMENTO STATI & SPIE ---
function updateAgentStatus(isOnline) {
    // 1. Laptop Card Status
    const laptopStatusText = document.getElementById('laptop-status-text');
    const laptopStatusDot = document.getElementById('laptop-status-dot');

    if (laptopStatusText) {
        laptopStatusText.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
        laptopStatusText.style.color = isOnline ? 'var(--accent-green)' : 'var(--accent-red)';
    }
    if (laptopStatusDot) {
        laptopStatusDot.style.backgroundColor = isOnline ? 'var(--accent-green)' : 'var(--accent-red)';
        laptopStatusDot.style.boxShadow = isOnline ? '0 0 8px var(--accent-green)' : '0 0 8px var(--accent-red)';
    }

    // 2. System Status Card
    const agentStatusText = document.getElementById('agent-status-text');
    const agentStatusDot = document.getElementById('agent-status-dot');

    if (agentStatusText) {
        agentStatusText.textContent = isOnline ? 'Connected' : 'Disconnected';
        agentStatusText.style.color = isOnline ? 'var(--accent-green)' : 'var(--accent-red)';
    }
    if (agentStatusDot) {
        agentStatusDot.style.backgroundColor = isOnline ? 'var(--accent-green)' : 'var(--accent-red)';
        agentStatusDot.style.boxShadow = isOnline ? '0 0 8px var(--accent-green)' : '0 0 8px var(--accent-red)';
    }

    if (!isOnline) {
        fetchWeatherDirectly();
    }
}