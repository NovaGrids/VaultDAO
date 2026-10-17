/**
 * Helpers for the widget sandbox iframe.
 * Widget ids come from localStorage and the marketplace, so they are validated
 * and encoded before being placed inside the sandbox's inline script.
 */

export const WIDGET_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

export function isValidWidgetId(id: unknown): id is string {
  return typeof id === 'string' && WIDGET_ID_PATTERN.test(id);
}

/** Encode a widget id as a JS string literal that cannot close the surrounding <script> element. */
function encodeWidgetIdForScript(id: string): string {
  return JSON.stringify(id).replace(/</g, '\\u003c');
}

/**
 * Build the sandboxed document for a widget.
 * Throws if the id is not a valid widget id.
 */
export function buildWidgetSandboxHtml(widgetId: string): string {
  if (!isValidWidgetId(widgetId)) {
    throw new Error('Invalid widget id');
  }
  const idLiteral = encodeWidgetIdForScript(widgetId);

  return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              margin: 0;
              padding: 16px;
              font-family: 'Inter', system-ui, -apple-system, sans-serif;
              color: #E2E8F0;
              background: transparent;
              overflow-x: hidden;
            }
            * { box-sizing: border-box; }
            ::-webkit-scrollbar { width: 6px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: #4B5563; border-radius: 3px; }
          </style>
        </head>
        <body>
          <div id="root"></div>
          <script type="module">
            // This is where the third-party widget code would be loaded.
            // For the demo, we'll simulate a widget that uses the SDK.

            console.log("[Widget] Starting initialization...");

            // Simulating a mini-SDK for the widget context
            window.parent.postMessage({ type: 'init', widgetId: ${idLiteral}, payload: { ready: true } }, '*');

            const root = document.getElementById('root');
            root.innerHTML = \`
              <div style="background: rgba(31, 41, 55, 0.5); border: 1px solid rgba(75, 85, 99, 0.3); border-radius: 12px; padding: 20px; backdrop-filter: blur(8px);">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                  <div style="width: 10px; height: 10px; background: #8B5CF6; border-radius: 50%; box-shadow: 0 0 10px #8B5CF6;"></div>
                  <h3 style="margin: 0; font-size: 16px; font-weight: 600;">Widget API Demo</h3>
                </div>
                <p style="font-size: 13px; color: #9CA3AF; margin-bottom: 20px; line-height: 1.5;">
                  This widget is running in a secure sandbox. Click the button below to fetch proposals via the Vault SDK.
                </p>
                <div style="display: flex; flex-direction: column; gap: 10px;">
                  <button id="fetchBtn" style="background: #3B82F6; color: white; border: none; padding: 10px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; transition: background 0.2s;">
                    Fetch Proposals
                  </button>
                  <button id="toastBtn" style="background: rgba(255,255,255,0.05); color: #F3F4F6; border: 1px solid rgba(255,255,255,0.1); padding: 10px 16px; border-radius: 8px; font-size: 13px; cursor: pointer;">
                    Show Notification
                  </button>
                </div>
                <div id="output" style="margin-top: 20px; font-size: 12px; font-family: monospace; color: #10B981; max-height: 100px; overflow-y: auto;"></div>
              </div>
            \`;

            document.getElementById('fetchBtn').onclick = () => {
              const callId = Math.random().toString(36).substring(7);
              window.parent.postMessage({
                type: 'data',
                widgetId: ${idLiteral},
                payload: { action: 'getProposals' },
                callId
              }, '*');
            };

            document.getElementById('toastBtn').onclick = () => {
              window.parent.postMessage({
                type: 'action',
                widgetId: ${idLiteral},
                payload: { action: 'showToast', message: 'Hello from Widget Sandbox!', type: 'success' }
              }, '*');
            };

            window.addEventListener('message', (e) => {
              if (e.data.type === 'response') {
                const output = document.getElementById('output');
                output.innerText = 'Received ' + (e.data.payload.length || 0) + ' proposals';
              }
              if (e.data.type === 'event') {
                const output = document.getElementById('output');
                output.innerText = 'Event: ' + e.data.payload.eventType;
              }
            });
          </script>
        </body>
      </html>
    `;
}
