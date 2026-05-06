import bs58 from 'bs58';
import {
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
} from '@solana/web3.js';
import {
  CreateEvent,
  DISCRIMINATORS,
  PumpEvent,
  TradeEvent,
} from './types';

/**
 * Decode the data buffer of a pump.fun instruction. Returns the discriminator
 * (hex) and a Reader positioned right after it, or null if the buffer is too
 * short to contain a discriminator.
 */
function readDiscriminator(data: Buffer): { hex: string; rest: Reader } | null {
  if (data.length < 8) return null;
  return {
    hex: data.subarray(0, 8).toString('hex'),
    rest: new Reader(data, 8),
  };
}

/** Tiny little-endian reader for Anchor-encoded instruction data. */
class Reader {
  private off: number;
  constructor(private buf: Buffer, off: number) {
    this.off = off;
  }
  remaining(): number {
    return this.buf.length - this.off;
  }
  readU64(): bigint {
    if (this.remaining() < 8) throw new Error('readU64: short buffer');
    const v = this.buf.readBigUInt64LE(this.off);
    this.off += 8;
    return v;
  }
  readString(): string {
    if (this.remaining() < 4) throw new Error('readString: short buffer for length');
    const len = this.buf.readUInt32LE(this.off);
    this.off += 4;
    if (len > this.remaining()) throw new Error('readString: length exceeds buffer');
    const s = this.buf.subarray(this.off, this.off + len).toString('utf8');
    this.off += len;
    return s;
  }
}

/**
 * Account index conventions for the pump.fun IDL (v1). These are stable but if
 * pump.fun ever ships a new IDL version we may need to branch on discriminator.
 *
 * create accounts (14): mint, mintAuthority, bondingCurve, associatedBondingCurve,
 *   global, mplTokenMetadata, metadata, user, systemProgram, tokenProgram,
 *   associatedTokenProgram, rent, eventAuthority, program
 *
 * buy/sell accounts (12): global, feeRecipient, mint, bondingCurve,
 *   associatedBondingCurve, associatedUser, user, systemProgram, tokenProgram,
 *   rent, eventAuthority, program
 */
const CREATE_ACCT = {
  mint: 0,
  bondingCurve: 2,
  user: 7,
} as const;

const TRADE_ACCT = {
  mint: 2,
  user: 6,
} as const;

function getAccountKey(
  ix: PartiallyDecodedInstruction,
  index: number,
): string | null {
  const k = ix.accounts[index];
  return k ? k.toBase58() : null;
}

/**
 * Decode a single pump.fun instruction. Returns null if the instruction is not
 * one we care about, or if the data can't be parsed (corrupt/truncated).
 */
function decodeInstruction(
  ix: PartiallyDecodedInstruction,
  signature: string,
  slot: number,
  blockTime: number | null,
  solAmountByUser: Map<string, bigint>,
): PumpEvent | null {
  let data: Buffer;
  try {
    data = Buffer.from(bs58.decode(ix.data));
  } catch {
    return null;
  }
  const head = readDiscriminator(data);
  if (!head) return null;

  if (head.hex === DISCRIMINATORS.create) {
    try {
      const name = head.rest.readString();
      const symbol = head.rest.readString();
      const uri = head.rest.readString();
      const mint = getAccountKey(ix, CREATE_ACCT.mint);
      const bondingCurve = getAccountKey(ix, CREATE_ACCT.bondingCurve);
      const creator = getAccountKey(ix, CREATE_ACCT.user);
      if (!mint || !bondingCurve || !creator) return null;
      const ev: CreateEvent = {
        kind: 'create',
        signature,
        slot,
        blockTime,
        mint,
        creator,
        name,
        symbol,
        uri,
        bondingCurve,
        // Filled in by the tracker when it fetches the bonding-curve account;
        // these defaults match the protocol's initial values.
        initialVirtualSolReserves: 30_000_000_000n,
        initialVirtualTokenReserves: 1_073_000_000_000_000n,
      };
      return ev;
    } catch {
      return null;
    }
  }

  if (head.hex === DISCRIMINATORS.buy || head.hex === DISCRIMINATORS.sell) {
    try {
      const tokenAmount = head.rest.readU64();
      // The second u64 is max_sol_cost (buy) / min_sol_output (sell) — a bound,
      // not the actual amount. We use the user's net SOL delta from the tx
      // balances (computed by the caller) as the truthy SOL amount.
      head.rest.readU64();
      const mint = getAccountKey(ix, TRADE_ACCT.mint);
      const user = getAccountKey(ix, TRADE_ACCT.user);
      if (!mint || !user) return null;
      const solAmount = solAmountByUser.get(user) ?? 0n;
      const ev: TradeEvent = {
        kind: head.hex === DISCRIMINATORS.buy ? 'buy' : 'sell',
        signature,
        slot,
        blockTime,
        mint,
        user,
        tokenAmount,
        solAmount,
      };
      return ev;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Compute the per-account SOL delta (lamports) from a transaction's pre/post
 * balances. Sign convention: positive means the account gained SOL.
 *
 * For trades, we use abs(delta) on the user account as a best-effort SOL
 * amount. Fees are paid by the user too, so this is approximate by a few
 * thousand lamports — fine for analytics, not for accounting.
 */
function buildSolDeltas(tx: ParsedTransactionWithMeta): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const meta = tx.meta;
  if (!meta) return out;
  const keys = tx.transaction.message.accountKeys;
  for (let i = 0; i < keys.length; i++) {
    const pre = BigInt(meta.preBalances[i] ?? 0);
    const post = BigInt(meta.postBalances[i] ?? 0);
    const delta = post - pre;
    const abs = delta < 0n ? -delta : delta;
    const k = keys[i].pubkey.toBase58();
    out.set(k, abs);
  }
  return out;
}

/**
 * Top-level: extract every pump.fun event from a fetched parsed transaction.
 * Walks both top-level and inner instructions so that CPI'd buys/sells from
 * aggregators are still picked up.
 */
export function decodeTransaction(
  tx: ParsedTransactionWithMeta,
  programId: string,
): PumpEvent[] {
  const out: PumpEvent[] = [];
  const sig = tx.transaction.signatures[0];
  const slot = tx.slot;
  const blockTime = tx.blockTime ?? null;
  const solDeltas = buildSolDeltas(tx);

  const program = new PublicKey(programId);
  const ixs = tx.transaction.message.instructions;
  for (const ix of ixs) {
    if ('programId' in ix && ix.programId.equals(program) && 'data' in ix) {
      const ev = decodeInstruction(
        ix as PartiallyDecodedInstruction,
        sig,
        slot,
        blockTime,
        solDeltas,
      );
      if (ev) out.push(ev);
    }
  }
  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions) {
      if ('programId' in ix && ix.programId.equals(program) && 'data' in ix) {
        const ev = decodeInstruction(
          ix as PartiallyDecodedInstruction,
          sig,
          slot,
          blockTime,
          solDeltas,
        );
        if (ev) out.push(ev);
      }
    }
  }
  return out;
}

/**
 * Decode a pump.fun bonding-curve account's data buffer.
 * Layout (Anchor): disc(8) | virtualTokenReserves u64 | virtualSolReserves u64 |
 *                 realTokenReserves u64 | realSolReserves u64 |
 *                 tokenTotalSupply u64 | complete bool
 */
export interface BondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export function decodeBondingCurveAccount(data: Buffer): BondingCurveState | null {
  if (data.length < 8 + 5 * 8 + 1) return null;
  const r = new Reader(data, 8);
  try {
    const virtualTokenReserves = r.readU64();
    const virtualSolReserves = r.readU64();
    const realTokenReserves = r.readU64();
    const realSolReserves = r.readU64();
    const tokenTotalSupply = r.readU64();
    // Last byte is a bool. Reader doesn't expose it, so peek directly.
    const complete = data[data.length - 1] === 1;
    return {
      virtualTokenReserves,
      virtualSolReserves,
      realTokenReserves,
      realSolReserves,
      tokenTotalSupply,
      complete,
    };
  } catch {
    return null;
  }
}
