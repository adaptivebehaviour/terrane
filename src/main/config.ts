import type { ServiceDeclaration } from '@adaptivebehaviour/desktop/src/net/index';

/**
 * Application-level configuration of the main process. A project scaffolded from this shell edits this file.
 */

/** Identifies this application's workspaces (`workspace.json` `appId`): a lower-case slug. A workspace made by another app is refused. */
export const APP_ID = 'terrane';

/** Shown in the window title and written into new workspaces as `createdBy`. */
export const APP_NAME = 'Terrane';

/**
 * The external services this application may use: its network allow-list. Empty by default, so the application makes
 * no network requests and its CSP allows no remote origin. Declare a service here to use it, e.g. Sanity or an LLM API
 * (the renderer then calls it with `ab.net.call({ service, operation, … })`; credentials come from environment variables).
 */
export const services: ServiceDeclaration[] = [];

/** `https:` origins the OS browser may be opened for when a link is clicked. Empty: links to external sites do nothing. */
export const externalLinkOrigins: string[] = [];
