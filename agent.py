import asyncio
import json
import os
import sys
import psutil
import urllib.request
import websockets
import ctypes
import subprocess
import pyautogui
import datetime
from icalendar import Calendar
import recurring_ical_events

# Riconoscimento sistema operativo
IS_WINDOWS = sys.platform.startswith("win")

# Librerie specifiche Windows per il controllo dei media
if IS_WINDOWS:
    try:
        import winsdk.windows.media.control as wmc
    except ImportError:
        wmc = None
else:
    wmc = None

# Link iCal Google Calendar
GOOGLE_ICAL_URL = "https://calendar.google.com/calendar/ical/famiglialamia6%40gmail.com/private-26d515a092bc84df3ec04b3b53211369/basic.ics"


def fetch_calendar_events():
    """Scarica e legge gli eventi di oggi dal link Google Calendar iCal"""
    if not GOOGLE_ICAL_URL or "INSERISCI" in GOOGLE_ICAL_URL:
        return []

    try:
        req = urllib.request.Request(
            GOOGLE_ICAL_URL, 
            headers={'User-Agent': 'Mozilla/5.0'}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            ical_data = response.read()

        cal = Calendar.from_ical(ical_data)
        today = datetime.date.today()
        
        # Estrae tutti gli eventi attivi per la data odierna
        events_today = recurring_ical_events.of(cal).at(today)

        formatted_events = []
        for event in events_today:
            summary = str(event.get('summary', 'Evento senza titolo'))
            start = event.get('dtstart').dt
            
            if isinstance(start, datetime.datetime):
                time_str = start.strftime("%H:%M")
            elif isinstance(start, datetime.date):
                time_str = "Tutto il giorno"
            else:
                time_str = ""

            formatted_events.append({
                "time": time_str,
                "summary": summary
            })

        return formatted_events
    except Exception as e:
        print(f"Errore lettura Calendario: {e}")
        return []


def fetch_weather_info():
    """Recupera meteo, temperatura e icona via Open-Meteo API"""
    try:
        url = "https://api.open-meteo.com/v1/forecast?latitude=37.5778&longitude=15.0964&current_weather=true"
        req = urllib.request.urlopen(url, timeout=5)
        data = json.loads(req.read().decode())
        
        if "current_weather" in data:
            temp = round(data["current_weather"]["temperature"])
            code = data["current_weather"]["weathercode"]
            
            condition = "Sereno"
            icon = "☀️"
            
            if code in [1, 2, 3]:
                condition = "Nuvoloso"
                icon = "⛅"
            elif code in [45, 48]:
                condition = "Nebbia"
                icon = "🌫️️"
            elif code in [51, 53, 55, 61, 63, 65, 80, 81, 82]:
                condition = "Pioggia"
                icon = "🌧️"
            elif code in [71, 73, 75, 85, 86]:
                condition = "Neve"
                icon = "❄️"
            elif code in [95, 96, 99]:
                condition = "Temporale"
                icon = "🌩️"

            return {
                "temp": f"{temp}°C",
                "condition": condition,
                "icon": icon
            }
    except Exception as e:
        print(f"Errore meteo: {e}")
        
    return {"temp": "--°C", "condition": "N/D", "icon": "🌡"}


async def fetch_media_info():
    """Recupera titolo e artista in riproduzione da Windows Media Control"""
    if IS_WINDOWS and wmc:
        try:
            manager = await wmc.GlobalSystemMediaTransportControlsSessionManager.request_async()
            current_session = manager.get_current_session()
            
            if not current_session:
                sessions = manager.get_sessions()
                if sessions and len(sessions) > 0:
                    current_session = sessions[0]

            if current_session:
                info = await current_session.try_get_media_properties_async()
                playback = current_session.get_playback_info()
                
                is_playing = False
                if playback:
                    status_val = int(playback.playback_status)
                    is_playing = (status_val == 4)

                if info:
                    title_text = info.title.strip() if info.title else ""
                    artist_text = info.artist.strip() if info.artist else "Artista sconosciuto"
                    
                    if title_text:
                        return {
                            "title": title_text,
                            "artist": artist_text,
                            "playing": is_playing
                        }
        except Exception:
            pass
            
    return {
        "title": "Nothing playing",
        "artist": "In attesa di media...",
        "playing": False
    }


def fetch_system_stats():
    """Lettura metriche di sistema CPU, RAM, Rete, OS"""
    cpu_percent = psutil.cpu_percent(interval=None)
    ram = psutil.virtual_memory()
    net = psutil.net_io_counters()
    
    return {
        "os": "Windows 11" if IS_WINDOWS else "Linux Fedora",
        "cpu": cpu_percent,
        "ram_percent": ram.percent,
        "ram_used_gb": round(ram.used / (1024**3), 1),
        "ram_total_gb": round(ram.total / (1024**3), 1),
        "net_recv_mb": round(net.bytes_recv / (1024**2), 1)
    }


async def handle_command(command):
    """Gestione comandi ricevuti dalla dashboard"""
    print(f"🕹️ Comando ricevuto: {command}")
    if IS_WINDOWS:
        if command == "poweroff" or command == "shutdown":
            # Spegne Windows subito
            subprocess.run(["shutdown", "/s", "/t", "0"], shell=True)
        elif command == "suspend" or command == "lock":
            # Blocca/Sospende Windows
            ctypes.windll.user32.LockWorkStation()
        elif command == "media_play_pause":
            pyautogui.press('playpause')
        elif command == "media_next":
            pyautogui.press('nexttrack')
        elif command == "media_previous":
            pyautogui.press('prevtrack')
async def agent_connection_handler(websocket):
    print("⚡ Tablet/Dashboard connesso all'Agent!")
    
    # Task 1: Invio dati continuativo (ogni 1 secondo)
    async def send_loop():
        try:
            while True:
                stats = fetch_system_stats()
                media = await fetch_media_info()
                weather = fetch_weather_info()
                
                payload = {
                    **stats,
                    "media": media,
                    "weather": weather,
                    "events": fetch_calendar_events()
                }
                
                await websocket.send(json.dumps(payload))
                await asyncio.sleep(1)
        except websockets.exceptions.ConnectionClosed:
            pass

    # Task 2: Ascolto comandi in entrata dal client Web
    async def receive_loop():
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    cmd = data.get("command")
                    if cmd:
                        await handle_command(cmd)
                except Exception as e:
                    print(f"Errore parsing messaggio: {e}")
        except websockets.exceptions.ConnectionClosed:
            pass

    # Avvio contemporaneo di invio dati e ricezione comandi sulla stessa socket
    try:
        await asyncio.gather(send_loop(), receive_loop())
    finally:
        print("❌ Tablet/Dashboard disconnesso.")


async def main():
    print("🚀 Agent Python avviato su ws://0.0.0.0:8765")
    async with websockets.serve(agent_connection_handler, "0.0.0.0", 8765):
        await asyncio.Future()  # Mantiene attivo il server WebSocket


if __name__ == "__main__":
    asyncio.run(main())