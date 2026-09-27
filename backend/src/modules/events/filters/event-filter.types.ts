/**
 * User-supplied event subscription filter (e.g. WebSocket `subscribe` params).
 *
 * Every field is optional on input, but {@link validateEventFilter} requires
 * at least one of `eventTypes` / `contractIds` to be present so a filter
 * can't silently match nothing (or, historically, crash the normalizer on
 * malformed input further downstream).
 */
export interface EventFilter {
  readonly eventTypes: string[];
  readonly contractIds?: string[];
  readonly minLedger?: number;
  readonly maxLedger?: number;
}

export type EventFilterValidationResult =
  | { readonly ok: true; readonly filter: EventFilter }
  | { readonly ok: false; readonly errors: string[] };
