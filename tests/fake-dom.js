// Minimal fake DOM used by the tests to load the real content.js / popup.js
// in Node. It implements only the DOM surface those files use:
// createElement, classList, querySelector(All), appendChild/remove,
// addEventListener, attachShadow, getBoundingClientRect, focus, click.
'use strict';

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
}

function matches(el, sel) {
  if (!el || !el.tagName) return false;
  if (sel.startsWith('.')) {
    return sel.slice(1).split('.').every((c) => el.classList.contains(c));
  }
  return el.tagName.toLowerCase() === sel.toLowerCase();
}

function queryAll(root, selector) {
  const parts = selector.trim().split(/\s+/);
  let current = [root];
  for (const part of parts) {
    const next = [];
    for (const node of current) {
      const walk = (n) => {
        for (const ch of n.children || []) {
          if (matches(ch, part)) next.push(ch);
          walk(ch);
        }
      };
      walk(node);
    }
    current = next;
  }
  return current;
}

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.classList = new ClassList();
    this.style = {};
    this._text = '';
    this.listeners = {};
    this.value = '';
    this.type = '';
    this.placeholder = '';
    this.offsetHeight = 100;
    this._shadow = null;
  }
  get textContent() {
    let t = this._text;
    for (const ch of this.children) t += ch.textContent;
    return t;
  }
  set textContent(v) { this.children = []; this._text = v; }
  appendChild(ch) { ch.parent = this; this.children.push(ch); return ch; }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
  dispatch(type, ev = {}) {
    ev.target = this;
    ev.currentTarget = this;
    ev.stopPropagation = () => {};
    ev.preventDefault = () => {};
    ev.stopImmediatePropagation = () => {};
    (this.listeners[type] || []).forEach((f) => f(ev));
  }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  attachShadow() {
    const s = new El('#shadow');
    s.host = this;
    s.activeElement = null;
    this._shadow = s;
    return s;
  }
  getBoundingClientRect() { return { width: 380, height: 300, left: 0, top: 0 }; }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k] || null; }
  removeAttribute(k) { delete this[k]; }
  focus() {
    // Find the enclosing shadow root by walking up to the host element.
    let node = this;
    while (node) {
      if (node._shadow) { node._shadow.activeElement = this; return; }
      if (node.tagName === '#SHADOW') { node.activeElement = this; return; }
      node = node.parent;
    }
  }
  click() { this.dispatch('click', {}); }
}

module.exports = { El, queryAll };
