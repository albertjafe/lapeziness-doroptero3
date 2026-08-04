import json
from playwright.sync_api import sync_playwright

fixture = {
  "obras": [{"id": "obra_1", "name": "Bach · Preludio", "composer": "J. S. Bach", "tipo": "obra", "movimientos": [], "sol": 50, "solHistory": []}],
  "eventos": [], "sesiones": [], "registro": [], "sessionPlants": [], "forestPlants": [],
  "estadoEventos": [], "impulsoEventos": [], "malestarEventos": [], "deporteEventos": [], "suenoEventos": [], "triggerEventos": [],
  "tiempoDisponibleEventos": [], "dailyJournalEntries": [], "blockedDaySchedules": [],
  "habitChallenge": {
    "id": "challenge_1",
    "title": "Práctica de escalas",
    "mode": "do",
    "durationDays": 21,
    "startDate": "2026-08-04",
    "logs": {},
    "createdAt": "2026-08-04T00:00:00.000Z",
    "updatedAt": "2026-08-04T00:00:00.000Z"
  }
}

fixture_json = json.dumps(fixture)

def run_cuj(page):
    # Register init script to mock Supabase and setup localStorage
    # We write fixture_json directly since localStorage values are stored as strings!
    js_code = f"""
    localStorage.setItem('alberto_piano_v2', `{fixture_json}`);
    localStorage.setItem('alberto_sync_v1', `{{"localRevision": 0, "dirtyRevision": 0, "lastSyncedRevision": 0}}`);
    """
    page.add_init_script(js_code)

    # Go to app
    page.goto("http://localhost:4173")
    page.wait_for_timeout(1500)

    # Make sure we switch to the stopwatch view
    page.evaluate("showView('cronometro')")
    page.wait_for_timeout(1000)

    # Take initial screenshot of cronometro calendar panel
    page.screenshot(path="verification_calendar.png")
    print("Initial calendar screenshot captured!")

    # Click on the Objectives tab in the stopwatch selector
    print("Clicking 'Objetivos' tab...")
    page.click("#cronoTabObjectives")
    page.wait_for_timeout(1000)

    # Take screenshot at the objectives state
    page.screenshot(path="verification.png")
    print("Objectives screenshot captured!")

    # Click back to Calendario
    print("Clicking 'Calendario' tab...")
    page.click("#cronoTabCalendar")
    page.wait_for_timeout(1000)

    # Click back to Objectives
    print("Clicking 'Objetivos' tab again...")
    page.click("#cronoTabObjectives")
    page.wait_for_timeout(1000)

    # Click mark habit as completed today
    print("Toggling habit today...")
    # Find button "Marcar hoy como cumplido" / "toggleHabitToday"
    page.click(".habit-calendar-today")
    page.wait_for_timeout(1000)

    # Take second screenshot showing habit successfully completed
    page.screenshot(path="verification_completed.png")
    print("Second screenshot captured!")
    page.wait_for_timeout(1000)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1024, "height": 768},
            record_video_dir="videos"
        )
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()
            browser.close()
