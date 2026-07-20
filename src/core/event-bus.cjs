"use strict";

class EventBus {
  constructor({ onSubscriberError } = {}) {
    this.listeners = new Map();
    this.onSubscriberError = onSubscriberError;
  }

  subscribe(eventName, subscriber) {
    if (typeof eventName !== "string" || !eventName) {
      throw new TypeError("Event name must be a non-empty string");
    }
    if (typeof subscriber !== "function") {
      throw new TypeError("Subscriber must be a function");
    }

    const subscribers = this.listeners.get(eventName) || new Set();
    subscribers.add(subscriber);
    this.listeners.set(eventName, subscribers);

    return () => this.unsubscribe(eventName, subscriber);
  }

  unsubscribe(eventName, subscriber) {
    const subscribers = this.listeners.get(eventName);
    if (!subscribers) return false;

    const removed = subscribers.delete(subscriber);
    if (!subscribers.size) this.listeners.delete(eventName);
    return removed;
  }

  publish(eventName, payload) {
    const subscribers = [
      ...(this.listeners.get(eventName) || []),
      ...(eventName === "*" ? [] : (this.listeners.get("*") || []))
    ];
    const errors = [];

    for (const subscriber of subscribers) {
      try {
        const result = subscriber(payload, eventName);
        if (result && typeof result.catch === "function") {
          result.catch(error => {
            try {
              this.onSubscriberError?.({ eventName, error });
            } catch {
              // Subscriber error reporting must never interrupt publication.
            }
          });
        }
      } catch (error) {
        errors.push(error);
        try {
          this.onSubscriberError?.({ eventName, error });
        } catch {
          // Subscriber error reporting must never interrupt publication.
        }
      }
    }

    return { delivered: subscribers.length - errors.length, errors };
  }

  clear(eventName) {
    if (eventName === undefined) {
      this.listeners.clear();
      return;
    }
    this.listeners.delete(eventName);
  }
}

module.exports = { EventBus };
