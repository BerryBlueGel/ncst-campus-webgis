/** Coalesce invalidations; keep drawing only while controls/flight still animate. */
export class DemandRenderLoop {
  private frame: number | null = null;
  private paused = false;
  private disposed = false;
  constructor(
    private render: (now: number) => boolean,
    private requestFrame: (callback: FrameRequestCallback) => number = callback => requestAnimationFrame(callback),
    private cancelFrame: (id: number) => void = id => cancelAnimationFrame(id),
  ) {}
  request = () => {
    if (this.frame !== null || this.paused || this.disposed) return;
    this.frame = this.requestFrame(now => {
      this.frame = null;
      if (this.paused || this.disposed) return;
      if (this.render(now)) this.request();
    });
  };
  pause() { this.paused = true; this.cancel(); }
  resume() { if (!this.disposed) { this.paused = false; this.request(); } }
  private cancel() { if (this.frame !== null) this.cancelFrame(this.frame); this.frame = null; }
  dispose() { this.disposed = true; this.cancel(); }
}
