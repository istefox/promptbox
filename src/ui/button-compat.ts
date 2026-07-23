import { requireApiVersion, type ButtonComponent } from "obsidian";

/**
 * `setDestructive()` is Obsidian 1.13.0+; `minAppVersion` for this plugin is 1.7.2. Gated with
 * `requireApiVersion` (not a `typeof` check) because `obsidianmd/no-unsupported-api` only
 * recognizes that specific guard, not generic runtime feature-detection. Falls back to the
 * deprecated but always-present `setWarning()` on older hosts.
 */
export function setDestructiveStyle(button: ButtonComponent): ButtonComponent {
	if (requireApiVersion("1.13.0")) return button.setDestructive();
	return button.setWarning();
}
