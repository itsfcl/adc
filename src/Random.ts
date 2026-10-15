export function splitmix32(seed: number) {
    let state = seed | 0;
    return function() {
        state = (state + 0x9E3779B9) | 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 16), 0x21F0AAAD);
        t = Math.imul(t ^ (t >>> 15), 0x735A2D97);
        return ((t ^ (t >>> 15)) >>> 0);
    }
}