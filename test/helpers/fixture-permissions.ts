import process from "node:process";

// Fixture Git directories must not inherit group-write permissions that disable managed restore.
export function isolateFixturePermissions(): void {
	const inheritedUmask = process.umask(0o022);
	process.once("exit", () => {
		process.umask(inheritedUmask);
	});
}
