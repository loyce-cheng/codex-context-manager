import { isVisible } from './telemetry.mjs';
export const RAIL_SELECTOR = 'nav[data-app-navigation-rail], aside.app-shell-left-panel nav[class~="group/sidebar-rail"]';
export function locateRail() {
  const rails = [...document.querySelectorAll(RAIL_SELECTOR)].filter(isVisible);
  if (rails.length !== 1) return null;
  const rail = rails[0], box = rail.getBoundingClientRect(), style = getComputedStyle(rail);
  if (style.display !== 'flex' || style.flexDirection !== 'column' || box.width < 36 || box.width > 100 || box.left > innerWidth / 2) return null;
  const profile = rail.querySelector('button[aria-label="Open profile menu"], button[aria-label="打开个人资料菜单"]');
  const utilities = [...rail.children].find(child => profile && child.contains(profile));
  return utilities && isVisible(utilities) ? { rail, utilities } : null;
}
export function intersects(a, b) {
  return a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
}
export function fitDock(root, location, desiredHeight, limits, editing) {
  limits.maxHeight = 0;
  if (!location) { root.remove(); return false; }
  const { rail, utilities } = location;
  if (root.parentNode !== rail || root.nextElementSibling !== utilities) rail.insertBefore(root, utilities);
  // The host participates in flex flow. No positioning or padding changes to native controls.
  root.style.display = 'flex';
  const obstacles = [...rail.querySelectorAll('button, a, input, [role="button"], [tabindex], [data-codexpp="usage-slot"]')]
    .filter(el => el !== root && !root.contains(el) && isVisible(el));
  // Compute space with our slot temporarily collapsed; avoid shrinking on every repeated measurement.
  root.style.height = '0px';
  const flexible = [...rail.children].filter(el => el !== root && Number(getComputedStyle(el).flexGrow) > 0);
  let available;
  if (flexible.length) {
    available = flexible.reduce((sum, el) => {
      const controls = obstacles.filter(control => el.contains(control));
      if (!controls.length) return sum; // Unknown content cannot be treated as spare room.
      const box = el.getBoundingClientRect();
      const bottom = Math.max(box.top, ...controls.map(control => control.getBoundingClientRect().bottom));
      return sum + Math.max(0, box.bottom - bottom - (parseFloat(getComputedStyle(el).paddingBottom) || 0));
    }, 0) - 12;
  } else {
    const before = obstacles.filter(el => !utilities.contains(el));
    const top = Math.max(rail.getBoundingClientRect().top, ...before.map(el => el.getBoundingClientRect().bottom));
    available = utilities.getBoundingClientRect().top - top - 12;
  }
  limits.maxHeight = Math.floor(available);
  // In a short rail share the free space between the resting bar and its gesture.
  // The unused space remains with the host until the user actually drags.
  const ceiling = editing ? limits.maxHeight : Math.max(112, 112 + (limits.maxHeight - 112) * .6);
  const height = Math.min(desiredHeight, limits.maxHeight, ceiling);
  if (height < 112) { root.style.display = 'none'; return false; }
  root.style.height = `${Math.floor(height)}px`;
  const rect = root.getBoundingClientRect(), railRect = rail.getBoundingClientRect();
  const safe = rect.top >= railRect.top && rect.bottom <= railRect.bottom &&
    rail.scrollHeight <= rail.clientHeight + 1 && !obstacles.some(el => intersects(rect, el.getBoundingClientRect())) &&
    flexible.every(group => obstacles.filter(el => group.contains(el)).every(el => el.getBoundingClientRect().bottom <= group.getBoundingClientRect().bottom + 1));
  if (!safe) root.style.display = 'none';
  return safe;
}
