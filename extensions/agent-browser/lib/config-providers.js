// @ts-check

/** @typedef {"exa" | "brave"} WebSearchProvider */
/** @typedef {"auto" | "fast" | "instant" | "deep-lite" | "deep" | "deep-reasoning"} ExaSearchType */
/** @typedef {"exaApiKey" | "braveApiKey"} WebSearchProviderConfigKey */
/** @typedef {{ readonly provider: WebSearchProvider; readonly apiKeyEnv: string; readonly configKey: WebSearchProviderConfigKey; readonly label: string }} WebSearchProviderDescriptor */

export const BRAVE_API_KEY_ENV = "BRAVE_API_KEY";
export const EXA_API_KEY_ENV = "EXA_API_KEY";
/** @type {Readonly<Record<WebSearchProvider, WebSearchProviderDescriptor>>} */
export const WEB_SEARCH_PROVIDER_DESCRIPTORS = Object.freeze({
	exa: Object.freeze({
		provider: "exa",
		apiKeyEnv: EXA_API_KEY_ENV,
		configKey: "exaApiKey",
		label: "Exa",
	}),
	brave: Object.freeze({
		provider: "brave",
		apiKeyEnv: BRAVE_API_KEY_ENV,
		configKey: "braveApiKey",
		label: "Brave Search",
	}),
});
/** @type {readonly WebSearchProvider[]} */
export const WEB_SEARCH_PROVIDERS = Object.freeze(["exa", "brave"]);
/** @type {WebSearchProvider} */
export const DEFAULT_WEB_SEARCH_PROVIDER = "exa";
/** @type {readonly ExaSearchType[]} */
export const EXA_SEARCH_TYPES = Object.freeze([
	"auto",
	"fast",
	"instant",
	"deep-lite",
	"deep",
	"deep-reasoning",
]);
/** @type {Readonly<Record<WebSearchProvider, WebSearchProviderConfigKey>>} */
export const WEB_SEARCH_PROVIDER_CONFIG_KEYS = Object.freeze({
	exa: WEB_SEARCH_PROVIDER_DESCRIPTORS.exa.configKey,
	brave: WEB_SEARCH_PROVIDER_DESCRIPTORS.brave.configKey,
});
/** @type {Readonly<Record<WebSearchProvider, string>>} */
export const WEB_SEARCH_PROVIDER_ENV_VARS = Object.freeze({
	exa: WEB_SEARCH_PROVIDER_DESCRIPTORS.exa.apiKeyEnv,
	brave: WEB_SEARCH_PROVIDER_DESCRIPTORS.brave.apiKeyEnv,
});

/** @param {unknown} value
 * @returns {value is WebSearchProvider} */
export function isWebSearchProvider(value) {
	return value === "exa" || value === "brave";
}

/** @param {string} provider
 * @returns {WebSearchProviderDescriptor} */
export function getWebSearchProviderDescriptor(provider) {
	if (!isWebSearchProvider(provider)) {
		throw new Error(`Unknown web-search provider: ${provider}`);
	}
	return WEB_SEARCH_PROVIDER_DESCRIPTORS[provider];
}

/** @param {WebSearchProvider} provider */
export function getWebSearchProviderLabel(provider) {
	return getWebSearchProviderDescriptor(provider).label;
}

/** @param {WebSearchProvider} provider */
export function getWebSearchProviderEnvVar(provider) {
	return getWebSearchProviderDescriptor(provider).apiKeyEnv;
}

/** @param {WebSearchProvider} provider
 * @returns {WebSearchProviderConfigKey} */
export function getWebSearchProviderConfigKey(provider) {
	return getWebSearchProviderDescriptor(provider).configKey;
}
