export function modelCapacity(model) {
  const positive = value => Number.isSafeInteger(value) && value > 0;
  if (!model || typeof model.slug !== 'string' || !positive(model.context_window) ||
      !positive(model.max_context_window) || model.context_window > model.max_context_window ||
      !Number.isFinite(model.effective_context_window_percent) || model.effective_context_window_percent <= 0 ||
      model.effective_context_window_percent > 100) throw Error('MODEL_LIMITS_UNVERIFIED');
  return Object.freeze({model:model.slug, defaultWindow:model.context_window, maxWindow:model.max_context_window,
    effectivePercent:model.effective_context_window_percent});
}
export function capacityLevels(model) {
  const limits = modelCapacity(model);
  return [...new Set([limits.defaultWindow, 384000, 512000, 768000, limits.maxWindow])]
    .filter(value => value >= limits.defaultWindow && value <= limits.maxWindow).sort((left, right) => left - right);
}

export function tierWindow(configuredWindow, effectivePercent) {
  const usable=Math.floor(configuredWindow*effectivePercent/100);
  const requestedCompactLimit=Math.floor(usable*95/100);
  return {usable, requestedCompactLimit, compactAt:Math.min(requestedCompactLimit, Math.floor(configuredWindow*9/10))};
}
