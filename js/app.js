// Register Service Worker per PWA / Offline
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then((reg) => console.log('Service Worker registrato:', reg.scope))
            .catch((err) => console.warn('Errore Service Worker:', err));
    });
}

// IP del tuo laptop nella rete locale per il WebSocket dell'Agent
const LAPTOP_IP = '192.168.1.63'; // <--- INSERISCI QUI L'IP DEL TUO LAPTOP
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
    
    // Meteo autonomo dal tablet
    fetchWeatherDirectly();
    setInterval(fetchWeatherDirectly, 30 * 60 * 1000); // Aggiorna ogni 30 minuti
});

// --- 1. OROLOGIO E DATA ---
function initClock() {
    function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        
        const clockElem = document.getElementById('clock') || 
                          document.querySelector('.clock') || 
                          document.querySelector('header h1') || 
                          document.querySelector('h1');

        if (clockElem) {
            clockElem.textContent = `${hours}:${minutes}`;
        }

        const options = { weekday: 'long', day: 'numeric', month: 'long' };
        const dateStr = now.toLocaleDateString('it-IT', options);
        const dateElem = document.getElementById('date') || 
                         document.querySelector('.date') || 
                         document.querySelector('header p') || 
                         document.querySelector('.subtitle');

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
        const lat = 41.467; 
        const lon = 12.903;
        
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
    const weatherCard = findCardByTitle('WEATHER') || findCardByTitle('METEO');
    if (weatherCard) {
        // Rimuovi o nascondi eventuali placeholder tipo "In attesa dei dati..."
        const waitingElem = weatherCard.querySelector('.loading, .status, #weather-status') || 
                            Array.from(weatherCard.querySelectorAll('p, span')).find(el => el.textContent.includes('attesa'));
        if (waitingElem) {
            waitingElem.style.display = 'none';
        }

        const tempElem = weatherCard.querySelector('h2, .temp, #weather-temp') || weatherCard.children[1];
        const condElem = weatherCard.querySelector('p:not(#weather-status), .cond, #weather-cond') || weatherCard.children[2];
        
        if (tempElem) {
            tempElem.innerHTML = `<span class="weather-icon-inline" style="font-size: 1.2em; vertical-align: middle; margin-right: 5px;">${icon}</span><span class="weather-temp-num">${temp}</span><span style="font-size: 0.7em; margin-left: 2px;">°C</span>`;
        }
        if (condElem) {
            condElem.textContent = condition;
        }
    }
}

// --- 3. MENU ---
function initMenu() {
    const menuBtn = document.querySelector('.menu-btn') || document.getElementById('menu-btn') || document.querySelector('.three-dots');
    const menuDropdown = document.getElementById('menu-dropdown') || document.querySelector('.dropdown-menu');

    if (menuBtn) {
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (menuDropdown) {
                const isVisible = menuDropdown.style.display === 'block';
                menuDropdown.style.display = isVisible ? 'none' : 'block';
            }
        });
    }

    document.addEventListener('click', () => {
        if (menuDropdown) menuDropdown.style.display = 'none';
    });
}

// --- 4. CONTROLLI MEDIA E AZIONI LAPTOP ---
function initActionButtons() {
    // Media controls
    const mediaBtns = document.querySelectorAll('.now-playing button, .media-controls button');
    mediaBtns.forEach(btn => {
        const text = btn.innerText || btn.innerHTML || '';
        if (text.includes('⏮') || btn.classList.contains('prev')) {
            btn.onclick = () => sendAgentCommand('media_previous');
        } else if (text.includes('⏯') || text.includes('▶') || btn.classList.contains('play')) {
            btn.onclick = () => sendAgentCommand('media_play_pause');
        } else if (text.includes('⏭') || btn.classList.contains('next')) {
            btn.onclick = () => sendAgentCommand('media_next');
        }
    });

    // Pulsanti Spegni / Sospendi Laptop
    const shutdownBtn = document.getElementById('btn-shutdown') || document.querySelector('.btn-shutdown') || findButtonByText('spegni');
    if (shutdownBtn) {
        shutdownBtn.onclick = () => sendAgentCommand('shutdown');
    }

    const suspendBtn = document.getElementById('btn-suspend') || document.querySelector('.btn-suspend') || findButtonByText('sospendi');
    if (suspendBtn) {
        suspendBtn.onclick = () => sendAgentCommand('suspend');
    }

    const reloadBtn = document.getElementById('btn-reload') || document.querySelector('.btn-reload') || findButtonByText('ricarica');
    if (reloadBtn) {
        reloadBtn.onclick = () => window.location.reload();
    }
}

// --- 5. DROPDOWN METRICA ---
function initMetricDropdown() {
    const selectElem = document.querySelector('.card select') || document.getElementById('metric-select');
    if (selectElem) {
        selectElem.addEventListener('change', (e) => {
            const val = e.target.value.toLowerCase();
            if (val.includes('ram')) currentMetric = 'ram';
            else if (val.includes('net')) currentMetric = 'net';
            else currentMetric = 'cpu';
            
            chartDataValues.fill(0);
            if (cpuChart) cpuChart.update();
        });
    }
}

// --- 6. GRAFICO ---
function initChart() {
    const ctx = document.getElementById('cpuChart') || document.querySelector('canvas');
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
                        ticks: { color: '#888' }
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
        setTimeout(connectWebSocket, 5000);
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
    const laptopOs = document.getElementById('laptop-os');
    const laptopCpu = document.getElementById('laptop-cpu');
    const laptopRam = document.getElementById('laptop-ram');

    if (laptopOs) laptopOs.textContent = data.os || 'Windows 11';
    if (laptopCpu && data.cpu !== undefined) laptopCpu.textContent = `${data.cpu} %`;
    if (laptopRam && data.ram_used_gb !== undefined) {
        laptopRam.textContent = `${data.ram_used_gb} / ${data.ram_total_gb} GB (${data.ram_percent}%)`;
    }

    let valToPush = data.cpu || 0;
    if (currentMetric === 'ram') valToPush = data.ram_percent || 0;
    if (currentMetric === 'net') valToPush = data.net_recv_mb || 0;

    chartDataValues.push(valToPush);
    chartDataValues.shift();
    if (cpuChart) cpuChart.update('none');

    if (data.weather) {
        updateWeatherUI(data.weather.temp, data.weather.condition, data.weather.icon);
    }
}

// --- 9. AGGIORNAMENTO STATO (Laptop + System Status) ---
function updateAgentStatus(isOnline) {
    // 1. Aggiorna la sezione specifica Laptop
    const laptopStatusText = document.getElementById('laptop-status-text');
    const laptopStatusDot = document.getElementById('laptop-status-dot');

    if (laptopStatusText) {
        laptopStatusText.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
        laptopStatusText.style.color = isOnline ? '#4ed99c' : '#ff5c5c';
    }
    if (laptopStatusDot) {
        laptopStatusDot.style.backgroundColor = isOnline ? '#4ed99c' : '#ff5c5c';
    }

    // 2. Aggiorna la sezione generale "SYSTEM STATUS" (Spia del menu o dashboard)
    const systemStatusCard = findCardByTitle('SYSTEM STATUS') || findCardByTitle('STATUS');
    if (systemStatusCard) {
        const statusText = systemStatusCard.querySelector('.status-text, p, span');
        const statusDot = systemStatusCard.querySelector('.dot, .status-dot, .led');

        if (statusText) {
            statusText.textContent = isOnline ? 'Connected' : 'Disconnected';
            statusText.style.color = isOnline ? '#4ed99c' : '#ff5c5c';
        }
        if (statusDot) {
            statusDot.style.backgroundColor = isOnline ? '#4ed99c' : '#ff5c5c';
            statusDot.classList.toggle('connected', isOnline);
            statusDot.classList.toggle('disconnected', !isOnline);
        }
    }

    if (!isOnline) {
        fetchWeatherDirectly();
    }
}

// Helper per trovare schede tramite il titolo
function findCardByTitle(titleText) {
    const cards = document.querySelectorAll('.card');
    for (let card of cards) {
        if (card.innerText && card.innerText.toUpperCase().includes(titleText)) {
            return card;
        }
    }
    return null;
}

// Helper per trovare pulsanti tramite il testo contenuto
function findButtonByText(textMatch) {
    const buttons = document.querySelectorAll('button');
    for (let btn of buttons) {
        if (btn.innerText && btn.innerText.toLowerCase().includes(textMatch.toLowerCase())) {
            return btn;
        }
    }
    return null;
}