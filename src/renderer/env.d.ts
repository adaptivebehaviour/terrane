import type { AbBridge } from '@adaptivebehaviour/desktop/src/ipc/index';

declare global {
  interface Window {
    /** Exposed by the preload script; wrapped into `ab` (see ab.ts). Not for direct use. */
    abBridge: AbBridge;
  }
}
