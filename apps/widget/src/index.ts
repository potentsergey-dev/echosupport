import { render, h } from 'preact';
import { Widget } from './widget';
import cssText from './globals.css?inline';

class EchoSupportWidgetElement extends HTMLElement {
  private _container: HTMLDivElement | null = null;

  connectedCallback() {
    if (this._container) return; // already mounted

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
