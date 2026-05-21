/**
 * §13 — Scheduling: staff availability, service duration, client behavior counters.
 */
export { checkStaffAvailability, type StaffAvailabilityResult } from "./availability.js";
export { validateServiceDuration } from "./duration.js";
export { resolveEndAtForService } from "./duration.js";
export { validateSlot, type ValidateSlotResult } from "./engine.js";
export {
  incrementClientCancel,
  incrementClientNoShow,
  resolveClientIdForCounters,
} from "./clientBehavior.js";
