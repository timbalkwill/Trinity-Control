const clone = value => JSON.parse(JSON.stringify(value));

class StateStore {
  constructor(initialState) {
    if (!initialState || typeof initialState !== "object") {
      throw new TypeError("StateStore requires an initial state");
    }

    this.revision = Number.isSafeInteger(initialState.revision)
      ? initialState.revision
      : 0;
    this.snapshot = clone(initialState);
    this.snapshot.revision = this.revision;
  }

  getRevision() {
    return this.revision;
  }

  getSnapshot() {
    return clone(this.snapshot);
  }

  commit(nextState) {
    if (!nextState || typeof nextState !== "object") {
      throw new TypeError("Committed state must be an object");
    }

    this.revision += 1;
    this.snapshot = clone(nextState);
    this.snapshot.revision = this.revision;
    return this.getSnapshot();
  }
}

module.exports = { StateStore };
