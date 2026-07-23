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

Deleting a Look referenced by service cues requires confirmation and does not silently change those cues. Duplicate Looks receive a new identity and can be edited independently.
