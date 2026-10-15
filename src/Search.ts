import {ProblemInterface} from "./Problem";
import { splitmix32 } from "./Random";

export interface Destroy {
    select(k: number, out: Int32Array): number;
}

export interface Repair {
    fill(free: Int32Array, n: number): boolean;
}

export type Accept = (candidateVal: number, currentVal: number) => boolean;

export type OperatorFactory = (
    p: ProblemInterface,
    rng: ()=>number,
) => { destroy: Destroy; repair: Repair };

export interface SolveOptions {
    operators: OperatorFactory;
    budget?: number;
    tail?: number;
    seeds?: Int32Array[];
    kMin?: number;
    kMax?: number;
    sampleSize?: number;
    accept?: Accept;
    rngSeed?: number;
    dev?: boolean;
}

export interface SolveResult {
    sol: Int32Array;
    score: number;
    iter: number;
    accepted: number;
    improved: number;
    rejected: number;
    noops: number;
    aborted: number;
    errors: number;
    drift: number;
    work: number;
    failed: boolean;
}

const notWorse: Accept = (candidateVal, currentVal) => candidateVal >= currentVal;

export class Engine {
    protected p!: ProblemInterface;
    protected o!: Required<SolveOptions>;
    protected rng!: () => number;
    protected destroy!: Destroy;
    protected repair!: Repair;

    protected deadline = 0;

    protected snapSol = new Int32Array(0);
    protected snapVal = 0;
    protected snapHash = 0;
    protected snapWork = 0;

    protected best = new Int32Array(0);
    protected bestVal = -Infinity;

    protected free = new Int32Array(0);
    protected nFree = 0;
    protected k = 0;
    protected ok = false;

    protected iter = 0;
    protected accepted = 0;
    protected improved = 0;
    protected rejected = 0;
    protected noops = 0;
    protected aborted = 0;
    protected errors = 0;
    protected failed = false;

    solve(
        p: ProblemInterface,
        {
            budget = 20_000,
            tail = 10,
            seeds = [],
            kMin = 2,
            kMax = 5,
            sampleSize = 0,
            accept = notWorse,
            rngSeed = 1,
            dev = false,
            operators,
        }: SolveOptions,
    ): SolveResult {
        this.init(p, { budget, tail, seeds, kMin, kMax, sampleSize, accept, rngSeed, dev, operators });
        this.start();
        this.run();
        this.finish();
        return this.result();
    }

    private init(p: ProblemInterface, o: Required<SolveOptions>): void {
        const t0 = performance.now();
        const n = p.vars;

        this.p = p;
        this.o = o;
        p.init();

        this.rng = splitmix32(o.rngSeed);
        const ops = o.operators(p, this.rng);
        this.destroy = ops.destroy;
        this.repair = ops.repair;

        this.snapSol = new Int32Array(n);
        this.best = new Int32Array(n);
        this.free = new Int32Array(n);

        this.snapVal = 0;
        this.snapHash = 0;
        this.snapWork = 0;
        this.bestVal = -Infinity;
        this.nFree = 0;
        this.k = 0;
        this.ok = false;

        this.iter = 0;
        this.accepted = 0;
        this.improved = 0;
        this.rejected = 0;
        this.noops = 0;
        this.aborted = 0;
        this.errors = 0;
        this.failed = false;

        this.deadline = t0 + o.budget - o.tail;
    }

    // todo : validate seed, warm start, first iter
    protected start(): void {}

    // todo : iter
    protected run(): void {}

    // todo : reeval
    protected finish(): void {}

    protected result(): SolveResult {
        return {
            sol: this.best.slice(),
            score: this.bestVal,
            iter: this.iter,
            accepted: this.accepted,
            improved: this.improved,
            rejected: this.rejected,
            noops: this.noops,
            aborted: this.aborted,
            errors: this.errors,
            drift: this.p.drift,
            work: this.p.work,
            failed: this.failed,
        };
    }
}