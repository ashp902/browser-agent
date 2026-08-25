// Side-panel backend client (docs/01 §2.1, docs/05 §3).
//
// The panel owns the live WebSocket to the backend while a task runs. It never
// holds provider credentials and never talks to the page directly: observations
// and actions flow through the extension message router.

import type { ActionResult } from '../shared/action-protocol';
import type { ObservationData } from '../shared/semantic-contracts';
import {
  buildActionResultFrame,
  buildCancelTaskFrame,
  buildClientErrorFrame,
  buildConfirmationResponseFrame,
  buildManualActionCompletedFrame,
  buildObservationFrame,
  buildStartTaskFrame,
  parseServerFrame,
  type ServerEvent,
} from '../shared/wire-protocol';

export const DEFAULT_BACKEND_WS_URL = 'ws://localhost:8000/v1/agent/ws';

export class BackendConnectionClosed extends Error {}

export class BackendClient {
  private ws: WebSocket | null = null;
  private taskId: string | null = null;
  private eventListener: ((event: ServerEvent) => void) | null = null;
  private closeListener: (() => void) | null = null;

  get activeTaskId(): string | null {
    return this.taskId;
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  onServerEvent(listener: (event: ServerEvent) => void): void {
    this.eventListener = listener;
  }

  onClose(listener: () => void): void {
    this.closeListener = listener;
  }

  connect(url: string = DEFAULT_BACKEND_WS_URL): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws !== null) {
        resolve();
        return;
      }
      let settled = false;
      const ws = new WebSocket(url);
      ws.onopen = () => {
        settled = true;
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => {
        if (!settled) reject(new Error(`Could not reach the backend at ${url}.`));
      };
      ws.onclose = () => {
        this.ws = null;
        this.taskId = null;
        if (!settled) reject(new Error('Backend connection closed before opening.'));
        this.closeListener?.();
      };
      ws.onmessage = (message) => {
        try {
          const event = parseServerFrame(message.data as string);
          if (event.type === 'task_created') {
            this.taskId = event.payload.task_id;
          }
          this.eventListener?.(event);
        } catch (error) {
          // Malformed server frames are surfaced through the close path.
          console.error('Malformed backend frame', error);
          ws.close();
        }
      };
    });
  }

  startTask(goal: string, extensionVersion: string): void {
    this.send(buildStartTaskFrame(goal, { extension_version: extensionVersion }));
  }

  sendObservation(observation: ObservationData): void {
    if (this.taskId === null) throw new BackendConnectionClosed('No active task.');
    this.send(buildObservationFrame(this.taskId, observation));
  }

  sendActionResult(result: ActionResult): void {
    if (this.taskId === null) throw new BackendConnectionClosed('No active task.');
    this.send(buildActionResultFrame(this.taskId, result));
  }

  respondConfirmation(confirmationId: string, decision: 'approve' | 'deny'): void {
    if (this.taskId === null) throw new BackendConnectionClosed('No active task.');
    this.send(buildConfirmationResponseFrame(this.taskId, confirmationId, decision));
  }

  resumeManual(): void {
    if (this.taskId === null) throw new BackendConnectionClosed('No active task.');
    this.send(buildManualActionCompletedFrame(this.taskId));
  }

  cancelTask(): void {
    if (this.taskId !== null) {
      this.send(buildCancelTaskFrame(this.taskId));
    }
  }

  reportClientError(code: string, message: string): void {
    if (this.isConnected) this.send(buildClientErrorFrame(code, message));
  }

  disconnect(): void {
    const ws = this.ws;
    this.ws = null;
    this.taskId = null;
    ws?.close();
  }

  private send(frame: string): void {
    if (!this.isConnected || this.ws === null) {
      throw new BackendConnectionClosed('Backend connection is not open.');
    }
    this.ws.send(frame);
  }
}
