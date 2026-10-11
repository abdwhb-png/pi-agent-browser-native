export interface SessionTabTarget {
	readonly targetId?: string;
	readonly title?: string;
	readonly url: string;
}
export interface OrderedSessionTabTarget {
	readonly order: number;
	readonly reopenPending?: boolean;
	readonly target: SessionTabTarget;
}
export interface SessionRefSnapshot {
	readonly snapshotId?: string;
	readonly generation?: string;
	readonly refIds: readonly string[];
	readonly refs?: Readonly<
		Record<
			string,
			{
				readonly isContentEditable?: boolean;
				readonly isEditable?: boolean;
				readonly name: string;
				readonly role: string;
			}
		>
	>;
	readonly target?: SessionTabTarget;
}
export interface OrderedSessionRefSnapshot extends SessionRefSnapshot {
	readonly order: number;
}
export interface SessionRefSnapshotInvalidation {
	readonly reason: "no-active-page" | "page-transition";
	readonly summary: string;
}
export interface OrderedSessionRefSnapshotInvalidation extends SessionRefSnapshotInvalidation {
	readonly order: number;
}
export interface BatchRefSnapshotState {
	readonly invalidation?: SessionRefSnapshotInvalidation;
	readonly refreshArgs?: readonly string[];
	readonly snapshot?: SessionRefSnapshot;
}
export type SessionTabPinningReason = "drift" | "restore";
export type SessionPageStateUpdateToken = number & {
	readonly __sessionPageStateUpdateToken: unique symbol;
};
export interface SessionPageStateView {
	readonly confirmActions?: string;
	readonly pinningReason?: SessionTabPinningReason;
	readonly tabReopenPending?: boolean;
	readonly tabTargetUnknown?: true;
	readonly refSnapshot?: SessionRefSnapshot;
	readonly refSnapshotInvalidation?: SessionRefSnapshotInvalidation;
	readonly tabTarget?: SessionTabTarget;
}
export interface SessionPageStateUpdateResult extends SessionPageStateView {
	readonly applied: boolean;
	readonly stale?: boolean;
}
