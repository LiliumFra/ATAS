import { WebSocket } from 'ws';

type SocketState = { socket: WebSocket; alive: boolean };

export class RealtimeHub {
  private readonly sockets = new Map<string, Set<SocketState>>();
  private heartbeatTimer: NodeJS.Timeout | undefined;

  public start(): void {
    if (this.heartbeatTimer !== undefined) return;
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 15_000);
    this.heartbeatTimer.unref();
  }

  public stop(): void {
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    for (const group of this.sockets.values()) {
      for (const state of group) state.socket.terminate();
    }
    this.sockets.clear();
  }

  public subscribe(matchId: string, socket: WebSocket): () => void {
    const group = this.sockets.get(matchId) ?? new Set<SocketState>();
    const state: SocketState = { socket, alive: true };
    const onPong = () => {
      state.alive = true;
    };
    socket.on('pong', onPong);
    group.add(state);
    this.sockets.set(matchId, group);

    return () => {
      socket.off('pong', onPong);
      group.delete(state);
      if (group.size === 0) this.sockets.delete(matchId);
    };
  }

  public publish(matchId: string, message: Record<string, unknown>): void {
    const group = this.sockets.get(matchId);
    if (group === undefined) return;

    const encoded = JSON.stringify(message);
    for (const state of group) {
      const socket = state.socket;
      if (socket.readyState !== WebSocket.OPEN) {
        group.delete(state);
        continue;
      }
      try {
        socket.send(encoded);
      } catch {
        group.delete(state);
        socket.terminate();
      }
    }
    if (group.size === 0) this.sockets.delete(matchId);
  }

  public connectionCount(matchId?: string): number {
    if (matchId !== undefined) return this.sockets.get(matchId)?.size ?? 0;
    return [...this.sockets.values()].reduce((total, group) => total + group.size, 0);
  }

  private heartbeat(): void {
    for (const [matchId, group] of this.sockets) {
      for (const state of group) {
        if (!state.alive || state.socket.readyState !== WebSocket.OPEN) {
          group.delete(state);
          state.socket.terminate();
          continue;
        }
        state.alive = false;
        try {
          state.socket.ping();
        } catch {
          group.delete(state);
          state.socket.terminate();
        }
      }
      if (group.size === 0) this.sockets.delete(matchId);
    }
  }
}
