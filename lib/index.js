/**
 * dsh-status-rotator — node half.
 *
 * This plugin is browser-only: its entire payload is the client bundle
 * (lib/client.js), which rotates the chat turn-status label
 * ("Deep diving...") through a user-defined phrase list. The node half
 * exists only so the loader can mount the row; it does nothing.
 */

/** Cordis plugin name. */
const name = "status-rotator";
/** No host services required. */
const inject = [];

/** No-op host half; the browser half does all the work. */
function apply() {}

export { apply, inject, name };