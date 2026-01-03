# Application Navigation Skill

Navigate through desktop applications using MoireTracker detection.

## When to use this skill

Use this skill when you need to:
- Open applications or files
- Navigate through menus
- Switch between windows/tabs
- Use keyboard shortcuts

## Navigation Methods

### 1. Menu Navigation

**Standard Menu Path:**
```
Menu Bar → Menu Item → Submenu → Action
Example: File → Open → Recent Files → document.txt
```

**Steps:**
1. Find menu bar items (top of window, y < 50)
2. Click main menu (e.g., "File" at (50, 25))
3. Wait for dropdown to appear (100-200ms)
4. Click submenu item
5. Repeat until reaching target action

### 2. Toolbar Navigation

**Common Toolbar Actions:**
- New: Often leftmost button or Ctrl+N
- Open: Folder icon or Ctrl+O  
- Save: Disk icon or Ctrl+S
- Undo/Redo: Arrow icons or Ctrl+Z/Ctrl+Y

**Steps:**
1. Identify toolbar region (y < 100, icons/buttons)
2. Match icon to desired action
3. Click icon center

### 3. Tab Navigation

**Browser/Editor Tabs:**
```
Tab bar usually at y = 30-60
Each tab has title text
Active tab visually highlighted
```

**Steps:**
1. Find tab bar region
2. Locate tab by title text
3. Click tab center
4. For new tab: Click + button or Ctrl+T

### 4. Keyboard Shortcuts

**Universal Shortcuts:**
| Action | Windows | Mac |
|--------|---------|-----|
| Copy | Ctrl+C | Cmd+C |
| Paste | Ctrl+V | Cmd+V |
| Cut | Ctrl+X | Cmd+X |
| Undo | Ctrl+Z | Cmd+Z |
| Select All | Ctrl+A | Cmd+A |
| Save | Ctrl+S | Cmd+S |
| Open | Ctrl+O | Cmd+O |
| New | Ctrl+N | Cmd+N |
| Find | Ctrl+F | Cmd+F |
| Close Tab | Ctrl+W | Cmd+W |
| Switch App | Alt+Tab | Cmd+Tab |

### 5. Window Management

**Switching Windows:**
1. Alt+Tab to cycle windows
2. Or click taskbar icon
3. Or use Windows+1, 2, 3... for pinned apps

**Window Actions:**
- Maximize: Click maximize button or Win+Up
- Minimize: Click minimize button or Win+Down
- Close: Click X button or Alt+F4

## Output Format

```
**Navigation Plan:**

Von: [Current location/state]
Nach: [Target location/state]

Schritte:
1. [Action 1] - [Click/Type/Shortcut]
2. [Action 2] - [Click/Type/Shortcut]
...

**Verifizierung:**
Nach Navigation sollte sichtbar sein: [Expected elements]
```

## Example: Open File in Notepad

**Input:**
```
Current state: Notepad open, empty document
Target: Open file named "notes.txt"
```

**Output:**
```
**Navigation Plan:**

Von: Notepad - Leeres Dokument
Nach: Notepad - notes.txt geöffnet

Schritte:
1. Klick auf "File" Menü bei (30, 25)
2. Warte 100ms auf Menü
3. Klick auf "Open" bei (30, 80)
4. Warte auf Dialog
5. Eingabe im Dateinamen-Feld: "notes.txt"
6. Klick auf "Open" Button

Alternative mit Shortcut:
1. Drücke Ctrl+O
2. Warte auf Dialog
3. Eingabe: "notes.txt"
4. Drücke Enter

**Verifizierung:**
Titelleiste sollte zeigen: "notes.txt - Notepad"
```

## Context Menu Navigation

**Right-Click Menus:**
1. Right-click at target coordinates
2. Wait for menu (100-200ms)
3. Click menu item

**Common Context Actions:**
- Copy/Paste in text fields
- Properties on files
- Open with... for files
- Refresh in browsers

## Error Recovery

**Menu disappeared:**
→ Click menu item again to reopen

**Wrong window focused:**
→ Click target window or Alt+Tab

**Dialog blocking:**
→ Close dialog with Escape or X button

**Application not responding:**
→ Wait 2-3 seconds, try again
→ If persists: Alt+F4, restart app