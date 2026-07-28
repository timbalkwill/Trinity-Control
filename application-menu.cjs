"use strict";

function navigationItem(label, page, accelerator, navigate) {
  return {
    label,
    accelerator,
    click: () => navigate(page)
  };
}

function createApplicationMenuTemplate({
  isMac = process.platform === "darwin",
  isDevelopment = false,
  navigate = () => {},
  showAbout = () => {},
  showKeyboardShortcuts = () => {},
  showSystemStatus = () => {},
  closeWindow = () => {}
} = {}) {
  const appMenu = {
    label: "Trinity Control",
    submenu: [
      { label: "About Trinity Control", click: showAbout },
      { type: "separator" },
      navigationItem("Settings…", "settings", "CmdOrCtrl+,", navigate),
      ...(isMac ? [
        { type: "separator" },
        { role: "hide", label: "Hide Trinity Control" },
        { role: "hideOthers" },
        { role: "unhide", label: "Show All" },
        { type: "separator" },
        { role: "quit", label: "Quit Trinity Control" }
      ] : [])
    ]
  };
  const fileMenu = {
    label: "File",
    submenu: [
      { label: "Close Window", accelerator: "CmdOrCtrl+W", click: closeWindow }
    ]
  };
  const editMenu = {
    label: "Edit",
    submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }
    ]
  };
  const viewMenu = {
    label: "View",
    submenu: [
      navigationItem("Live", "live", "CmdOrCtrl+1", navigate),
      navigationItem("Service", "service", "CmdOrCtrl+2", navigate),
      navigationItem("Production Looks", "looks", "CmdOrCtrl+3", navigate),
      navigationItem("Camera Library", "cameras", "CmdOrCtrl+4", navigate),
      navigationItem("Lighting Library", "lighting", "CmdOrCtrl+5", navigate),
      navigationItem("Shot Library", "shots", null, navigate),
      navigationItem("Settings", "settings", null, navigate),
      { type: "separator" },
      { role: "resetZoom", label: "Actual Size" },
      { role: "zoomIn", label: "Zoom In" },
      { role: "zoomOut", label: "Zoom Out" },
      { role: "togglefullscreen", label: "Toggle Full Screen" },
      ...(isDevelopment ? [
        { type: "separator" },
        { role: "reload", label: "Reload" },
        { role: "toggleDevTools", label: "Toggle Developer Tools" }
      ] : [])
    ]
  };
  const windowMenu = {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      ...(isMac ? [{ type: "separator" }, { role: "front", label: "Bring All to Front" }] : [])
    ]
  };
  const helpMenu = {
    label: "Help",
    submenu: [
      { label: "Keyboard Shortcuts", click: showKeyboardShortcuts },
      { label: "System Status", click: showSystemStatus },
      { type: "separator" },
      { label: "About Trinity Control", click: showAbout }
    ]
  };
  return isMac
    ? [appMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu]
    : [fileMenu, editMenu, viewMenu, windowMenu, helpMenu];
}

module.exports = { createApplicationMenuTemplate };
