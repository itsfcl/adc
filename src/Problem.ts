import { splitmix32 } from "./Random";

export const Fault = {
  OK: 0,
  NONFINITE: 1,
  VALUE: 2,
  HASH: 3,
  COUNT: 4,
  RANGE: 5,
  DOMAIN: 6,
  DUPLICATE: 7,
} as const;

const Z_SEED = 0x177013ff;

interface ProblemInterface {
  readonly vars: number;
  readonly sol: Int32Array;
  val: number;
  work: number;
  hash: number;
  readonly drift: number;
  readonly fault: number;
  readonly fatal: boolean;
  init(): void;
  domain(id: number): Int32Array;
  evaluate(sol: Int32Array): number;
  delta(id: number, v: number): number;
  mutate(id: number, v: number): void;
  load(src: Int32Array, value?: number): void;
  verify(): number;
  validate(s: Int32Array): number;
  pool?: Int32Array;
  group?: Int32Array;
  valueClass?(v: number): number;
  interacts?(id: number, j: number): number;
  solveGroup?(g: number): boolean;
}

abstract class Problem implements ProblemInterface {
    readonly sol: Int32Array;
    val = 0;
    work = 0;
    hash = 0;
    drift = 0;
    fault = 0;
    fatal = false;
    mutates = 0;
    lastId = -1;
    lastV = -1;
    stride = 0;
    pools = 0;
    dev = false;
    verifyEvery = 1024;
    pool?: Int32Array;

    protected zob = new Int32Array(0);
    protected isDom = new Uint8Array(0);
    protected cnt = new Uint8Array(0);
    protected chk = new Uint8Array(0);
    protected seen = new Uint32Array(0);
    protected poolIdx = new Int32Array(0);
    protected stamp = 0;

    private cId = -1;
    private cV = -1;
    private cVal = 0;

    constructor(
        readonly vars: number,
        protected readonly dom: Int32Array[],
    ) {
        this.sol = new Int32Array(vars);
    }

    abstract evaluate(sol: Int32Array): number;

    domain(id: number): Int32Array {
        return this.dom[id];
    }

    init(): void {
        const n = this.vars;
        let maxV = 0;
        for (let i = 0; i < n; i++) {
          const d = this.dom[i];
          for (let k = 0; k < d.length; k++) if (d[k] > maxV) maxV = d[k];
        }
        const S = maxV + 1;
        this.stride = S;

        const rnd = splitmix32(Z_SEED);
        this.zob = new Int32Array(n * S);
        for (let k = 0; k < this.zob.length; k++) this.zob[k] = rnd();

        this.isDom = new Uint8Array(n * S);
        for (let i = 0; i < n; i++) {
            const d = this.dom[i];
            for (let k = 0; k < d.length; k++) this.isDom[i * S + d[k]] = 1;
        }

        const pool = this.pool;
        if (pool) {
            let maxP = 0;
            for (let i = 0; i < n; i++) if (pool[i] > maxP) maxP = pool[i];
            this.pools = maxP + 1;
            this.poolIdx = pool as Int32Array<ArrayBuffer>;
            this.cnt = new Uint8Array(this.pools * S);
            this.chk = new Uint8Array(this.pools * S);
            this.seen = new Uint32Array(this.pools * S);
        } else {
            this.pools = 0;
            this.poolIdx = new Int32Array(0);
            this.cnt = new Uint8Array(0);
            this.chk = new Uint8Array(0);
            this.seen = new Uint32Array(0);
        }

        this.stamp = 0;
        this.val = 0;
        this.work = 0;
        this.drift = 0;
        this.fault = Fault.OK;
        this.fatal = false;
        this.mutates = 0;
        this.lastId = -1;
        this.lastV = -1;
        this.cId = -1;
        this.cV = -1;
        this.cVal = 0;
        this.sol.fill(0);
        this.rebuild();
    }

    private rebuild(): void {
        const n = this.vars;
        const S = this.stride;
        let h = 0;
        for (let i = 0; i < n; i++) h ^= this.zob[i * S + this.sol[i]];
        this.hash = h;
        if (this.pools > 0) {
            this.cnt.fill(0);
            for (let i = 0; i < n; i++) this.cnt[this.poolIdx[i] * S + this.sol[i]]++;
        }
    }

    private put(i: number, old: number, v: number): void {
        const S = this.stride;
        this.hash ^= this.zob[i * S + old] ^ this.zob[i * S + v];
        if (this.pools > 0) {
            const b = this.poolIdx[i] * S;
            this.cnt[b + old]--;
            this.cnt[b + v]++;
        }
    }

    delta(id: number, v: number): number {
        const sol = this.sol;
        const old = sol[id];
        sol[id] = v;
        const nv = this.evaluate(sol);
        sol[id] = old;
        this.work++;
        this.cId = id;
        this.cV = v;
        this.cVal = nv;
        const d = nv - this.val;
        if (this.dev && !Number.isFinite(d)) {
            throw new Error(`delta not finite at ${id}:${v}`);
        }
        return d;
    }

    mutate(id: number, v: number): void {
        const old = this.sol[id];
        if (old === v) return;
        if (this.dev && (v < 0 || v >= this.stride)) {
            throw new RangeError(`mutate value ${v} out of range at ${id}`);
        }
        this.sol[id] = v;
        this.put(id, old, v);
        if (this.cId === id && this.cV === v) {
            this.val = this.cVal;
        } else {
            this.val = this.evaluate(this.sol);
            this.work++;
        }
        this.cId = -1;
        this.lastId = id;
        this.lastV = v;
        this.mutates++;
        if (this.dev || this.mutates % this.verifyEvery === 0) this.verify();
    }

    load(src: Int32Array, value?: number): void {
        const n = this.vars;
        const sol = this.sol;
        for (let i = 0; i < n; i++) {
            const x = src[i];
            const old = sol[i];
            if (old !== x) {
                if (this.dev && (x < 0 || x >= this.stride)) {
                    throw new RangeError(`load value ${x} out of range at ${i}`);
                }
                sol[i] = x;
                this.put(i, old, x);
            }
        }
        if (value === undefined) {
            this.val = this.evaluate(sol);
            this.work++;
        } else {
            this.val = value;
        }
        this.cId = -1;
        this.lastId = -1;
        this.lastV = -1;
        if (this.dev) this.verify();
    }

    verify(): number {
        const n = this.vars;
        const S = this.stride;
        const sol = this.sol;
        const f = this.evaluate(sol);

        let h = 0;
        for (let i = 0; i < n; i++) h ^= this.zob[i * S + sol[i]];

        let countBad = false;
        if (this.pools > 0) {
            const chk = this.chk;
            const cnt = this.cnt;
            chk.fill(0);
            for (let i = 0; i < n; i++) chk[this.poolIdx[i] * S + sol[i]]++;
            for (let k = 0; k < chk.length; k++) {
                if (chk[k] !== cnt[k]) {
                  countBad = true;
                  break;
                }
            }
        }

        let code: number = Fault.OK;
        if (!Number.isFinite(f)) code = Fault.NONFINITE;
        else if (f !== this.val) code = Fault.VALUE;
        else if (h !== this.hash) code = Fault.HASH;
        else if (countBad) code = Fault.COUNT;

        if (code === Fault.OK) return code;

        this.drift++;
        this.fault = code;
        if (this.dev) {
            throw new Error(
                `verify failed: code ${code}, val ${this.val}, fresh ${f}, last move ${this.lastId}:${this.lastV}`,
            );
        }
        if (code === Fault.NONFINITE) {
            this.fatal = true;
        } else {
            this.val = f;
            this.hash = h;
            this.cnt.set(this.chk);
        }
        return code;
    }

    validate(s: Int32Array): number {
        const n = this.vars;
        const S = this.stride;
        if (++this.stamp >= 0xffffffff) {
            this.seen.fill(0);
            this.stamp = 1;
        }
        for (let i = 0; i < n; i++) {
            const x = s[i];
            if (x < 0 || x >= S) return Fault.RANGE;
            if (this.isDom[i * S + x] === 0) return Fault.DOMAIN;
            if (this.pools > 0) {
                const k = this.poolIdx[i] * S + x;
                if (this.seen[k] === this.stamp) return Fault.DUPLICATE;
                this.seen[k] = this.stamp;
            }
        }
        return Fault.OK;
    }
}