const fs = require('node:fs');
const path = require('node:path');

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeEntities(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,]+/);
  return [...new Set(source.map(item => String(item).trim()).filter(Boolean))];
}

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveConfig({ app, projectDirectory = __dirname, env = process.env } = {}) {
  const userConfigPath = app?.getPath
    ? path.join(app.getPath('userData'), 'home-assistant.config.json')
    : null;
  const projectConfigPath = path.join(projectDirectory, 'home-assistant.config.json');
  const fileConfig = (userConfigPath && loadJson(userConfigPath)) || loadJson(projectConfigPath) || {};

  const baseUrl = normalizeBaseUrl(env.TRINITY_HA_URL || fileConfig.baseUrl);
  const token = String(env.TRINITY_HA_TOKEN || fileConfig.token || '').trim();
  const entities = normalizeEntities(env.TRINITY_HA_LIGHTING_ENTITIES || fileConfig.entities);

  return {
    baseUrl,
    token,
    entities,
    configured: Boolean(baseUrl && token && entities.length),
    configPath: userConfigPath || projectConfigPath
  };
}

function createHomeAssistantController({ app, projectDirectory = __dirname, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');

  const config = () => resolveConfig({ app, projectDirectory, env });

  function getConfiguration() {
    const current = config();
    return {
      baseUrl: current.baseUrl,
      entities: current.entities,
      tokenConfigured: Boolean(current.token),
      configured: current.configured,
      configPath: current.configPath
    };
  }

  function saveConfiguration(patch = {}) {
    const current = config();
    const next = {
      baseUrl: patch.baseUrl === undefined ? current.baseUrl : normalizeBaseUrl(patch.baseUrl),
      token: String(patch.token || current.token || '').trim(),
      entities: patch.entities === undefined ? current.entities : normalizeEntities(patch.entities)
    };
    const temporaryPath = `${current.configPath}.tmp-${process.pid}-${Date.now()}`;
    fs.mkdirSync(path.dirname(current.configPath), { recursive: true });
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPath, current.configPath);
    } catch (error) {
      try { fs.unlinkSync(temporaryPath); } catch { /* Nothing to clean up. */ }
      throw error;
    }
    return getConfiguration();
  }

  async function request(endpoint, options = {}) {
    const current = config();
    if (!current.configured) {
      const error = new Error('Home Assistant is not configured.');
      error.code = 'HA_NOT_CONFIGURED';
      throw error;
    }

    const response = await fetchImpl(`${current.baseUrl}/api${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${current.token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = new Error(`Home Assistant request failed (${response.status})${body ? `: ${body}` : ''}`);
      error.code = 'HA_REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }

    const contentType = response.headers?.get?.('content-type') || '';
    return contentType.includes('application/json') ? response.json() : null;
  }

  async function getStatus() {
    const current = config();
    if (!current.configured) {
      return {
        configured: false,
        reachable: false,
        entities: current.entities,
        configPath: current.configPath,
        message: 'Add your Home Assistant URL, token, and lighting entities.'
      };
    }

    try {
      const states = await Promise.all(current.entities.map(async entityId => {
        const result = await request(`/states/${encodeURIComponent(entityId)}`);
        return { entityId, state: result?.state || 'unknown', friendlyName: result?.attributes?.friendly_name || entityId };
      }));
      return {
        configured: true,
        reachable: true,
        entities: states,
        configPath: current.configPath,
        allOn: states.length > 0 && states.every(item => item.state === 'on'),
        anyOn: states.some(item => item.state === 'on'),
        message: 'Connected to Home Assistant.'
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        entities: current.entities.map(entityId => ({ entityId, state: 'unavailable', friendlyName: entityId })),
        configPath: current.configPath,
        message: error.message
      };
    }
  }

  async function setPower(on) {
    const current = config();
    if (!current.configured) {
      const error = new Error('Home Assistant is not configured.');
      error.code = 'HA_NOT_CONFIGURED';
      throw error;
    }

    await request(`/services/switch/turn_${on ? 'on' : 'off'}`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: current.entities })
    });

    return getStatus();
  }

  return {
    getConfiguration,
    getStatus,
    saveConfiguration,
    turnOn: () => setPower(true),
    turnOff: () => setPower(false)
  };
}

module.exports = {
  createHomeAssistantController,
  normalizeBaseUrl,
  normalizeEntities,
  resolveConfig
};
