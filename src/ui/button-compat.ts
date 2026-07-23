import type { ButtonComponent } from "obsidian";

/**
 * `setDestructive()` is Obsidian 1.13.0+; `minAppVersion` for this plugin is 1.7.2, so it must be
 * feature-detected rather than called unconditionally. Falls back to the deprecated but always-
 * present `setWarning()` on older hosts.
 */
export function setDestructiveStyle(button: ButtonComponent): ButtonComponent {
	if (typeof button.setDestructive === "function") return button.setDestructive();
	return button.setWarning();
}
