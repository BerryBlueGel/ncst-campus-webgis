import { cameraQuery } from './MapConfig';
import type { CameraState } from '../../types/gis';

const keys = ['lng', 'lat', 'zoom', 'pitch', 'bearing'] as const;
type Query = Record<string, unknown>;
function signature(query: Query) {
  return JSON.stringify(keys.map(key => query[key]));
}

/** The URL is a snapshot of a settled camera, never a feedback source for our own writes. */
export class CameraUrlSync {
  private timer?: ReturnType<typeof setTimeout>;
  private pending = new Set<string>();
  private disposed = false;
  constructor(
    private read: () => CameraState,
    private moving: () => boolean,
    private write: (query: Record<string, string>) => Promise<unknown>,
  ) {}
  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  schedule() {
    this.cancel();
    if (this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.disposed || this.moving()) return;
      // Read now, not the old moveend state captured before a subsequent gesture.
      const query = cameraQuery(this.read());
      const key = signature(query);
      this.pending.add(key);
      void this.write(query).finally(() => this.pending.delete(key));
    }, 300);
  }
  owns(query: Query) { return this.pending.has(signature(query)); }
  dispose() { this.disposed = true; this.cancel(); this.pending.clear(); }
}
