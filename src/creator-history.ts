import { LRUCache } from 'lru-cache';
import { CreatorFlag, CreatorRecord, TokenStatus } from './types';

/**
 * In-memory creator history. Bounded LRU so that long-running processes don't
 * grow without limit. Eviction is fine for our purposes — if a creator hasn't
 * launched in the last N=maxCreatorsCached launches, treating their next
 * launch as NEW_CREATOR is acceptable for this tool's scope.
 */
export class CreatorHistory {
  private cache: LRUCache<string, CreatorRecord>;

  constructor(maxCreatorsCached: number) {
    this.cache = new LRUCache<string, CreatorRecord>({ max: maxCreatorsCached });
  }

  get(creator: string): CreatorRecord | undefined {
    return this.cache.get(creator);
  }

  /**
   * Snapshot the creator's state *before* the new launch, then record the
   * new launch. Returns the prior snapshot — used by the tracker to tag the
   * launch with the creator's history at that moment.
   */
  recordLaunch(creator: string, mint: string, now: number): CreatorRecord {
    const existing = this.cache.get(creator);
    const prior: CreatorRecord = existing
      ? { ...existing, recentMints: [...existing.recentMints] }
      : {
          creator,
          launches: 0,
          graduated: 0,
          rugged: 0,
          recentMints: [],
          firstSeen: now,
          lastSeen: now,
        };

    const updated: CreatorRecord = {
      creator,
      launches: prior.launches + 1,
      graduated: prior.graduated,
      rugged: prior.rugged,
      recentMints: [...prior.recentMints, mint].slice(-50),
      firstSeen: prior.firstSeen,
      lastSeen: now,
    };
    this.cache.set(creator, updated);
    return prior;
  }

  /** Update outcome counts for a previously-launched mint. */
  recordOutcome(creator: string, status: TokenStatus, now: number): void {
    const r = this.cache.get(creator);
    if (!r) return;
    const next: CreatorRecord = {
      ...r,
      graduated: r.graduated + (status === 'graduated' ? 1 : 0),
      rugged: r.rugged + (status === 'rugged' ? 1 : 0),
      lastSeen: now,
    };
    this.cache.set(creator, next);
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * Classify a creator using the snapshot taken *before* the current launch was
 * counted. The thresholds are deliberately conservative — they're meant to
 * inform a human or a downstream filter, not to make trading decisions.
 */
export function classifyCreator(prior: CreatorRecord): CreatorFlag {
  const n = prior.launches;
  if (n === 0) return 'NEW_CREATOR';

  const gradRate = n > 0 ? prior.graduated / n : 0;
  const rugRate = n > 0 ? prior.rugged / n : 0;

  if (n >= 3 && gradRate >= 0.5) return 'SERIAL_GRADUATOR';
  if (n >= 2 && rugRate >= 0.5) return 'KNOWN_RUGGER';
  return 'REPEAT_CREATOR';
}
