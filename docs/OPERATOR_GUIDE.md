# Enhanced Order of Service operator guide

## Editing cues

Open **SERVICE** and use **EDIT** to change a cue’s name, duration, notes, Production Look, lighting override, or camera override. Saving applies immediately. **COPY** duplicates a cue, including its cue-specific lighting and camera choices. **+↑** and **+↓** insert a new editable cue above or below the selected cue.

The final cue cannot be deleted. Deleting the current cue asks for confirmation, then selects the nearest remaining cue. Jumping more than two cues from the current position also asks for confirmation.

## Drag-and-drop

Drag the handle at the left of a cue with a mouse, or press and drag it with a finger. The blue line shows the drop position. The current cue remains current by its ID after the list moves, and the new order saves immediately.

## Keyboard shortcuts

- **Space** or **Enter** — GO to the next cue
- **Right Arrow** — NEXT
- **Left Arrow** — BACK
- **H** — HOLD or release HOLD
- **Escape** — close the cue editor

Shortcuts are disabled while typing or editing a cue.

## Compact Operator Mode

Open the Browser Operator address shown by Trinity Control on an iPad. Landscape orientation provides the most compact arrangement. It shows CURRENT and NEXT details, a large GO button, BACK/NEXT/HOLD controls, active lighting and camera, connection state, timing, and a scrollable service list.

## Timing indicators

Service elapsed time begins from the saved service-start timestamp. Cue elapsed time resets only when a cue executes. Estimated remaining time combines the unelapsed portion of the current cue with the configured durations of later cues. These are display-only estimates and never trigger cue execution.

## Production Looks 2.0

Open **LOOKS** to search, create, duplicate, enable, disable, edit, or delete Production Looks. Changes save immediately through Trinity’s main process. A Look can describe general metadata, lighting, program/preview video, logical camera preset assignments, motion intent, and future audio or presentation references.

The summary strip shows the selected Look’s lighting, program and preview cameras, preset assignments, motion status, and enabled state. Cue details label inherited values as **From Production Look**, cue-specific selections as **Cue Override**, and empty values as **Not assigned**.

The Live page shows what was actually executed. Editing a Look or assigning it to a cue does not execute it. If the active cue's Look is edited, Live continues to show the earlier executed values until that cue runs again. Missing saved resources appear as **Missing reference** warnings.

Deleting a Look referenced by service cues requires confirmation and does not silently change those cues. Duplicate Looks receive a new identity and can be edited independently.

## Administrator Settings

Select **⚙ SETTINGS** to leave the live production pages and enter the clearly marked administrator area. **Devices** lists all configured and placeholder devices. Use its filters to focus on a type or enabled state. **Cameras** emphasizes the Main, Left, and Right camera roles while supporting additional cameras and custom role names.

Device and camera changes save immediately. Camera credentials remain behind the Electron preload boundary and are never sent to Browser Operator. Duplicate enabled logical roles display a warning but do not alter references.

**Diagnostics** performs configuration-only stub tests. Results such as **Not configured**, **Disabled**, **Adapter not implemented**, and **Ready for future test** are honest readiness states—not hardware connection results.

## Camera Manager

Open **CAMERAS** for the operational Camera Manager. Main, Left, and Right appear first when configured, with additional cameras afterward. Select a camera to inspect readiness, known program/preview state, current preset, diagnostics, capabilities, and presets.

Use search and category filters to find presets. The star marks favorites. Create, edit, duplicate, reorder, disable, or delete presets from the selected camera. Referenced deletion asks for confirmation and leaves a visible missing reference for later repair.

Preset category suggestions include Pastor, Platform, Piano, Choir, Baptistry, Congregation, Wide, and Utility. Custom categories remain available and automatically appear in the filter list. Utility is only the display/filter fallback for an uncategorized preset.

Capability choices are manual until hardware adapters exist: **Supported**, **Not supported**, **Unknown**, or **Adapter required**. Future control buttons are intentionally disabled. Use **Settings → Cameras** to edit connection details, credentials, model, enable state, or logical role.
