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

## Simplified Production Looks

Open **LOOKS** to search, create, duplicate, enable, disable, edit, or delete Production Looks. A Look answers one question: **How should this cue begin?**

Choose a lighting scene, optional Main/Left/Right starting presets, a priority camera, and whether Main tracking should start. Press **SAVE LOOK** to persist the complete edit through Trinity’s serialized main-process command. **CANCEL** discards unsaved form changes. Preset lists show only presets for the camera currently assigned to that role; missing saved references remain visible for repair.

When the cue runs, valid presets are prepared in Static mode, the priority camera becomes live, and Main tracking is explicitly started or stopped. This is deterministic application state only—no camera, switcher, lighting, or tracking hardware command is sent. Afterward, the Live page remains fully manual: prepare another camera, choose Motion, use Make Live, change tracking, or select favorite lighting.

The Live page shows what was actually executed. Editing a Look or any referenced library does not alter the frozen execution summary; run the cue again to apply edits. Missing or disabled resources produce readable warnings rather than crashes.

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

## Shot Library

Open **SHOTS** to manage reusable framing such as Pastor Tight, Piano, Choir Wide, or Baptistry. Search or filter by category, camera/role, favorite, and enabled state. Create, edit, favorite, duplicate, enable/disable, reorder, or delete Shots; changes save immediately.

A Shot can target a specific camera or fall back to a logical role, then optionally reference a preset on that camera. Readiness warnings identify missing or disabled cameras/presets, mismatches, or incomplete configuration without claiming a hardware connection.

Shots remain available to the Live page’s **Motion** selector. Production Looks no longer select Shots, PROGRAM, PREVIEW, or AUXILIARY.

Deleting a referenced Shot requires confirmation and leaves the reference visible for repair. Camera and preset deletion counts Shot references and likewise preserves the Shot.
## Simplified Live camera workflow

The desktop Live page keeps the cue list, three camera cards, GO/BACK, and favorite lighting controls visible together.

For each camera:

1. Choose **Static** for a saved preset or **Motion** for a Shot assigned to that camera.
2. Choose the preset or motion from the camera-specific list. Preparing an off-air camera does not affect PROGRAM.
3. Press **Make Live** to put that camera on air. A static choice remains still. A prepared motion begins once when the camera becomes live and completes without automatically switching cameras or returning to its start.
4. On tracking-capable cameras, use **Start Tracking** and **Stop Tracking**. Tracking remains active when the camera moves on or off air. While tracking is active, preparation controls are disabled, but Make Live remains available.

Preparation and tracking survive page navigation and normal application restart. GO and BACK continue using the shared cue executor. Cue execution does not clear tracking or prevent subsequent manual camera preparation.

The current motion simulation uses the Shot's linked camera preset as a starting point when one exists. Shots do not yet define a distinct ending preset or physical motion path, and Trinity does not send PTZ or switcher commands in this workflow.
