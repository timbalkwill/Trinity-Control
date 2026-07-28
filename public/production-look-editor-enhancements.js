(() => {
  const SUMMARY_ID = 'look-live-summary';

  function optionText(select) {
    if (!select) return 'Not assigned';
    const option = select.options?.[select.selectedIndex];
    const text = option?.textContent?.trim();
    return text || 'Not assigned';
  }

  function cameraLabel(role) {
    const field = document.querySelector(`[data-look-preset="${role}"]`);
    if (!field) return 'Not assigned';
    return optionText(field);
  }

  function priorityLabel() {
    return optionText(document.getElementById('look-priority'));
  }

  function makeItem(label, value) {
    const missing = !value || /not assigned|missing|no .* configured|no .* presets/i.test(value);
    return `<div class="look-live-summary-item ${missing ? 'is-missing' : ''}"><small>${label}</small><strong title="${escapeHtml(value || 'Not assigned')}">${escapeHtml(value || 'Not assigned')}</strong></div>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function updateSummary() {
    const form = document.querySelector('.simplified-look-form');
    if (!form) return;

    let summary = document.getElementById(SUMMARY_ID);
    if (!summary) {
      summary = document.createElement('section');
      summary.id = SUMMARY_ID;
      summary.className = 'look-live-summary';
      form.appendChild(summary);
    }

    const tracking = document.getElementById('look-main-tracking');
    const enabled = document.getElementById('look-enabled');
    summary.innerHTML = `
      <div class="look-live-summary-header">
        <strong>Look Summary</strong>
        <span>Updates as you change the form</span>
      </div>
      <div class="look-live-summary-grid">
        ${makeItem('Lighting', optionText(document.getElementById('look-lighting')))}
        ${makeItem('Main Camera', cameraLabel('main'))}
        ${makeItem('Left Camera', cameraLabel('left'))}
        ${makeItem('Right Camera', cameraLabel('right'))}
        ${makeItem('Starts Live', priorityLabel())}
        ${makeItem('Main Tracking', tracking?.checked ? 'On' : 'Off')}
      </div>
      ${enabled && !enabled.checked ? '<div class="look-warning" style="margin-top:12px">This Production Look is disabled.</div>' : ''}
    `;
  }

  function bindEditor() {
    const form = document.querySelector('.simplified-look-form');
    if (!form || form.dataset.enhancementsBound === 'true') return;
    form.dataset.enhancementsBound = 'true';
    form.addEventListener('input', updateSummary);
    form.addEventListener('change', updateSummary);
    updateSummary();
  }

  const observer = new MutationObserver(bindEditor);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', bindEditor);
  bindEditor();
})();
