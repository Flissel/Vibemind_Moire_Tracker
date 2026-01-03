# UI Analysis Skill

Analyze desktop UI using MoireTracker detection data.

## When to use this skill

Use this skill when you need to:
- Understand what's visible on screen
- Find specific UI elements
- Navigate through applications
- Identify clickable elements

## Input format

You will receive UI context in this format:
```
=== UI Analyse Ergebnis ===
Zeitstempel: <timestamp>
Verarbeitungszeit: <ms>
OCR-Qualität: <percentage>

📱 Anwendung: <app_name>
🪟 Fenster: <window_title>

📊 Statistiken:
   • <n> UI-Elemente erkannt
   • <m> mit Text (<percentage>)
   • <r> Regionen
   • <l> Zeilen

🔧 Toolbar: <toolbar_items>
📋 Menü: <menu_items>
📝 Inhalt: <content_preview>

⚡ Verfügbare Aktionen:
   • <action_1> @ (x, y)
   • <action_2> @ (x, y)
```

## How to analyze

1. **Identify the application**: Look at window title and menu items
2. **Understand the layout**: Toolbar at top, content in middle, status at bottom
3. **Find actionable elements**: Buttons, links, input fields
4. **Note coordinates**: Each element has (x, y) click position

## Output format

Provide analysis in this structure:

```
**Aktuelle Ansicht:**
[Application name] - [Current view/tab]

**Wichtige Elemente:**
- [Element 1]: [Purpose] → Klick bei (x, y)
- [Element 2]: [Purpose] → Klick bei (x, y)

**Empfohlene Aktion:**
[What to click/type to accomplish the goal]
```

## Example

**Input:**
```
📱 Anwendung: chrome
🪟 Fenster: Google - Google Chrome
📋 Menü: File, Edit, View, Help
📝 Inhalt: Search Google or type a URL...
⚡ Verfügbare Aktionen:
   • click on 'Search' @ (500, 300)
```

**Output:**
```
**Aktuelle Ansicht:**
Google Chrome - Google Startseite

**Wichtige Elemente:**
- Suchfeld: Für Suchanfragen → Klick bei (500, 300)
- Menü: Browser-Funktionen → Klick bei (50, 20)

**Empfohlene Aktion:**
Klicke auf das Suchfeld bei (500, 300) und gebe die Suchanfrage ein.
```