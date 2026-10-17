export interface GesturePointer {
  pointerId: number;
  clientX: number;
  clientY: number;
  button?: number;
}

/** A click must stay within tolerance for its ENTIRE path, with exactly one pointer.
 * Pinch, right-button navigation, cancellation and a drag back to its start are not clicks.
 */
export class NavigationGesture {
  private pointers = new Map<number, {x: number; y: number}>();
  private blocked = false;
  constructor(private threshold = 5) {}
  get active() { return this.pointers.size > 0; }
  begin(event: GesturePointer) {
    if (!this.active) this.blocked = (event.button ?? 0) !== 0;
    else this.blocked = true;
    this.pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
  }
  move(event: GesturePointer) {
    const start = this.pointers.get(event.pointerId);
    if (start && Math.hypot(event.clientX-start.x, event.clientY-start.y) > this.threshold) this.blocked = true;
  }
  end(event: GesturePointer): boolean {
    this.move(event);
    const click = this.pointers.has(event.pointerId) && this.pointers.size === 1 && !this.blocked;
    this.pointers.delete(event.pointerId);
    return click;
  }
  cancel() { this.pointers.clear(); this.blocked = true; }
}
