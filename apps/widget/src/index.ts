import { render, h } from 'preact';
import { Widget } from './widget';
import { languageOverride } from './signals';
import cssText from './globals.css?inline';

class EchoSupportWidgetElement extends HTMLElement {
  private _container: HTMLDivElement | null = null;

  static get observedAttributes() {
    return ['language'];
  }

  attributeChangedCallback(name: string, _oldValue: string | null, value: string | null) {
    if (name === 'language') {
      languageOverride.value = value === 'ru' || value === 'en' ? value : null;
    }
  }

  connectedCallback() {
    if (this._container) return; // already mounted

    const language = this.getAttribute('language');
    languageOverride.value = language === 'ru' || language === 'en' ? language : null;
    const shadow = this.attachShadow({ mode: 'open' });

    // Inject Tailwind CSS into Shadow DOM
    const style = document.createElement('style');
    style.textContent = cssText;
    shadow.appendChild(style);

    this._container = document.createElement('div');
    shadow.appendChild(this._container);

    const apiBase = this.getAttribute('api-base') ?? '';
    const agentKey = this.getAttribute('agent-key') ?? '';

    render(h(Widget, { apiBase, agentKey }), this._container);
  }

  disconnectedCallback() {
    if (this._container) {
      render(null, this._container);
      this._container = null;
    }
  }
}

if (!customElements.get('echo-support-widget')) {
  customElements.define('echo-support-widget', EchoSupportWidgetElement);
}
