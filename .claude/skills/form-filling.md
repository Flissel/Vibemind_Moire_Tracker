# Form Filling Skill

Automate filling out forms using MoireTracker UI detection.

## When to use this skill

Use this skill when you need to:
- Fill out web forms
- Enter data into input fields
- Complete registration or login forms
- Populate spreadsheet cells

## Prerequisites

- UI analysis data with detected input fields
- Text values to enter
- Coordinates of form elements

## Form Element Types

### Text Fields
- **Identified by**: "textfield", "input" type
- **Action**: Click at center, then type text

### Checkboxes
- **Identified by**: "checkbox" type, ☐/☑ symbols
- **Action**: Click to toggle state

### Dropdowns
- **Identified by**: "dropdown" type, ▼ symbol
- **Action**: Click to open, then click option

### Radio Buttons
- **Identified by**: "radio" type, ○/● symbols  
- **Action**: Click to select

## Step-by-Step Process

### 1. Identify Form Fields
```
Look for elements with type "textfield", "input", "checkbox", "dropdown"
Note their coordinates and any labels nearby
```

### 2. Plan Fill Order
```
Forms usually flow top-to-bottom, left-to-right:
1. Username / Email (top)
2. Password (below username)
3. Confirm Password (below password)
4. Checkboxes (terms, newsletter)
5. Submit button (bottom)
```

### 3. Execute Fill Sequence
```
For each field:
1. Click at field center coordinates
2. Wait briefly (100ms)
3. Clear existing content if needed (Ctrl+A, Delete)
4. Type the value
5. Tab to next field OR click next field
```

## Output Format

```
**Formular-Ausfüllung:**

Schritt 1: Klick auf [Feldname] bei (x, y)
Schritt 2: Eingabe: "[text]"
Schritt 3: Klick auf [Nächstes Feld] bei (x, y)
...

**Nach Abschluss:**
Klick auf [Submit Button] bei (x, y)
```

## Example

**Input:**
```
Detected elements:
- textfield "Email" @ (300, 200)
- textfield "Password" @ (300, 250)  
- checkbox "Remember me" @ (300, 300)
- button "Login" @ (300, 350)

Values to fill:
- Email: user@example.com
- Password: ********
- Remember: checked
```

**Output:**
```
**Formular-Ausfüllung:**

Schritt 1: Klick auf Email-Feld bei (300, 200)
Schritt 2: Eingabe: "user@example.com"
Schritt 3: Klick auf Password-Feld bei (300, 250)
Schritt 4: Eingabe: "********"
Schritt 5: Klick auf Checkbox bei (300, 300)
Schritt 6: Klick auf Login-Button bei (300, 350)

**Nach Abschluss:**
Warte auf Seitenladung und prüfe Erfolg
```

## Text Selection and Replacement

For replacing existing text:

### Method 1: Select All + Delete + Type
```
1. Click in field at (x, y)
2. Press Ctrl+A to select all
3. Press Delete to clear
4. Type new text
```

### Method 2: Triple-Click + Type
```
1. Triple-click at (x, y) to select line
2. Type new text (replaces selection)
```

### Method 3: Drag Selection
```
1. Calculate start position (left edge of text)
2. Calculate end position (right edge of text)
3. Drag from start to end
4. Type replacement text
```

## Error Handling

- **Field not found**: Capture new screenshot, re-analyze
- **Text not entered**: Click again, verify focus
- **Wrong field**: Tab back, re-navigate
- **Form validation error**: Read error message, correct input