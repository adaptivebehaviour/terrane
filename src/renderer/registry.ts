import { createRegistry } from '@adaptivebehaviour/manifesto/src/registry';
import { manifesto } from '@adaptivebehaviour/manifesto/src/manifesto/index';
import { desktop } from '@adaptivebehaviour/desktop/src/desktop/index';
import { scenes } from '@adaptivebehaviour/scenes-records/src/index';
import { ui } from '@adaptivebehaviour/ui/src/index';
import { terrane } from 'terrane-collection/src/index';

/**
 * The one place this application's collections are composed, in load order. Keep `styles.css` importing each
 * collection's stylesheet in the same order. Add a collection here instead of editing the library's `getCollection.ts`.
 */
export const registry = createRegistry([manifesto, scenes, desktop, ui, terrane]);

export const getCollection = registry.getCollection;
