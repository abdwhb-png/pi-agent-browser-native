/** Immutable help/document inventory section construction for the canonical capability baseline. */
export const root = (token) => ["root help", token];
export const section = (id, title, docTokens, upstreamExpectations = []) =>
	Object.freeze({
		id,
		title,
		docTokens: Object.freeze(docTokens),
		upstreamExpectations: Object.freeze(
			upstreamExpectations.map(([help, token]) => Object.freeze({ help, token })),
		),
	});
