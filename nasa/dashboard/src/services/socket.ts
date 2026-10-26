import { io, Socket } from 'socket.io-client';
import { ApiService } from './api';

export type SocketEventHandler = (payload: any) => void;

export class SocketService {
  private static socket: Socket | null = null;
  private static listeners = new Map<string, Set<SocketEventHandler>>();
  private static isConnected = false;
  private static reconnectHandlers = new Set<() => void>();

  public static connect(): void {
    const token = ApiService.getToken();
    if (!token) return;

    if (this.socket) {
      if (this.socket.connected) return;
      this.socket.disconnect();
    }

    // Connect to /live namespace on backend URL
    const WS_URL = import.meta.env.VITE_WS_URL || 'https://aj-nasa-astrocare.onrender.com';
    this.socket = io(WS_URL, {
      path: '/live',
      transports: ['websocket', 'polling'],
      auth: { token },
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      this.isConnected = true;
      this.emitInternal('connection:change', true);
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      this.emitInternal('connection:change', false);
    });

    this.socket.on('hello', (data: any) => {
      this.emitInternal('hello', data);
    });

    this.socket.on('event', (envelope: any) => {
      // Dispatches topic-level, type-level, and wildcard listeners
      this.emitInternal('*', envelope);
      if (envelope?.topic) {
        this.emitInternal(`topic:${envelope.topic}`, envelope);
      }
      if (envelope?.type) {
        this.emitInternal(`type:${envelope.type}`, envelope);
      }
    });

    // Replay on reconnect: when reconnected after disconnection
    this.socket.io.on('reconnect', () => {
      this.reconnectHandlers.forEach((handler) => handler());
      // Request replay of recent outbox/telemetry
      if (this.socket) {
        this.socket.emit('replay', { since_seq: 0 });
      }
    });

    this.socket.on('connect_error', (err: any) => {
      if (err?.message?.includes('jwt') || err?.message?.includes('token')) {
        ApiService.clearSession();
        window.dispatchEvent(new Event('astrocare:auth-expired'));
      }
    });
  }

  public static disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
    this.emitInternal('connection:change', false);
  }

  public static getConnected(): boolean {
    return this.isConnected;
  }

  public static on(eventPattern: string, handler: SocketEventHandler): () => void {
    let set = this.listeners.get(eventPattern);
    if (!set) {
      set = new Set();
      this.listeners.set(eventPattern, set);
    }
    set.add(handler);

    return () => {
      const s = this.listeners.get(eventPattern);
      if (s) {
        s.delete(handler);
        if (s.size === 0) {
          this.listeners.delete(eventPattern);
        }
      }
    };
  }

  public static onReconnect(handler: () => void): () => void {
    this.reconnectHandlers.add(handler);
    return () => {
      this.reconnectHandlers.delete(handler);
    };
  }

  private static emitInternal(eventPattern: string, data: any): void {
    const set = this.listeners.get(eventPattern);
    if (set) {
      set.forEach((fn) => {
        try {
          fn(data);
        } catch (err) {
          console.error(`Error in socket listener [${eventPattern}]:`, err);
        }
      });
    }
  }
}
