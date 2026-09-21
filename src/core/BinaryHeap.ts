/** Min-heap of (item:int, priority:number) pairs stored in flat typed arrays. */
export class FlatBinaryHeap {
  private items: Int32Array;
  private prios: Float64Array;
  private n = 0;

  constructor(capacity = 1024) {
    this.items = new Int32Array(capacity);
    this.prios = new Float64Array(capacity);
  }

  size(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  enqueue(item: number, priority: number): void {
    if (this.n === this.items.length) this.grow();
    let i = this.n++;
    this.items[i] = item;
    this.prios[i] = priority;
    // sift up
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.prios[p] <= this.prios[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  peekPriority(): number {
    return this.prios[0];
  }

  peek(): number {
    return this.items[0];
  }

  dequeue(): number {
    const top = this.items[0];
    this.n--;
    if (this.n > 0) {
      this.items[0] = this.items[this.n];
      this.prios[0] = this.prios[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n && this.prios[l] < this.prios[m]) m = l;
        if (r < this.n && this.prios[r] < this.prios[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = ti;
    const tp = this.prios[a];
    this.prios[a] = this.prios[b];
    this.prios[b] = tp;
  }

  private grow(): void {
    const ni = new Int32Array(this.items.length * 2);
    ni.set(this.items);
    this.items = ni;
    const np = new Float64Array(this.prios.length * 2);
    np.set(this.prios);
    this.prios = np;
  }
}
