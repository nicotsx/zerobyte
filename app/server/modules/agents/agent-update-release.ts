import { Cache, Effect, Exit } from "effect";
import { parse } from "semver";
import { AGENT_UPDATE_TAG_MAX_LENGTH } from "@zerobyte/contracts/agent-maintenance";
import {
	downloadAgentRelease,
	ReleaseNetworkError,
	ReleaseVerificationError,
} from "@zerobyte/contracts/agent-release-download";
import {
	SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
	SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
} from "@zerobyte/contracts/agent-protocol";
import { config } from "~/server/core/config";

export const getAgentVersion = (version: string | undefined) => {
	if (!version || version.length > AGENT_UPDATE_TAG_MAX_LENGTH) return null;
	const parsed = parse(version);
	if (!parsed) return null;

	const normalized = parsed.build.length ? `${parsed.version}+${parsed.build.join(".")}` : parsed.version;
	if (normalized.length >= AGENT_UPDATE_TAG_MAX_LENGTH) return null;

	return version === normalized || version === `v${normalized}` ? normalized : null;
};

export const getAgentUpdateTag = () => {
	const version = getAgentVersion(config.appVersion);
	if (!version) return null;

	const prerelease = parse(version)?.prerelease;
	if (prerelease?.some((identifier) => typeof identifier === "string" && /^(dev|nightly)/i.test(identifier))) {
		return null;
	}

	return `v${version}`;
};

export const isSupportedAgentProtocol = (version: number) =>
	version >= SUPPORTED_AGENT_PROTOCOL_MIN_VERSION && version <= SUPPORTED_AGENT_PROTOCOL_MAX_VERSION;

const RELEASE_CACHE_CAPACITY = 32;
const RELEASE_TIMEOUT_MS = 3_000;
const RELEASE_CACHE_TTL_MS = 60_000;
const RELEASE_RETRY_TTL_MS = 5_000;

const fetchAgentUpdateRelease = (tag: string) =>
	downloadAgentRelease(tag).pipe(
		Effect.timeoutOrElse({
			duration: RELEASE_TIMEOUT_MS,
			orElse: () => Effect.fail(new ReleaseNetworkError({ cause: "Release download timed out" })),
		}),
		Effect.filterOrFail(
			(release) => isSupportedAgentProtocol(release.protocolVersion),
			(release) =>
				new ReleaseVerificationError({
					cause: `Unsupported release protocol version ${release.protocolVersion}`,
				}),
		),
	);

const releaseCache = Effect.runSync(
	Cache.makeWith(fetchAgentUpdateRelease, {
		capacity: RELEASE_CACHE_CAPACITY,
		timeToLive: (exit) => {
			if (Exit.isSuccess(exit)) return RELEASE_CACHE_TTL_MS;

			const error = Exit.findError(exit);
			if (error._tag === "Failure") return 0;
			if (error.success._tag === "ReleaseVerificationError") return RELEASE_CACHE_TTL_MS;

			return RELEASE_RETRY_TTL_MS;
		},
	}),
);

export const getAgentUpdateRelease = (tag: string) =>
	Cache.get(releaseCache, tag).pipe(Effect.orElseSucceed(() => null));
